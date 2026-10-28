import { VERT, SCENES, fragmentFor } from './shaders.js';

const $ = (s) => document.querySelector(s);
const video = $('#video');
const canvas = $('#gl');
const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
const params = new URLSearchParams(location.search);

// ---------- settings ----------

const DEFAULTS = {
  keyA: [0.2, 0.65, 0.3],
  keyB: [0.2, 0.65, 0.3],
  tol: 0.09,
  soft: 0.06,
  spill: 0.6,
  mode: 1,          // 0 = by colour, 1 = left/right split
  split: 0.5,
  swap: 0,
  scene: 0,
  facing: 'environment',
  hd: 0,
};
const firstRun = Object.keys(load()).length === 0;
const S = { ...DEFAULTS, ...load() };

function load() {
  try { return JSON.parse(localStorage.getItem('kraken-cam') || '{}'); } catch { return {}; }
}
function save() {
  try { localStorage.setItem('kraken-cam', JSON.stringify(S)); } catch {}
}

function toYCC([r, g, b]) {
  return [
    0.299 * r + 0.587 * g + 0.114 * b,
    -0.169 * r - 0.331 * g + 0.5 * b,
    0.5 * r - 0.419 * g - 0.081 * b,
  ];
}

// ---------- GL ----------

const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

function makeTex() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3));
  return t;
}
const videoTex = makeTex();
const plateTex = makeTex();
let hasPlate = false;
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

const programs = new Map();
const UNIFORMS = ['uVideo', 'uPlate', 'uRes', 'uTime', 'uKeyA', 'uKeyB', 'uTol', 'uSoft', 'uSpill',
  'uMode', 'uSplit', 'uMirror', 'uSwap', 'uShowMask', 'uHasPlate'];

function program(i) {
  if (programs.has(i)) return programs.get(i);
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragmentFor(SCENES[i])));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (const n of UNIFORMS) u[n] = gl.getUniformLocation(p, n);
  const entry = { p, u };
  programs.set(i, entry);
  return entry;
}

// ---------- camera ----------

let stream = null;
let showMask = false;

async function startCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  if (params.has('test')) {
    stream = testStream();
  } else {
    const size = S.hd ? { width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1280 }, height: { ideal: 720 } };
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: S.facing }, ...size },
      audio: false,
    });
  }
  video.srcObject = stream;
  await video.play();
  setLocked(false);
}

const mirrored = () => S.facing === 'user' && !params.has('test');

// Fake camera: two green figures (different shades) in a crowd, for trying effects on a laptop.
function testStream() {
  const c = document.createElement('canvas');
  c.width = 720; c.height = 1280;
  const x = c.getContext('2d');
  const figure = (cx, cy, col, t) => {
    x.fillStyle = col;
    x.beginPath(); x.arc(cx, cy - 330, 70, 0, 7); x.fill();
    x.beginPath(); x.ellipse(cx, cy, 120, 240, Math.sin(t) * 0.08, 0, 7); x.fill();
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.beginPath(); x.ellipse(cx + 40, cy + 40, 50, 160, 0, 0, 7); x.fill();
  };
  const draw = (now) => {
    const t = now / 1000;
    const g = x.createLinearGradient(0, 0, 0, 1280);
    g.addColorStop(0, '#7a6a58'); g.addColorStop(1, '#3a3028');
    x.fillStyle = g; x.fillRect(0, 0, 720, 1280);
    x.fillStyle = '#c99'; x.beginPath(); x.arc(80, 500, 60, 0, 7); x.fill();
    x.fillStyle = '#346'; x.fillRect(20, 560, 130, 500);
    x.fillStyle = '#eca'; x.beginPath(); x.arc(650, 480, 55, 0, 7); x.fill();
    x.fillStyle = '#922'; x.fillRect(590, 540, 120, 520);
    figure(240 + Math.sin(t) * 20, 760, 'rgb(40,165,70)', t);
    figure(490 + Math.cos(t) * 20, 790, 'rgb(110,190,40)', t + 1);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return c.captureStream(30);
}

let locked = false;
async function setLocked(on) {
  const track = stream?.getVideoTracks()[0];
  locked = false;
  $('#lock').classList.remove('on');
  if (!track?.getCapabilities) return;
  const caps = track.getCapabilities();
  const cur = track.getSettings();
  const c = {};
  if (caps.exposureMode) {
    c.exposureMode = on && caps.exposureMode.includes('manual') ? 'manual' : 'continuous';
    if (on && cur.exposureTime) c.exposureTime = cur.exposureTime;
  }
  if (caps.whiteBalanceMode) {
    c.whiteBalanceMode = on && caps.whiteBalanceMode.includes('manual') ? 'manual' : 'continuous';
    if (on && cur.colorTemperature) c.colorTemperature = cur.colorTemperature;
  }
  if (!Object.keys(c).length) {
    if (on) toast("This camera doesn't allow locking exposure");
    return;
  }
  try {
    await track.applyConstraints({ advanced: [c] });
    locked = on && (c.exposureMode === 'manual' || c.whiteBalanceMode === 'manual');
    $('#lock').classList.toggle('on', locked);
    if (on) toast(locked ? 'Exposure & colour locked' : "Couldn't lock this camera");
  } catch {
    if (on) toast("Couldn't lock this camera");
  }
}

// ---------- render ----------

let snapPending = false;
const t0 = performance.now();

function frame() {
  requestAnimationFrame(frame);
  if (video.readyState < 2 || !video.videoWidth) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    placeSplit();
  }
  let prog;
  try {
    prog = program(S.scene);
  } catch (e) {
    console.error(e);
    toast('Effect failed to load: ' + SCENES[S.scene].name);
    S.scene = 0;
    return;
  }
  const { p, u } = prog;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(p);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, plateTex);
  gl.uniform1i(u.uVideo, 0);
  gl.uniform1i(u.uPlate, 1);
  gl.uniform2f(u.uRes, canvas.width, canvas.height);
  gl.uniform1f(u.uTime, (performance.now() - t0) / 1000);
  gl.uniform3fv(u.uKeyA, toYCC(S.keyA));
  gl.uniform3fv(u.uKeyB, toYCC(S.keyB));
  gl.uniform1f(u.uTol, S.tol);
  gl.uniform1f(u.uSoft, S.soft);
  gl.uniform1f(u.uSpill, S.spill);
  gl.uniform1f(u.uMode, S.mode);
  gl.uniform1f(u.uSplit, S.split);
  gl.uniform1f(u.uMirror, mirrored() ? 1 : 0);
  gl.uniform1f(u.uSwap, S.swap);
  gl.uniform1f(u.uShowMask, showMask ? 1 : 0);
  gl.uniform1f(u.uHasPlate, hasPlate ? 1 : 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // Copy in the same task as the draw, before the drawing buffer is cleared.
  if (snapPending) {
    snapPending = false;
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    c.getContext('2d').drawImage(canvas, 0, 0);
    c.toBlob(showPhoto, 'image/jpeg', 0.92);
  }
}

// ---------- screen <-> canvas mapping (canvas is shown with object-fit: cover) ----------

function cover() {
  const r = canvas.getBoundingClientRect();
  const scale = Math.max(r.width / canvas.width, r.height / canvas.height);
  const w = canvas.width * scale, h = canvas.height * scale;
  return { r, w, h, ox: (r.width - w) / 2, oy: (r.height - h) / 2 };
}
function screenToUv(x, y) {
  const c = cover();
  return [(x - c.r.left - c.ox) / c.w, 1 - (y - c.r.top - c.oy) / c.h];
}
function uvToScreenX(u) {
  const c = cover();
  return c.r.left + c.ox + u * c.w;
}

const sampler = document.createElement('canvas');
sampler.width = sampler.height = 15;
const sctx = sampler.getContext('2d', { willReadFrequently: true });

function sampleAt(x, y) {
  let [u, v] = screenToUv(x, y);
  if (mirrored()) u = 1 - u;
  const vx = u * video.videoWidth, vy = (1 - v) * video.videoHeight;
  sctx.drawImage(video, vx - 7, vy - 7, 15, 15, 0, 0, 15, 15);
  const d = sctx.getImageData(0, 0, 15, 15).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
  const n = d.length / 4;
  return sum.map((s) => s / n / 255);
}

// ---------- UI ----------

function toast(msg, ms = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function showScene() {
  const sc = SCENES[S.scene];
  const [a, b] = S.swap ? [sc.chars[1], sc.chars[0]] : sc.chars;
  $('#scene-name').textContent = sc.name;
  $('#char-left').textContent = S.mode ? `◀ ${a}` : a;
  $('#char-right').textContent = S.mode ? `${b} ▶` : b;
  $('#plate-hint').hidden = !(sc.needsPlate && !hasPlate);
  const hud = $('#hud');
  hud.classList.remove('flash');
  void hud.offsetWidth;
  hud.classList.add('flash');
}

function setScene(i) {
  S.scene = (i + SCENES.length) % SCENES.length;
  save();
  showScene();
}

function placeSplit() {
  const line = $('#split');
  line.hidden = !S.mode || calibrating !== 0;
  if (!line.hidden && canvas.width) line.style.left = `${uvToScreenX(S.split)}px`;
}

// calibration: 0 = off, 1 = waiting for suit A, 2 = waiting for suit B
let calibrating = 0;
function setCalibrating(step) {
  calibrating = step;
  $('#calib').hidden = !step;
  $('#calib-text').textContent = step === 1
    ? 'Tap the FIRST suit (left person)'
    : 'Tap the SECOND suit (right person)';
  $('#calib-same').hidden = step !== 2;
  placeSplit();
}

function finishCalibration(same) {
  const a = toYCC(S.keyA), b = toYCC(S.keyB);
  const dist = Math.hypot(a[1] - b[1], a[2] - b[2]);
  if (same || dist < S.tol + S.soft) {
    S.mode = 1;
    S.keyB = same ? S.keyA : S.keyB;
    toast('Same green → left/right split. Drag the line to move it.', 4000);
  } else {
    S.mode = 0;
    toast('Two different greens → each suit gets its own character', 4000);
  }
  save();
  setCalibrating(0);
  syncSettings();
  showScene();
}

canvas.addEventListener('pointerdown', (e) => {
  if (calibrating) {
    const rgb = sampleAt(e.clientX, e.clientY);
    if (calibrating === 1) {
      S.keyA = rgb;
      S.keyB = rgb;
      setCalibrating(2);
    } else {
      S.keyB = rgb;
      finishCalibration(false);
    }
    return;
  }
  swipe = { x: e.clientX, y: e.clientY };
});
let swipe = null;
canvas.addEventListener('pointerup', (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) setScene(S.scene + (dx < 0 ? 1 : -1));
});

$('#split').addEventListener('pointerdown', (e) => {
  const line = e.currentTarget;
  line.setPointerCapture(e.pointerId);
  const move = (ev) => {
    S.split = Math.min(0.95, Math.max(0.05, screenToUv(ev.clientX, ev.clientY)[0]));
    placeSplit();
  };
  const up = () => {
    line.removeEventListener('pointermove', move);
    line.removeEventListener('pointerup', up);
    save();
  };
  line.addEventListener('pointermove', move);
  line.addEventListener('pointerup', up);
});

$('#prev').onclick = () => setScene(S.scene - 1);
$('#next').onclick = () => setScene(S.scene + 1);
$('#calibrate').onclick = () => { closeSettings(); setCalibrating(1); };
$('#calib-cancel').onclick = () => setCalibrating(0);
$('#calib-same').onclick = () => finishCalibration(true);
$('#lock').onclick = () => setLocked(!locked);

$('#shutter').onclick = () => {
  snapPending = true;
  const f = $('#flash');
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
};

let photoFile = null;
function showPhoto(blob) {
  photoFile = new File([blob], `kraken-cam-${Date.now()}.jpg`, { type: 'image/jpeg' });
  const img = $('#photo-img');
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(blob);
  $('#photo').hidden = false;
}
$('#photo-close').onclick = () => { $('#photo').hidden = true; };
$('#photo-share').onclick = async () => {
  if (navigator.canShare?.({ files: [photoFile] })) {
    try {
      await navigator.share({ files: [photoFile] });
    } catch (e) {
      if (e.name !== 'AbortError') toast('Sharing failed — try Save');
    }
  } else {
    toast('Sharing not supported here — saving instead');
    download();
  }
};
$('#photo-save').onclick = download;
function download() {
  const a = document.createElement('a');
  a.href = $('#photo-img').src;
  a.download = photoFile.name;
  a.click();
}

// settings sheet
const sheet = $('#settings');
function closeSettings() { sheet.hidden = true; }
$('#open-settings').onclick = () => { syncSettings(); sheet.hidden = false; };
$('#close-settings').onclick = closeSettings;

const sliders = ['tol', 'soft', 'spill'];
for (const k of sliders) {
  $(`#${k}`).oninput = (e) => { S[k] = +e.target.value; save(); };
}
$('#mode').onchange = (e) => { S.mode = +e.target.value; save(); placeSplit(); showScene(); };
$('#swap').onclick = () => { S.swap = S.swap ? 0 : 1; save(); showScene(); };
$('#show-mask').onchange = (e) => { showMask = e.target.checked; };
$('#hd').onchange = (e) => { S.hd = e.target.checked ? 1 : 0; save(); startCamera().catch(cameraError); };
$('#flip').onclick = () => {
  S.facing = S.facing === 'user' ? 'environment' : 'user';
  hasPlate = false;
  save();
  startCamera().catch(cameraError);
  showScene();
};
$('#plate').onclick = capturePlate;
$('#plate-hint').onclick = capturePlate;
$('#reset').onclick = () => {
  Object.assign(S, { tol: DEFAULTS.tol, soft: DEFAULTS.soft, spill: DEFAULTS.spill });
  save();
  syncSettings();
};

function syncSettings() {
  for (const k of sliders) $(`#${k}`).value = S[k];
  $('#mode').value = String(S.mode);
  $('#hd').checked = !!S.hd;
}

function capturePlate() {
  let n = 3;
  closeSettings();
  const tick = () => {
    if (n > 0) {
      toast(`Step out of the frame… ${n}`, 1100);
      n--;
      setTimeout(tick, 1000);
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    hasPlate = true;
    toast('Background saved — keep the phone still!', 3000);
    showScene();
  };
  tick();
}

window.addEventListener('resize', placeSplit);

function cameraError(e) {
  console.error(e);
  $('#start').hidden = false;
  $('#start-msg').textContent = `Camera unavailable: ${e.message || e.name}. It needs HTTPS (or localhost) and camera permission.`;
}

$('#start-btn').onclick = async () => {
  try {
    await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  } catch {}
  try {
    await navigator.wakeLock?.request('screen');
  } catch {}
  try {
    await startCamera();
    $('#start').hidden = true;
    showScene();
    placeSplit();
    if (firstRun) setCalibrating(1);
  } catch (e) {
    cameraError(e);
  }
};

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    try { await navigator.wakeLock?.request('screen'); } catch {}
  }
});

if ('serviceWorker' in navigator && !params.has('test')) navigator.serviceWorker.register('sw.js');

syncSettings();
requestAnimationFrame(frame);

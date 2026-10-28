// GLSL for Kraken Cam. Each scene supplies fxA / fxB (one per character)
// plus rim colours; everything else (keying, masks, compositing) is shared.

export const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const HEADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uVideo;
uniform sampler2D uPlate;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uKeyA;      // YCbCr of character A's suit
uniform vec3 uKeyB;      // YCbCr of character B's suit
uniform float uTol;
uniform float uSoft;
uniform float uSpill;
uniform float uMode;     // 0 = tell apart by colour, 1 = left/right split
uniform float uSplit;    // split position, display uv x
uniform float uMirror;
uniform float uSwap;
uniform float uShowMask;
uniform float uHasPlate;
vec2 gUv;

vec2 videoUv(vec2 uv) { return vec2(uMirror > 0.5 ? 1.0 - uv.x : uv.x, uv.y); }
vec3 plateAt(vec2 uv) { return texture2D(uPlate, videoUv(uv)).rgb; }

vec3 toYCC(vec3 c) {
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)),
              dot(c, vec3(-0.169, -0.331, 0.5)),
              dot(c, vec3(0.5, -0.419, -0.081)));
}
`;

const LIB = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 19.19)); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
// x = nearest distance, y = second nearest, z = cell id
vec3 voronoi(vec2 p, float t) {
  vec2 n = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = 0.5 + 0.5 * sin(t + 6.2831 * hash2(n + g));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = hash(n + g + 0.37); }
    else if (d < f2) { f2 = d; }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
float caustics(vec2 p, float t) {
  vec3 v1 = voronoi(p * 3.0, t * 0.9);
  vec3 v2 = voronoi(p * 4.3 + 3.7, -t * 0.7 + 1.0);
  return (1.0 - smoothstep(0.0, 0.18, v1.y - v1.x)) * 0.6
       + (1.0 - smoothstep(0.0, 0.18, v2.y - v2.x)) * 0.5;
}
float bubbles(vec2 p, float t) {
  float b = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 q = p * (5.0 + fi * 3.0) + vec2(fi * 3.1, 0.0);
    q.y -= t * (0.6 + fi * 0.35);
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = hash(id + fi * 17.0);
    f.x += sin(t * 2.0 + h * 20.0) * 0.12;
    float r = 0.12 + 0.18 * fract(h * 7.3);
    float d = length(f);
    float ring = smoothstep(r, r - 0.03, d) * (0.3 + 0.7 * smoothstep(r * 0.5, r, d));
    float spec = smoothstep(r * 0.35, 0.0, length(f - vec2(-r * 0.35, r * 0.35)));
    b += (ring * 0.6 + spec) * step(0.55, h);
  }
  return clamp(b, 0.0, 1.0);
}
`;

const MAIN = `
vec2 masks(vec2 uv) {
  vec3 y = toYCC(texture2D(uVideo, videoUv(uv)).rgb);
  float dA = distance(y.yz, uKeyA.yz);
  float dB = distance(y.yz, uKeyB.yz);
  float gate = smoothstep(0.04, 0.1, y.x);
  if (uMode > 0.5) {
    float m = (1.0 - smoothstep(uTol, uTol + uSoft, min(dA, dB))) * gate;
    float s = smoothstep(uSplit - 0.01, uSplit + 0.01, uv.x);
    return vec2(m * (1.0 - s), m * s);
  }
  float mA = (1.0 - smoothstep(uTol, uTol + uSoft, dA)) * gate;
  float mB = (1.0 - smoothstep(uTol, uTol + uSoft, dB)) * gate;
  float pickA = step(dA, dB);
  return vec2(mA * pickA, mB * (1.0 - pickA));
}

void main() {
  gUv = vUv;
  vec2 px = 1.0 / uRes;
  vec3 src = texture2D(uVideo, videoUv(vUv)).rgb;
  vec3 ycc = toYCC(src);

  vec2 m = vec2(0.0);
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) m += masks(vUv + vec2(float(i), float(j)) * px * 2.0);
  m /= 9.0;
  if (uSwap > 0.5) m = m.yx;
  float total = clamp(m.x + m.y, 0.0, 1.0);

  float outerMin = 1.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.785398;
    vec2 mm = masks(vUv + vec2(cos(a), sin(a)) * px * 7.0);
    outerMin = min(outerMin, mm.x + mm.y);
  }
  float rim = clamp(total - outerMin, 0.0, 1.0) * total;

  if (uShowMask > 0.5) {
    gl_FragColor = vec4(src * 0.25 + vec3(m.x, rim * 0.5, m.y), 1.0);
    return;
  }

  // pull green spill off the edges of everything that isn't suit
  vec3 bg = src;
  float dmin = min(distance(ycc.yz, uKeyA.yz), distance(ycc.yz, uKeyB.yz));
  float near = 1.0 - smoothstep(uTol + uSoft, uTol + uSoft + 0.15, dmin);
  bg.g = mix(bg.g, min(bg.g, max(bg.r, bg.b)), uSpill * near);

  vec2 p = vec2(vUv.x * uRes.x / uRes.y, vUv.y);
  float shade = clamp(ycc.x / max(0.5 * (uKeyA.x + uKeyB.x), 0.05), 0.35, 1.6);
  vec3 col = bg * (1.0 - total);
  if (m.x > 0.001) col += fxA(p, shade) * m.x;
  if (m.y > 0.001) col += fxB(p, shade) * m.y;
  col += rim * (m.x * RIM_A + m.y * RIM_B) / max(total, 0.001);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SCENES = [
  {
    name: 'Deep Blue',
    chars: ['Sea Spirit', 'Jellyfish'],
    glsl: `
#define RIM_A vec3(0.3, 0.9, 1.0)
#define RIM_B vec3(1.0, 0.4, 0.9)
vec3 fxA(vec2 p, float shade) {
  float t = uTime;
  vec2 w = p + vec2(fbm(p * 2.0 + t * 0.1), fbm(p * 2.0 - t * 0.12)) * 0.15;
  vec3 col = mix(vec3(0.0, 0.08, 0.25), vec3(0.0, 0.45, 0.7),
                 smoothstep(0.0, 1.0, p.y + fbm(w * 3.0) * 0.3 - 0.2));
  col += vec3(0.5, 0.95, 1.0) * caustics(w, t) * 0.7;
  col += vec3(0.85, 0.95, 1.0) * bubbles(p, t);
  return col * mix(1.0, shade, 0.6);
}
vec3 fxB(vec2 p, float shade) {
  float t = uTime;
  float n = fbm(p * 3.0 + vec2(0.0, t * 0.3));
  float tend = pow(0.5 + 0.5 * sin(p.x * 28.0 + n * 7.0 + sin(p.y * 6.0 - t * 1.5) * 1.2), 10.0);
  float pulse = 0.55 + 0.45 * sin(t * 2.2 - p.y * 5.0);
  vec3 glow = mix(vec3(1.0, 0.25, 0.85), vec3(0.2, 0.95, 1.0), smoothstep(0.3, 0.7, fbm(p * 1.5 - t * 0.1)));
  vec3 col = vec3(0.02, 0.0, 0.08) + glow * (tend * pulse * 1.4 + n * 0.35 * pulse);
  float h = hash(floor(p * 40.0));
  col += glow * step(0.97, h) * smoothstep(0.35, 0.0, length(fract(p * 40.0) - 0.5))
       * (0.5 + 0.5 * sin(t * 5.0 + h * 50.0)) * 1.5;
  return col * mix(1.0, shade, 0.3);
}`,
  },
  {
    name: 'Sunken Treasure',
    chars: ['Cursed Gold', 'Black Pearl'],
    glsl: `
#define RIM_A vec3(1.0, 0.8, 0.3)
#define RIM_B vec3(0.9, 0.8, 1.0)
vec3 fxA(vec2 p, float shade) {
  float t = uTime;
  vec3 v = voronoi(p * 11.0, 0.0);
  float coin = smoothstep(0.42, 0.38, v.x);
  float ring = smoothstep(0.29, 0.32, v.x) * (1.0 - smoothstep(0.35, 0.38, v.x));
  vec3 gold = vec3(1.0, 0.76, 0.25);
  vec3 col = mix(vec3(0.3, 0.17, 0.02), gold * (0.7 + 0.3 * v.z + 0.6 * (0.3 - v.x)), coin);
  col += gold * ring * 0.45;
  float glint = pow(max(0.0, sin((p.x - p.y) * 4.0 - t * 2.5 + v.z * 3.0)), 24.0);
  col += vec3(1.0, 0.95, 0.7) * glint * coin;
  col += vec3(1.0) * step(0.9, v.z) * pow(0.5 + 0.5 * sin(t * 4.0 + v.z * 40.0), 8.0) * smoothstep(0.15, 0.0, v.x);
  return col * mix(1.0, shade, 0.7);
}
vec3 fxB(vec2 p, float shade) {
  float t = uTime;
  float n = fbm(p * 2.5 + t * 0.05);
  float k = n * 2.0 + shade * 0.8 + p.y * 0.6 + t * 0.15;
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (k + vec3(0.0, 0.33, 0.67)));
  vec3 col = mix(vec3(0.08, 0.07, 0.12), irid, 0.55);
  col += pow(fbm(p * 4.0 - t * 0.1), 3.0) * 0.9;
  return col * mix(1.0, shade, 0.8);
}`,
  },
  {
    name: 'Ghost Ship',
    chars: ['Ghost Pirate', 'Drowned Sailor'],
    glsl: `
#define RIM_A vec3(0.3, 1.0, 0.7)
#define RIM_B vec3(0.3, 0.7, 0.5)
vec3 fxA(vec2 p, float shade) {
  float t = uTime;
  vec2 q = vec2(p.x * 3.0, p.y * 2.0 - t * 0.8);
  float flame = smoothstep(0.3, 0.7, fbm(q + fbm(q * 1.5 + t * 0.2) * 1.2));
  vec3 base = uHasPlate > 0.5 ? plateAt(gUv) * 0.5 : vec3(0.02, 0.18, 0.15);
  vec3 col = base + vec3(0.25, 1.0, 0.75) * flame * 1.2 + vec3(0.8, 1.0, 0.9) * pow(flame, 4.0);
  return col * mix(1.0, shade, 0.4);
}
vec3 fxB(vec2 p, float shade) {
  float t = uTime;
  vec3 col = mix(vec3(0.02, 0.08, 0.06), vec3(0.08, 0.25, 0.2), fbm(p * 3.0 + vec2(0.0, t * 0.1)));
  float s = sin(p.x * 9.0 + sin(p.y * 3.0 + t * 1.2) * 0.8 + fbm(p * 2.0) * 2.0);
  col = mix(col, vec3(0.15, 0.4, 0.12), smoothstep(0.75, 0.95, s) * 0.8);
  col += vec3(0.6, 0.9, 0.8) * bubbles(p, t) * 0.8;
  col += vec3(0.3, 0.6, 0.5) * caustics(p * 0.7, t * 0.6) * 0.25;
  return col * mix(1.0, shade, 0.6);
}`,
  },
  {
    name: 'Kraken & Siren',
    chars: ['Kraken', 'Siren'],
    glsl: `
#define RIM_A vec3(1.0, 0.3, 0.5)
#define RIM_B vec3(0.3, 1.0, 0.9)
vec3 fxA(vec2 p, float shade) {
  float t = uTime;
  vec2 w = p + 0.08 * vec2(sin(p.y * 4.0 + t), cos(p.x * 4.0 + t * 0.8));
  vec3 col = mix(vec3(0.35, 0.03, 0.25), vec3(0.75, 0.12, 0.15), fbm(w * 3.0));
  vec3 v = voronoi(w * 9.0, 0.0);
  float has = step(0.2, v.z);
  float cup = smoothstep(0.32, 0.28, v.x) * has;
  col = mix(col, vec3(0.95, 0.6, 0.65), cup * smoothstep(0.12, 0.2, v.x) * 0.8);
  col = mix(col, vec3(0.2, 0.0, 0.1), cup * (1.0 - smoothstep(0.1, 0.16, v.x)));
  col += vec3(1.0, 0.8, 0.9) * pow(fbm(w * 8.0 + t * 0.3), 5.0) * 1.5;
  return col * mix(1.0, shade, 0.8);
}
vec3 fxB(vec2 p, float shade) {
  float t = uTime;
  vec2 q = p * vec2(9.0, 12.0);
  float row = floor(q.y);
  q.x += mod(row, 2.0) * 0.5;
  vec2 f = fract(q);
  float col_ = floor(q.x);
  float d = length(f - vec2(0.5, 1.0));
  if (d > 0.72) {
    // belongs to the overlapping scale of the row below
    row -= 1.0;
    col_ += f.x < 0.5 ? -0.5 : 0.5;
    d = min(length(f), length(f - vec2(1.0, 0.0)));
  }
  float edge = smoothstep(0.58, 0.72, d);
  float hue = 0.5 + 0.5 * sin(row * 0.6 + col_ * 1.3 + t * 1.2 + p.x * 2.0);
  vec3 col = mix(vec3(0.0, 0.65, 0.6), vec3(0.45, 0.2, 0.85), hue);
  col *= 0.7 + 0.5 * (1.0 - d);
  col = mix(col, vec3(0.02, 0.1, 0.15), edge * 0.75);
  col += vec3(1.0, 0.9, 0.6) * pow(max(0.0, sin(p.x * 3.0 + p.y * 2.0 - t * 2.0)), 16.0) * (1.0 - edge) * 0.6;
  return col * mix(1.0, shade, 0.7);
}`,
  },
  {
    name: 'Storm',
    chars: ['Rogue Wave', 'Thunderhead'],
    glsl: `
#define RIM_A vec3(0.7, 0.95, 1.0)
#define RIM_B vec3(0.6, 0.6, 1.0)
vec3 fxA(vec2 p, float shade) {
  float t = uTime;
  float v = p.y * 7.0 + sin(p.x * 2.5 + t * 1.3) * 0.8 + fbm(p * 2.0 + vec2(t * 0.2, 0.0)) * 2.0 - t * 0.6;
  float band = fract(v);
  vec3 col = mix(vec3(0.0, 0.1, 0.25), vec3(0.0, 0.5, 0.6), band);
  float foam = smoothstep(0.82, 0.97, band) * (0.6 + 0.4 * fbm(p * 12.0 + t));
  col = mix(col, vec3(0.92, 0.98, 1.0), foam);
  col += vec3(0.8, 0.95, 1.0) * step(0.995, hash(floor(p * 80.0) + floor(t * 8.0))) * 0.8;
  return col * mix(1.0, shade, 0.6);
}
vec3 fxB(vec2 p, float shade) {
  float t = uTime;
  float clouds = fbm(p * 2.5 + vec2(t * 0.15, t * 0.05) + fbm(p * 3.0 - t * 0.1));
  float slot = floor(t * 1.5);
  float ph = fract(t * 1.5);
  float flash = step(0.7, hash(vec2(slot, 3.1))) * exp(-ph * 6.0) * (0.7 + 0.3 * step(0.5, fract(ph * 12.0)));
  float x0 = hash(vec2(slot, 7.7)) * uRes.x / uRes.y;
  float jag = (fbm(vec2(p.y * 6.0, slot)) - 0.5) * 0.35 + (noise(vec2(p.y * 30.0, slot)) - 0.5) * 0.05;
  float bolt = exp(-abs(p.x - x0 - jag) * 90.0) * flash;
  vec3 col = mix(vec3(0.05, 0.05, 0.12), vec3(0.35, 0.35, 0.5), clouds);
  col += vec3(0.6, 0.65, 1.0) * flash * clouds * 0.9;
  col += vec3(0.85, 0.9, 1.0) * bolt * 2.0;
  return col * mix(1.0, shade, 0.5);
}`,
  },
  {
    name: 'Reef',
    chars: ['Coral', 'Lagoon'],
    glsl: `
#define RIM_A vec3(1.0, 0.5, 0.4)
#define RIM_B vec3(0.4, 1.0, 0.9)
vec3 fxA(vec2 p, float shade) {
  float t = uTime;
  vec2 w = p * 3.5 + vec2(sin(t * 0.6 + p.y * 3.0) * 0.12, 0.0);
  float coral = smoothstep(0.42, 0.52, fbm(w + fbm(w * 1.3) * 1.6));
  vec3 cc = mix(vec3(1.0, 0.42, 0.4), vec3(1.0, 0.72, 0.25), smoothstep(0.4, 0.7, fbm(p * 1.5)));
  cc = mix(cc, vec3(0.65, 0.2, 0.65), smoothstep(0.55, 0.75, fbm(p * 1.2 + 5.0)));
  float polyp = smoothstep(0.25, 0.1, voronoi(p * 25.0, 0.0).x);
  vec3 col = mix(vec3(0.0, 0.25, 0.4), cc * (0.8 + 0.4 * polyp), coral);
  col += vec3(0.8, 1.0, 1.0) * caustics(p, t) * 0.2;
  return col * mix(1.0, shade, 0.7);
}
vec3 fxB(vec2 p, float shade) {
  float t = uTime;
  float ripple = sin(p.y * 22.0 + fbm(p * 3.0) * 5.0) * 0.5 + 0.5;
  vec3 turq = vec3(0.1, 0.85, 0.8);
  vec3 col = mix(turq, mix(turq, vec3(0.95, 0.85, 0.6), 0.45), ripple * 0.6);
  col += caustics(p * 1.2, t * 1.2) * 0.45;
  float h = hash(floor(p * 60.0) + floor(t * 3.0));
  col += vec3(1.0, 1.0, 0.85) * step(0.993, h) * smoothstep(0.4, 0.0, length(fract(p * 60.0) - 0.5)) * 2.0;
  return col * mix(1.0, shade, 0.6);
}`,
  },
  {
    name: "Captain's Log",
    chars: ['Treasure Map', "Ship's Hull"],
    glsl: `
#define RIM_A vec3(0.6, 0.35, 0.1)
#define RIM_B vec3(0.5, 0.3, 0.15)
vec3 fxA(vec2 p, float shade) {
  float t = uTime;
  vec3 col = vec3(0.87, 0.75, 0.52) * (0.75 + 0.35 * fbm(p * 5.0));
  col *= 1.0 - 0.35 * smoothstep(0.55, 0.8, fbm(p * 3.0 + 2.0));
  float c = fract(fbm(p * 1.8) * 9.0);
  col = mix(col, vec3(0.3, 0.18, 0.08), (1.0 - smoothstep(0.0, 0.06, min(c, 1.0 - c))) * 0.7);
  float dist = abs(p.y - 0.5 - 0.2 * sin(p.x * 3.0));
  float trail = (1.0 - smoothstep(0.004, 0.01, dist)) * step(0.5, fract(p.x * 8.0 - t * 0.5));
  vec2 cell = floor(p / 0.6);
  vec2 f = fract(p / 0.6) - 0.5;
  float x = (1.0 - smoothstep(0.02, 0.04, min(abs(f.x - f.y), abs(f.x + f.y))))
          * step(max(abs(f.x), abs(f.y)), 0.15) * step(0.6, hash(cell));
  vec3 red = vec3(0.7, 0.08, 0.05) * (0.8 + 0.4 * sin(t * 3.0));
  col = mix(col, red, max(trail, x));
  return col * mix(1.0, shade, 0.7);
}
vec3 fxB(vec2 p, float shade) {
  float t = uTime;
  float pl = p.y * 6.0;
  float id = floor(pl), fy = fract(pl);
  float grain = fbm(vec2(p.x * 1.5 + id * 13.0, pl * 8.0));
  vec3 col = mix(vec3(0.3, 0.17, 0.08), vec3(0.55, 0.35, 0.18), grain) * (0.85 + 0.3 * hash(vec2(id, 1.0)));
  col *= mix(0.25, 1.0, smoothstep(0.0, 0.05, fy) * smoothstep(1.0, 0.95, fy));
  float jf = fract(p.x * 1.2 + hash(vec2(id, 2.0)) * 3.0);
  col *= mix(0.3, 1.0, smoothstep(0.0, 0.015, jf) * smoothstep(1.0, 0.985, jf));
  float nail = smoothstep(0.012, 0.007, length(vec2((jf - 0.04) / 1.2, (fy - 0.5) / 6.0)));
  col = mix(col, vec3(0.15, 0.15, 0.17), nail);
  vec3 v = voronoi(p * 14.0, 0.0);
  float barn = step(0.85, v.z) * smoothstep(0.3, 0.2, v.x);
  col = mix(col, vec3(0.75, 0.75, 0.7) * (0.7 + 0.5 * smoothstep(0.05, 0.2, v.x)), barn);
  col += vec3(0.4, 0.5, 0.5) * pow(max(0.0, sin(p.x * 2.0 - p.y + t)), 30.0) * 0.3;
  return col * mix(1.0, shade, 0.8);
}`,
  },
  {
    name: 'Vanish',
    chars: ['Invisible', 'Phantom'],
    needsPlate: true,
    glsl: `
#define RIM_A vec3(0.0)
#define RIM_B vec3(0.15, 0.4, 0.5)
vec3 fxA(vec2 p, float shade) {
  if (uHasPlate < 0.5) return vec3(0.0, 0.1, 0.2) + vec3(0.4, 0.8, 1.0) * caustics(p, uTime) * 0.5;
  return plateAt(gUv);
}
vec3 fxB(vec2 p, float shade) {
  float t = uTime;
  vec2 off = vec2(sin(p.y * 25.0 + t * 3.0), cos(p.x * 22.0 + t * 2.5)) * 0.006;
  vec3 c = uHasPlate > 0.5 ? plateAt(gUv + off) : vec3(0.0, 0.1, 0.2);
  c = mix(c, c * vec3(0.7, 1.0, 1.1) + vec3(0.0, 0.06, 0.08), 0.6);
  c += vec3(0.6, 0.9, 1.0) * caustics(p * 1.3, t) * 0.15;
  return c;
}`,
  },
];

export function fragmentFor(scene) {
  return HEADER + LIB + scene.glsl + MAIN;
}

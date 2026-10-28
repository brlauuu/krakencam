# Kraken Cam

A camera filter for green-suit Halloween costumes. Point your phone at people in green suits and the suits turn into animated sea and pirate effects, with a different character for each person. You can take a photo and share it straight to WhatsApp or any other app.

It runs in the browser as a PWA, so there's nothing to install from an app store. It works on Android (Chrome) and iPhone (Safari).

**Live:** https://kraken-cam-nine.vercel.app

## Using it

### First time

1. Open the link on your phone and tap **Start camera**. Allow camera access.
2. Optional: in the browser menu, tap **Add to Home Screen**. It then opens full-screen like a normal app and still works on bad Wi-Fi.
3. Calibrate (this starts automatically the first time):
   - Tap the **first** person's suit.
   - Tap the **second** person's suit.
   - If both suits are the same shade, tap **Same green — split left/right** instead. The left half of the screen becomes character 1 and the right half character 2. Drag the gold line to move the split.

The app remembers the calibration. Recalibrate with **◎** whenever the lighting changes, for example when you move to another room.

### Controls

| Control | What it does |
|---|---|
| Swipe left/right, or ◀ ▶ | Next/previous scene |
| Big round button | Take a photo |
| ◎ | Recalibrate the suits |
| ⚙ | Settings |

After taking a photo, tap **Share** to send it to WhatsApp, Instagram etc., **Save** to download it, or **Back** to discard it. Photos aren't stored anywhere unless you save them.

### Scenes

| Scene | Character 1 | Character 2 |
|---|---|---|
| Deep Blue | Sea Spirit | Jellyfish |
| Sunken Treasure | Cursed Gold | Black Pearl |
| Ghost Ship | Ghost Pirate | Drowned Sailor |
| Kraken & Siren | Kraken | Siren |
| Storm | Rogue Wave | Thunderhead |
| Reef | Coral | Lagoon |
| Captain's Log | Treasure Map | Ship's Hull |
| Vanish | Invisible | Phantom |

**Vanish needs a tripod.** Tap the gold "capture background" button (or Settings → *Capture background*), step out of the frame during the 3-second countdown, then step back in. Don't move the phone afterwards. If you do, capture the background again.

### Settings

- **Green tolerance**: raise it if bits of the suit show through; lower it if things that aren't the suit (green decorations, other people's clothes) turn into effects.
- **Edge softness**: how gradually the effect fades out at the edge of the suit.
- **Green spill cleanup**: removes the green glow the suit casts on skin and hands.
- **Who is who**: *by suit colour* (two different greens) or *left/right split* (same green).
- **Show mask**: troubleshooting view. Red = character 1, blue = character 2. Everything that should be suit should be coloured.
- **High resolution**: sharper photos, but slower on older phones.
- **Swap characters**, **Flip camera** (front/back).
- **Lock exposure**: stops the camera from changing brightness and colour while you move, which keeps the green steady. Not every phone supports it.
- **Reset sliders**.

### Tips for a clean effect

- Light matters most. Even, bright light on the suits works best; dim, coloured party lighting makes green look grey or brown.
- Calibrate under the same light you'll be using.
- Tap a well-lit part of the suit when calibrating, not a shadow or fold.
- If the effect flickers while you move, try **Lock exposure** after calibrating.
- Use the back camera for the best quality. The front camera works too, and its image is mirrored like a selfie view.

## Running locally

Plain HTML/JS/WebGL with no build step and no dependencies. Serve the folder with any static server:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

Browsers only allow the camera on `https://` or `localhost`, so opening the page from another device over plain `http://` on your local network won't work. To test on a phone, deploy it (below) or use Chrome remote debugging with port forwarding.

**Test mode:** open http://localhost:8000/?test to use a fake camera with two animated green figures. Useful for working on effects without a webcam or suits.

## Deployment

The repo is connected to Vercel: every push to `main` deploys to https://kraken-cam-nine.vercel.app. There's no build step; Vercel serves the files as they are.

To deploy manually from a linked checkout:

```sh
vercel deploy --prod
```

## How it works

| File | Purpose |
|---|---|
| `index.html` | Page layout, UI and styles |
| `app.js` | Camera, calibration, gestures, photo/share, settings, WebGL setup and render loop |
| `shaders.js` | GLSL: chroma keying and compositing, noise helpers, and the 8 scenes |
| `sw.js` | Service worker: network first, falls back to the cache when offline |
| `manifest.webmanifest`, `icon*` | PWA install metadata and icons |

Each camera frame is uploaded to a WebGL texture. A fragment shader:

1. converts every pixel to YCbCr and measures its colour distance from the two calibrated suit colours,
2. builds a smoothed mask for each character (by nearest colour, or by which side of the split line it's on),
3. draws that character's procedural effect inside the mask, keeping the suit's shading so folds and body shape still show,
4. adds a coloured rim light along the edges and removes green spill from the rest of the picture.

Settings and calibration are saved in `localStorage`.

### Adding a scene

Add an entry to `SCENES` in `shaders.js`:

```js
{
  name: 'My Scene',
  chars: ['Character 1', 'Character 2'],
  glsl: `
#define RIM_A vec3(1.0, 0.5, 0.0)
#define RIM_B vec3(0.0, 0.5, 1.0)
vec3 fxA(vec2 p, float shade) { return vec3(1.0, 0.4, 0.0) * shade; }
vec3 fxB(vec2 p, float shade) { return vec3(0.0, 0.4, 1.0) * shade; }`,
},
```

`p` is the screen position (y goes 0–1, x is scaled by the aspect ratio), and `shade` is the suit's brightness relative to the calibrated colour. You can use `uTime`, `fbm`, `noise`, `voronoi`, `caustics` and `bubbles` from the shared library. It appears in the scene list automatically. Use `?test` to check it.

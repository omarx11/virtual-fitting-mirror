# Virtual Fitting Mirror (prototype)

A free, local, browser-based "mirror": pick a shirt and see it on a person in a video or a webcam
feed. Pose tracking uses Google's MediaPipe Pose Landmarker. The default shirt is a **rigged 3D
model** (Three.js): its torso and sleeves deform together through its skeleton, driven live by the
tracked person's shoulders, hips, elbows and wrists. An experimental **fabric motion** mode adds
bounded cloth simulation (Jolt Physics, WASM) on top. The original flat 2D demo shirts remain as a
legacy comparison.

It runs entirely on your computer, with no account, server, paid API or model training. It is an
approximate **visual preview**, not accurate body measurement, a sizing tool or a photorealistic
clothing replacement: your own clothes can show at the edges — see
[docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Requirements

- Windows 10/11 (also works on macOS/Linux)
- **Node.js 22.12+ or 24** (tested with Node 24.19.0 / npm 11.17.0)
- A Chromium-based browser (Chrome or Edge). It was tested in Chrome 153; other browsers are
  untested.
- Internet only for the first setup: npm packages, plus ~15 MB of model files

## Setup (PowerShell)

```powershell
cd path\to\virtual-fitting-mirror-feasibility
npm ci                    # installs the exact versions from package-lock.json
npm run setup:assets      # downloads + SHA-256-verifies the pose models into public\models
npm run dev               # starts http://localhost:5173 (setup:assets also runs automatically)
```

Then open the printed `http://localhost:…` address in Chrome.

If port 5173 is already in use, Vite picks another port; use the address it prints. Or choose one:
`npm run dev -- --port 5180`.

Production build:

```powershell
npm run build
npm run preview           # serves dist\ at http://localhost:4173
```

## Using it

1. **Load a video:** click **Open a video file** and choose an MP4 (H.264) or WebM (VP8/VP9) clip of
   a person facing the camera. The file is read locally through the browser and is never uploaded.
   Portrait and landscape videos both work, and the image is never stretched.
2. **Or use a webcam:** click **Use camera**. The browser asks for camera permission only at that
   point; the microphone is never requested. Camera access works on `http://localhost`; from any
   other address the page must be served over HTTPS.
3. **Pick a shirt:** click a thumbnail, or press `[` / `]`. **V-neck (3D)** (default) is the rigged 3D
   model; choose a fabric colour below the thumbnails. The other four are flat 2D demo images.
   Switching never reloads the tracker, and works while playing or paused.
4. **Adjust fit:** **Size** and **Height** sliders; **Reset fit** restores the defaults.
5. **View:** toggle **Shirt**, **Mirror** (flips video and shirt together), **Fullscreen**
   (good for a vertical kiosk screen), and **Framing** (show the whole video or fill the screen).
   **Arms in front (beta)** redraws forearms that are in front of the body over the shirt
   (depth-gated, soft-edged, approximate). **Fabric motion (beta)** (3D shirt only) adds bounded
   cloth movement at the hem and sleeves; skeletal tracking stays the driver.
6. **Playback:** play/pause, restart, loop, speed, and the seek bar.
7. **Diagnostics** (bottom of the panel, or press `D`): landmarks overlay (with the garment's
   shoulder anchors in magenta as a registration check), tracking phase, visibilities,
   video/render/inference rates, inference time, frame→pose latency, pose age, model, delegate, a
   Quality (Lite/Full model) and Delegate (GPU/CPU) selector, and — for the 3D shirt — render and
   copy time, render size, triangles, orientation/yaw, arm state, cloth solver state, cost, resets
   and developer tuning sliders.

Status messages on the video: **Tracking**, **Upper-body view** (hips out of frame),
**Move back slightly**, **Face the mirror** (side/back view or bending), **Step into view**,
**Tracking lost**, or a tracking error with **Retry**.

Keyboard: `Space` play/pause · `[` `]` previous/next shirt · `G` shirt on/off · `M` mirror ·
`F` fullscreen · `D` diagnostics. All controls are reachable with `Tab`.

**Best results:** a single person facing the camera, with the head and both shoulders visible,
even lighting, roughly 1–3 m away. Chest-up framing is supported. The 3D shirt follows modest turns
(it fades from ~50° and hides beyond ~72°); back and extreme side views stay hidden.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (React Strict Mode on) |
| `npm run build` / `npm run preview` | Type-check + production build / serve the build |
| `npm run typecheck` | `tsc -b` (strict) |
| `npm run lint` / `npm run format` | Biome lint+format check / format files |
| `npm test` | Vitest unit tests (geometry, fit, smoothing, state machine, scheduler) |
| `npm run test:e2e` | Playwright browser tests (uses its own server on port 5174) |
| `npm run test:e2e:preview` | Build, then run the asset-path/privacy/3D browser tests against `vite preview` (port 4174) |
| `npm run inspect:garment` | Print the V-neck GLB's full node hierarchy, joints and bind positions |
| `npm run generate:3d-thumbnail` | Render `public/garments/3d/vneck/preview.png` from the actual model |
| `npm run check` | typecheck + lint + unit tests + build |
| `npm run setup:assets` | Download/verify the models (`-- --check` to only verify) |
| `npm run generate:garments` | Regenerate the demo shirt SVGs |
| `npm run fetch:footage` | Download the openly licensed test clips (not committed) + derive crops with ffmpeg |

First-time Playwright setup, only if Chromium isn't installed yet: `npx playwright install chromium`.

**Privacy:** video is never uploaded, and the app blocks **all** outgoing requests, including the
usage metrics MediaPipe would otherwise send to Google. It does this in two ways:
- a local-only `fetch` guard in the page and in the tracking worker, which works on any host;
- a `Content-Security-Policy: connect-src 'self'` rule, sent as a `<meta>` tag and as a dev/preview
  server header.

If you host `dist\` on another web server, the fetch guard and the meta tag are already included in
the build. For a second layer inside the worker, configure the server to also send the header
`Content-Security-Policy: connect-src 'self' ws: wss: blob: data:`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Tracking model file not found … run npm run setup:assets" | Run `npm run setup:assets`, then press **Retry**. Behind a proxy, download the two URLs in `scripts/setup-assets.mjs` into `public\models\` by hand; the script verifies them. |
| "This browser cannot play this file's format or codec" | Re-encode to H.264 MP4: `ffmpeg -i in.mov -c:v libx264 -pix_fmt yuv420p out.mp4`, or use HandBrake. HEVC/H.265 and some phone formats may not play in every browser. |
| Camera: "permission was denied" | Click the camera icon left of the address bar → Allow, then **Use camera** again. Windows: Settings → Privacy & security → Camera → allow desktop apps and the browser. |
| Camera: "in use by another application" | Close Teams/Zoom/OBS or other apps using the webcam. |
| Camera: "needs a secure page" | Use `http://localhost:…` on the same PC, or serve over HTTPS for remote devices. |
| "Face the mirror" all the time | Face the camera with your face visible; side and back views are intentionally hidden. |
| Shirt too high/low or too big | Use the Size/Height sliders. For a permanent change, edit `fit` in `src/garments/catalogue.ts` (2D) or `src/garments/rigs/vneck.ts` (3D). |
| "3D shirt unavailable" | WebGL could not start (check hardware acceleration) or the GLB is missing; press **Retry**. In `npm run dev` a flat 2D image is shown instead and labelled as such; production shows no garment. |
| Fabric motion shows "disabled" in Diagnostics | The solver exceeded its time budget on this PC; skeletal motion continues. |
| Slow or jerky | Open Diagnostics. If the delegate is CPU or the backend is main-thread, check that hardware acceleration is on (Chrome → Settings → System). Try Quality: Fast (Lite model). |
| Note "Worker tracking failed … main thread" | The browser could not run the worker path; the app still works at a reduced rate. |
| `npm ci` fails on Node < 22.12 | Install Node 24 LTS from nodejs.org (or `winget install OpenJS.NodeJS.LTS`). |

## Project layout

```text
src/app/          engine (non-React core), hooks, low-rate state, preferences
src/components/   controls, catalogue, status, diagnostics
src/media/        file/camera sources, frame loop (requestVideoFrameCallback)
src/tracking/     worker protocol, MediaPipe engine, backends, scheduler
src/fitting/      landmark trust, tracking state machine, smoothing, 2D fit; 3D: pose3d (frames,
                  coordinate conventions), fit3d (estimator, smoothing, placement), retargeter,
                  occlusion (forearm cutouts)
src/rendering/    matrices, view transform (letterbox/DPR/mirror), canvas compositor
src/rendering/three/  GarmentRenderer (WebGL layer), CPU skinning for the cloth mode
src/garments/     catalogue (2D | 3D union), image preloading, modelLoader (GLB + rig repair),
                  rigModel, rigs/*.ts (per-asset rig, calibration and simulation config)
src/physics/      cloth mode: proxy builder, Jolt world, body colliders, ClothSimulation (lazy-loaded)
src/inspect/      development-only 3D inspection view (/?inspect=3d)
src/config/       documented thresholds, quality presets, 3D render settings
public/garments/  demo shirt art (CC0) + anchors (LICENSE.md); 3d/vneck/ runtime GLB (third-party)
assets/garments/  authoring sources (FBX), SOURCE.md — never shipped by Vite
public/models/    pose models (downloaded, not committed)
scripts/          setup-assets.mjs, generate-garments.mjs, inspect-garment.mjs, generate-3d-thumbnail.mjs
tests/unit, tests/e2e, tests/fixtures
docs/             RESEARCH, IMPLEMENTATION_PLAN, TESTING, LIMITATIONS
spike.html        standalone worker/delegate timing check (dev server: /spike.html)
```

## How the 3D shirt works

1. The pose worker returns, for every detected person, the normalized **image** landmarks and the
   **world** landmarks from the same result index, so one person's 3D pose can never be paired with
   another's image pose.
2. The existing interpreter selects the subject and decides whether the pose is usable (modest
   turns are allowed for 3D garments only).
3. `fit3d` turns the matched landmarks into a garment pose using weak perspective:
   - body orientation comes from the world landmarks, rolled about the view axis so the projected
     shoulders match the image;
   - position comes from the image shoulder midpoint;
   - scale is image length divided by projected world length.

   It then applies time-aware smoothing, with quaternion slerp, bounded angular speed, and a
   hold → neutral fallback for missing arms.
4. The `retargeter` converts that pose into parent-local bone rotations from the bind pose every frame.
5. `GarmentRenderer` draws the skinned model into its own transparent WebGL canvas (orthographic,
   source-pixel space). The 2D compositor draws it with the **same source→canvas transform as the
   video**, so mirroring, cropping, letterboxing and DPR apply exactly once. Forearm cutouts and
   diagnostics are drawn after it.
6. With **Fabric motion** on, a ~1,000-particle proxy of the real shirt topology is simulated by
   Jolt (pinned at the neck and shoulders, free at the hem and sleeves, with body capsules). Its
   displacement is added to CPU-skinned vertices, so nothing is skinned twice.

Details and coordinate conventions: [docs/RESEARCH.md](docs/RESEARCH.md).

## Adding another 3D garment

1. Put the runtime `.glb` (one skinned mesh) under `public/garments/3d/<id>/` and authoring files
   under `assets/garments/<id>/source/`; write `assets/garments/<id>/SOURCE.md` (licence, hashes).
2. Run `node scripts/inspect-garment.mjs <file.glb>` to see joint names, bind positions and axes.
3. Create `src/garments/rigs/<id>.ts` using `vneck.ts` as the template:
   - bone-name patterns;
   - `restRotationDeg`, only if the model is not +Y up / +X wearer's left / +Z front;
   - fit calibration, pose limits, clavicle lift;
   - optionally a simulation config.
4. Add a `kind: '3d'` entry to `GARMENTS` in `src/garments/catalogue.ts`, with fabric options, and
   generate a thumbnail. Check it in `/?inspect=3d` (dev server) and on footage with the landmark
   overlay. No renderer changes are needed.

## Licences

App code: yours to choose (no licence file added). Dependencies: MIT / ISC / Apache-2.0 (see
[docs/RESEARCH.md](docs/RESEARCH.md)). The pose models are Apache-2.0 (MediaPipe model card). Demo
2D garments: CC0 (original). **The 3D V-neck is third-party content from Fab** under its own licence
(not CC0); see [assets/garments/vneck/SOURCE.md](assets/garments/vneck/SOURCE.md) before
redistributing or deploying it. The test footage is third-party, CC BY/BY-SA, and not committed —
see [test-footage/SOURCES.md](test-footage/SOURCES.md).

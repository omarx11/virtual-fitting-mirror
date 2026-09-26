# Virtual Fitting Mirror (prototype)

A free, local, browser-based "mirror": pick a shirt and see it overlaid on a person in a video or a
webcam feed. Pose tracking uses Google's MediaPipe Pose Landmarker; the shirt is a 2D image
positioned from the shoulders (and hips when visible) and drawn on a canvas.

It runs entirely on your computer, with no account, server, paid API or model training. It is an
approximate **2D preview**, not a realistic try-on or a sizing tool — see
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
3. **Pick a shirt:** click a thumbnail, or press `[` / `]`. Switching never reloads the tracker, and
   works while playing or paused.
4. **Adjust fit:** **Size** and **Height** sliders; **Reset fit** restores the defaults.
5. **View:** toggle **Shirt**, **Mirror** (flips video and shirt together), **Fullscreen**
   (good for a vertical kiosk screen), and **Framing** (show the whole video or fill the screen).
   **Arms in front (beta)** is an experimental option that redraws forearms over the shirt.
6. **Playback:** play/pause, restart, loop, speed, and the seek bar.
7. **Diagnostics** (bottom of the panel, or press `D`): landmarks overlay, tracking phase,
   visibilities, video/render/inference rates, inference time, frame→pose latency, pose age, model,
   delegate, and a Quality (Lite/Full model) and Delegate (GPU/CPU) selector.

Status messages on the video: **Tracking**, **Upper-body view** (hips out of frame),
**Move back slightly**, **Face the mirror** (side/back view or bending), **Step into view**,
**Tracking lost**, or a tracking error with **Retry**.

Keyboard: `Space` play/pause · `[` `]` previous/next shirt · `G` shirt on/off · `M` mirror ·
`F` fullscreen · `D` diagnostics. All controls are reachable with `Tab`.

**Best results:** a single person facing the camera, with the head and both shoulders visible,
even lighting, roughly 1–3 m away. Chest-up framing is supported.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (React Strict Mode on) |
| `npm run build` / `npm run preview` | Type-check + production build / serve the build |
| `npm run typecheck` | `tsc -b` (strict) |
| `npm run lint` / `npm run format` | Biome lint+format check / format files |
| `npm test` | Vitest unit tests (geometry, fit, smoothing, state machine, scheduler) |
| `npm run test:e2e` | Playwright browser tests (uses its own server on port 5174) |
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
| Shirt too high/low or too big | Use the Size/Height sliders. For a permanent change, edit `fit` in `src/garments/catalogue.ts`. |
| Slow or jerky | Open Diagnostics. If the delegate is CPU or the backend is main-thread, check that hardware acceleration is on (Chrome → Settings → System). Try Quality: Fast (Lite model). |
| Note "Worker tracking failed … main thread" | The browser could not run the worker path; the app still works at a reduced rate. |
| `npm ci` fails on Node < 22.12 | Install Node 24 LTS from nodejs.org (or `winget install OpenJS.NodeJS.LTS`). |

## Project layout

```text
src/app/          engine (non-React core), hooks, low-rate state, preferences
src/components/   controls, catalogue, status, diagnostics
src/media/        file/camera sources, frame loop (requestVideoFrameCallback)
src/tracking/     worker protocol, MediaPipe engine, backends, scheduler
src/fitting/      landmark trust, tracking state machine, smoothing, garment fit
src/rendering/    matrices, view transform (letterbox/DPR/mirror), canvas compositor
src/garments/     catalogue types/definitions, image preloading
src/config/       documented thresholds and quality presets
public/garments/  demo shirt art (CC0) + anchors (LICENSE.md)
public/models/    pose models (downloaded, not committed)
scripts/          setup-assets.mjs, generate-garments.mjs
tests/unit, tests/e2e, tests/fixtures
docs/             RESEARCH, IMPLEMENTATION_PLAN, TESTING, LIMITATIONS
spike.html        standalone worker/delegate timing check (dev server: /spike.html)
```

## Licences

App code: yours to choose (no licence file added). Dependencies: MIT / ISC / Apache-2.0 (see
[docs/RESEARCH.md](docs/RESEARCH.md)). The pose models are Apache-2.0 (MediaPipe model card). Demo
garments: CC0 (original). The test footage is third-party, CC BY/BY-SA, and not committed —
see [test-footage/SOURCES.md](test-footage/SOURCES.md).

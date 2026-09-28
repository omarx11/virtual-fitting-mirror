# Virtual Fitting Mirror (prototype)

A graduation project at **Qassim University**, designed and built by **Lamya**.

A free, local, browser-based "mirror": pick a shirt and see it on a person in a video or a webcam
feed. Pose tracking uses Google's MediaPipe Pose Landmarker. The default shirt is a **rigged 3D
model** (Three.js): its torso and sleeves deform together through its skeleton, driven live by the
tracked person's shoulders, hips, elbows and wrists. An experimental **fabric motion** mode adds
bounded cloth simulation (Jolt Physics, WASM) on top. The original flat 2D demo shirts remain as a
legacy comparison.

A **2D / 3D / AI** selector picks the mode:

- **2D** and **3D** are live tracked previews. They run entirely on your computer, with no account,
  paid API or upload.
- **AI** (optional) is a **generated still photo**: capture a frame, choose a garment photo (dresses,
  jumpsuits and thobes, plus renders of the 3D V-neck), and a cloud try-on model (FASHN, paid per
  image) generates one picture to compare with the capture. It is not live. It needs an AI server
  (the small local Node server on a kiosk, or a Vercel Function online) that talks to FASHN with the
  operator's API key or a visitor's own key, and it uploads the captured photo only after the
  shopper agrees.

Every mode is an approximate **visual preview**, not body measurement or a sizing tool: your own
clothes can show at the edges in 2D/3D, and AI images can alter details — see
[docs/LIMITATIONS.md](docs/LIMITATIONS.md). A short visual summary of the research, testing and
limitations is in the app at **/research** (About → *Research, testing & limits*).

## Requirements

- Windows 10/11 (also works on macOS/Linux)
- **Node.js 22.12+ or 24** (tested with Node 24.19.0 / npm 11.17.0)
- A Chromium-based browser (Chrome or Edge). It was tested in Chrome 153; other browsers are
  untested.
- Internet for the first setup (npm packages, ~15 MB of model files), and for AI mode

## Setup (PowerShell)

```powershell
cd path\to\virtual-fitting-mirror-feasibility
npm ci                    # installs the exact versions from package-lock.json
npm run setup:assets      # downloads + SHA-256-verifies the pose models into public\models
npm run dev               # web app on http://localhost:5173 + local API server on 127.0.0.1:3001
```

Then open `http://localhost:5173` in Chrome. `npm run dev` starts two processes: Vite (the web app,
which forwards `/api` to the backend) and the small Node backend in `server/`. 2D and 3D work even
if the backend is not running; `npm run dev:web` starts only Vite (its `/api` then answers "AI server
not running" instead of proxy errors, so the browser console stays clean).

If port 5173 is already in use, Vite picks another port; use the address it prints, and add that
origin to `AI_ALLOWED_ORIGINS` in `.env` (e.g. `http://localhost:5180`) so the backend accepts its
AI requests.

Production build (one origin for the app and the API):

```powershell
npm run build             # type-check, frontend (dist\) and server bundle (dist-server\)
npm start                 # serves dist\ and /api at http://127.0.0.1:3001
```

`npm run preview` still serves only the static `dist\` (2D/3D) at http://localhost:4173. Uploading
`dist\` alone to a static web host cannot run AI mode: the backend must serve the same origin
(`npm start`, or a reverse proxy that serves `dist\` and forwards `/api` to it). The backend has no
user accounts; keep it on `127.0.0.1` unless you add authentication and HTTPS. For a public online
version with AI (Redis + an access code), see [Deploying to Vercel](#deploying-to-vercel).

## AI mode setup (optional, paid)

1. Create a FASHN API account and buy API credits yourself (API credits are separate from FASHN's
   consumer app credits). On 2026-09-27 the
   [API pricing page](https://help.fashn.ai/plans-and-pricing/api-pricing) listed **$0.075 per
   on-demand credit** (minimum purchase $7.50 for 100 credits). The default preset, Try-On Max
   fast/1K with one output, costs **1 credit ≈ $0.075 per generated image**
   ([Try-On Max](https://docs.fashn.ai/api-reference/tryon-max)). Check current prices first.
2. Create the settings file **on this computer** and enter the key there:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

   Set `FASHN_API_KEY=<your key>`, then save (`AI_ENABLED` is `true` by default; `false` turns AI
   mode off completely). `.env` is git-ignored. Never put
   the key in a `VITE_*` variable, a screenshot, a ticket or a chat. Only the Node server reads it.

   The key is optional: with `AI_USER_KEYS=true` (the default) visitors can instead paste their own
   FASHN API key into the AI panel. The page checks it with FASHN, saves it in that browser's
   `localStorage` and sends it (header `X-FASHN-Key`) only with that visitor's AI requests; the server
   never stores or logs it. Those previews are paid by the visitor, so they need no access code and do
   not count against `AI_MAX_DAILY_CREDITS`. Set `AI_USER_KEYS=false` on a shared kiosk.
3. Restart `npm run dev` (or `npm start`). The server log prints `AI enabled` or why not, and the
   AI panel shows the same reason when AI is unavailable.

Spending limits (all enforced by the server; see `.env.example`):

- one output per explicit **Generate**, one active job per session, `AI_MAX_CONCURRENT_JOBS=1`;
- duplicate clicks and repeats of the same request are deduplicated; a submission is **never retried
  automatically**, and one whose outcome is unknown (timeout) stays counted;
- `AI_MAX_DAILY_CREDITS` credits per UTC day (e.g. `20`), recorded in `.ai-usage/ledger.json`
  (credit counts only, no images), which survives restarts. Leave it empty or unset for no daily
  cap (usage is still recorded; the FASHN balance is then the only limit); `0` blocks your key;
- the provider is never called while `AI_ENABLED=false`, or without a key (yours or the visitor's).

**Usage:** in AI mode, open **Diagnostics** (`D`) → **AI usage**: today's credits against the cap,
the FASHN account balance (read from FASHN's free `/v1/credits` endpoint, cached for a minute), and
a per-day history for the last 30 days (this computer only; kept 90 days in the local ledger). The
FASHN dashboard remains the official billing record.

To check the paid integration once, with ONE approved photo pair and one output:

```powershell
npm run smoke:ai -- --person path\to\approved-person.jpg --garment vneck-stone --confirm-paid-generation
```

Without `--confirm-paid-generation` it only prints what it would spend. It writes timings, image
dimensions and reported credits to `test-results\ai-smoke\`; add `--save-result <file>` to keep
the image for review. Optional comparison preset: `AI_EXTRA_PRESETS=v16-performance` (Try-On v1.6,
performance mode, 1 credit), selectable in Diagnostics.

## Using it

0. **Choose a mode** at the top of the panel: **2D**, **3D** (default) or **AI**. Each live mode
   remembers its last garment.
1. **Load a video:** click **Open a video file** and choose an MP4 (H.264) or WebM (VP8/VP9) clip of
   a person facing the camera. The file is read locally through the browser and is never uploaded.
   Portrait and landscape videos both work, and the image is never stretched.
2. **Or use a webcam:** click **Use camera**. The browser asks for camera permission only at that
   point; the microphone is never requested. Camera access works on `http://localhost`; from any
   other address the page must be served over HTTPS.
3. **Pick a shirt:** click a thumbnail, or press `[` / `]`. In **3D** there are two rigged models of
   the same shirt, **V-neck (3D)** (default, men's cut) and **V-neck women (3D)**; choose a fabric
   colour below the thumbnails. In **2D** one card holds the four flat demo shirts, chosen by colour
   swatch. Switching never reloads the tracker, and works while playing or paused.
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

**AI mode** (see the setup above):

1. Face the camera with the upper body visible and the arms slightly away from the body.
2. **Capture photo** freezes a clean frame (never the shirt overlay). **Retake** returns to the live
   view.
3. Choose a garment photo in the panel. The garments are product-only photos (no person in them):
   with an on-model photo the provider copies the model's face and accessories onto the shopper.
4. **Generate preview**. The first time in a session, a short opt-in explains that the photo goes to
   FASHN. Nothing is uploaded before **Agree & generate**.
5. While it runs, the stage shows what is happening (uploading, queue, generating) and the elapsed
   time. The result is labelled **AI-generated preview**, with **Before / After / Side by side**,
   **Download** (saves the generated JPEG, unmirrored), **Retake**, **Try another garment** (reuses
   the same captured photo) and **End session** (deletes the photo and result here and resets the
   opt-in for the next customer).
6. Switching to 2D or 3D stops waiting for a result and ends the AI session.

Developer test inputs (development builds): use a photo file instead of the camera, or upload a
garment photo. The offline test provider (`AI_PROVIDER=fake`) returns a stamped TEST RESULT image,
never an AI generation.

Status messages on the video: **Tracking**, **Upper-body view** (hips out of frame),
**Move back slightly**, **Face the mirror** (side/back view or bending), **Step into view**,
**Tracking lost**, or a tracking error with **Retry**.

Keyboard: `Space` play/pause · `[` `]` previous/next shirt · `G` shirt on/off · `M` mirror ·
`F` fullscreen · `S` fold/unfold the sidebar · `D` diagnostics · `L` English / Arabic · `?` list of
shortcuts · `Esc` closes a dialog. All controls are reachable with `Tab`.

**Language:** English or Arabic (Saudi), switched with the **عربي / EN** button in the sidebar header,
the folded rail or the research page, or with `L`. Arabic lays the whole page out right to left. The
choice is remembered; the first visit follows the browser language, and `?lang=ar` / `?lang=en` in the
address (e.g. a kiosk shortcut) sets it directly. Shopper guidance uses a friendly Saudi register;
privacy, consent and staff text stay in clear standard Arabic. Text lives in `src/i18n/en.ts` and
`src/i18n/ar.ts` (the research page's in `src/research/messages.ts`); a unit test fails if an Arabic
message is missing or left in English.

**Sidebar:** fold it (`S` or the panel button) to an icon rail with the mode switch, mirror and
fullscreen; each section (Source, Shirts, Fit, View) also folds on its own. The layout is remembered.
On phones and portrait tablets the controls become a bottom sheet: swipe its grip down to give the
mirror the whole screen, up to bring the controls back. Animations follow the system
"reduce motion" setting.

**Best results:** a single person facing the camera, with the head and both shoulders visible,
even lighting, roughly 1–3 m away. Chest-up framing is supported. The 3D shirt follows modest turns
(it fades from ~50° and hides beyond ~72°); back and extreme side views stay hidden.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Web app (Vite, React Strict Mode on) + AI backend, together |
| `npm run dev:web` / `npm run dev:api` | Only the web app / only the backend (tsx watch) |
| `npm run build` | Type-check, frontend build (`dist\`) and server bundle (`dist-server\`) |
| `npm run build:vercel` | What Vercel runs: the site (`dist\`) plus the AI function bundle (`dist-vercel\`) |
| `npm run build:static` | Static site only, for hosts without the AI server (AI mode says it is not available) |
| `npm start` | Production: serve `dist\` and `/api` from one origin (http://127.0.0.1:3001) |
| `npm run preview` | Serve the static `dist\` only (2D/3D) |
| `npm run typecheck` | `tsc -b` (strict: app, unit tests, node config and server projects) |
| `npm run lint` / `npm run format` | Biome lint+format check / format files |
| `npm test` | Vitest: unit tests + backend tests (`tests/server`; offline, fake or mocked provider) |
| `npm run test:e2e` | Playwright browser tests (Vite on 5174 + backend on 3101 with the fake provider) |
| `npm run test:e2e:preview` | Build, then run the asset-path/privacy/3D/AI browser tests against the production server (port 4174) |
| `npm run smoke:ai` | Opt-in: ONE paid FASHN generation for an approved image pair (see AI mode setup) |
| `npm run generate:ai-garments` | Rebuild the AI product photos in `public/garments/ai/` from `assets/garments/ai/photos/` and render the V-neck demo images (`-- --photos-only` skips the renders) |
| `npm run inspect:garment` | Print the V-neck GLB's full node hierarchy, joints and bind positions |
| `npm run generate:3d-thumbnail` | Render the 3D thumbnails (`preview.png`, `preview-female.png`) from the actual models (`-- <garment id>` for one) |
| `npm run check` | typecheck + lint + unit and server tests + build (never calls a paid API) |
| `npm run setup:assets` | Download/verify the models (`-- --check` to only verify) |
| `npm run generate:garments` | Regenerate the demo shirt SVGs |
| `npm run generate:brand` | Rebuild the web-sized Qassim University logo images from `assets/brand/` and the link-preview image `public/og-image.png` from `public/icon.svg` |
| `npm run fetch:footage` | Download the openly licensed test clips (not committed) + derive crops with ffmpeg |

First-time Playwright setup, only if Chromium isn't installed yet: `npx playwright install chromium`.

**Privacy:** in 2D and 3D, video is never uploaded. The page may only contact its own origin, which
also blocks the usage metrics MediaPipe would otherwise send to Google:
- a local-only `fetch` guard in the page and in the tracking worker, which works on any host;
- a `Content-Security-Policy: connect-src 'self'` rule, sent as a `<meta>` tag and as a server
  header (Vite dev/preview and the production server).

**AI mode is the exception.** After the shopper agrees, the page sends one captured photo to the
AI server (same origin: the kiosk's local server, or the Vercel Function), and **that server** sends
it with the garment image to FASHN's cloud. The browser never contacts FASHN and never sees the key.
The server never stores the photo; it keeps the generated image (in memory on the kiosk, in the
Redis database on Vercel) until End session, the idle timeout, or 30 minutes after the result,
whichever comes first. FASHN
deletes its temporary input copy after processing, keeps request records without images, and keeps
base64 results retrievable for 60 minutes
([retention policy](https://docs.fashn.ai/api-overview/data-retention-privacy)). Ending the session
here cannot delete provider-side data.

If you host `dist\` on another web server (2D/3D only), the fetch guard and the meta tag are
already included in the build. For a second layer inside the worker, configure the server to also
send the header `Content-Security-Policy: connect-src 'self' blob: data:` (`vercel.json` does this
on Vercel).

## Deploying to Vercel

Vercel runs the whole app: the site (2D/3D, both languages, `/research`) from its CDN, and AI mode
through one Vercel Function (`api/ai-gateway.js` → `server/vercel.ts`) that runs the same backend as
the kiosk. What differs from the kiosk:

- **Shared state in Redis.** Vercel starts and stops function instances freely, so sessions, jobs,
  results (with their time to live) and the daily credit ledger live in an Upstash Redis database
  shared by every instance. The credit cap, the one-job-per-session rule and the global concurrency
  bound hold across instances; a job is finished by whichever instance the shopper's next status
  read reaches, even if the one that submitted it has stopped.
- **An access code.** The site is public, so starting a paid generation needs `AI_ACCESS_CODE`.
  Visitors enter it once in the AI panel; the browser then stays unlocked for `AI_ACCESS_HOURS`
  (default 12) through a signed HttpOnly cookie. Wrong codes are limited to 10 per 15 minutes per
  client. Without the code the rest of the site works normally.
- **Limits.** A request to a function may carry 4.5 MB, so uploads are capped at 4 MB (photos are
  downscaled to 2048 px in the browser first, typically 0.2–0.6 MB). Background work (submission
  and provider polling) runs within the function's 300 s maximum duration (Hobby plan).

Set up (once):

1. Push the repository to GitHub (a personal account: Vercel's free Hobby plan cannot connect repos
   owned by a GitHub organization) and import it on vercel.com (**Add New → Project**). Keep the
   detected settings; they come from `vercel.json`.
2. In the project: **Storage → Create Database → Upstash for Redis** (Marketplace), choose the
   **Frankfurt (eu-central-1)** region and connect it to the project. This adds `KV_REST_API_URL` and
   `KV_REST_API_TOKEN`; the server finds them on its own. The function also runs in Frankfurt
   (`regions` in `vercel.json`), the Vercel region closest to Saudi Arabia, so every Redis call stays
   inside one data centre.
3. **Settings → Environment Variables** (Production; add Preview too if previews should run AI):
   - `FASHN_API_KEY` = your FASHN key (mark it **Sensitive**) — optional: without it (or without an
     access code) visitors use their own key from the AI panel
   - `AI_ACCESS_CODE` = a code of at least 8 characters, shared only with the people who may spend
     your key
   - `AI_MAX_DAILY_CREDITS` = the daily spending cap in credits (e.g. 20; 1 credit ≈ $0.075). If
     unset, there is **no cap**: anyone with the access code can spend the whole FASHN balance
4. Redeploy (Deployments → ⋯ → Redeploy) so the variables apply, then open the site over its
   `https://` address (the camera only works over HTTPS).

Without Redis or an access code, AI mode says why it is unavailable (Diagnostics shows the exact
reason) and never contacts FASHN; 2D and 3D are unaffected.

The repository files involved:

- **`vercel.json`** — build (`npm ci`, `npm run build:vercel`, output `dist`), the function (300 s,
  with the AI product photos attached), the `/api/ai/*` rewrite, the Frankfurt region, the security
  headers of the local servers (`Content-Security-Policy`, so the tracking worker cannot contact
  other sites either; `nosniff`; `no-referrer`; a `Permissions-Policy` that allows only the
  camera) and caching (fingerprinted `/assets/` for a year; models and garment images for a day).
- **`.vercelignore`** — keeps tests, test footage, docs, authoring sources, local builds and any
  `.env` file out of the deployment. It applies to Git and CLI deployments, and listed files are
  removed *before* the build, so never add a file the build reads (see the comment in it).
- **`npm run build:vercel`** — downloads and verifies the pose models (they are not committed),
  type-checks and builds the site, then bundles the function into `dist-vercel/`.

Checked locally before deploying: `vercel build` (Vercel's own packaging) on exactly the files a Git
deployment contains, then the packaged function run against a real Redis in Docker with the offline
fake provider (access code → session → job → result → end session), plus
`tests/server/redis.integration.test.ts` (see the comment at its top for the Docker commands).

Notes: only `main` deploys, to production (`git.deploymentEnabled` in `vercel.json`); pushes to
`development` or any other branch build nothing on Vercel. To get preview deployments again, remove
that setting; with Standard Protection (Settings → Deployment Protection), preview links need a
Vercel login. Vercel builds with Node.js 24: the `engines` range (`>=22.12.0 <25`) pins it to 24.x, so a new Node major is never picked up without a deliberate change. Leave Vercel Web Analytics and
Speed Insights **off**: they contact Vercel from the page, which this app's privacy rules block.
The free Hobby plan is for non-commercial use, which fits this graduation project; Upstash's free
plan (256 MB, 500K commands a month) is far more than this app uses.

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
| AI: "The local AI server is not running" | Start it with `npm run dev` (or `npm start` after a build) and check the `[api]` log lines. |
| AI: "switched off" / no API key field | Remove `AI_ENABLED=false` from `.env` (or set it to `true`) and restart the server: `.env` is read only at start-up. Without `FASHN_API_KEY`, visitors add their own key in the AI panel. |
| AI: "This request is not allowed" in development | The page's origin is not allowed; add it to `AI_ALLOWED_ORIGINS` in `.env`. |
| AI: "daily AI preview limit" | The local cap (`AI_MAX_DAILY_CREDITS`, UTC day) is used up; it resets at 00:00 UTC. |
| AI: "did not confirm the request" | A submission timed out. It was not resent and may still be charged; check the FASHN dashboard before trying again. |
| `npm ci` fails on Node < 22.12 | Install Node 24 LTS from nodejs.org (or `winget install OpenJS.NodeJS.LTS`). |

## Project layout

```text
src/app/          engine (non-React core), hooks, low-rate state, preferences (2D/3D/AI mode)
src/ai/           AI mode: API contract types, same-origin client, capture helpers, state machine, hook
src/components/   controls, catalogue, status, diagnostics, dialogs; ui/ (modal, cards, toasts)
src/i18n/         English + Arabic (Saudi) messages, locale choice (?lang=, remembered), RTL helpers
src/assets/brand/ web-sized university logo + mark (generated from assets/brand/)
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
src/research/     visual research / testing / limitations summary page (/research, also linked from About)
server/           Node backend (Fastify): config, AI routes, sessions, jobs, daily credit ledger, access
                  code, state store (memory or Redis), image validation (Sharp), providers (FASHN
                  SDK adapter, offline fake); vercel.ts = the Vercel Function entry
src/config/       documented thresholds, quality presets, 3D render settings
public/garments/  demo shirt art (CC0) + anchors (LICENSE.md); 3d/vneck/ runtime GLBs, men's and
                  women's (third-party); ai/<id>/ product photos for AI mode (assets/garments/ai/SOURCE.md)
assets/garments/  authoring sources (FBX, original AI product photos), SOURCE.md — never shipped by Vite
assets/brand/     original Qassim University logo (source for npm run generate:brand)
public/models/    pose models (downloaded, not committed)
scripts/          setup-assets.mjs, generate-garments.mjs, inspect-garment.mjs, generate-3d-thumbnail.mjs,
                  generate-ai-garments.mjs, generate-brand-assets.mjs, bake-fbx-garment.mjs (FBX2glTF
                  output → loader layout), ai-smoke.ts
tests/unit, tests/server, tests/e2e, tests/fixtures
docs/             RESEARCH, IMPLEMENTATION_PLAN, TESTING, LIMITATIONS, AI_TRYON_RESEARCH
spike.html        standalone worker/delegate timing check (dev server: /spike.html)
api/, vercel.json, .vercelignore  Vercel deployment: the AI function and its settings (see Deploying to Vercel)
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
   With only an FBX, convert it with FBX2glTF and bake it with `scripts/bake-fbx-garment.mjs`, as
   was done for the women's V-neck (commands in `assets/garments/vneck/SOURCE.md`).
2. Run `node scripts/inspect-garment.mjs <file.glb>` to see joint names, bind positions and axes.
3. Create `src/garments/rigs/<id>.ts` using `vneck.ts` as the template:
   - bone-name patterns;
   - `restRotationDeg`, only if the model is not +Y up / +X wearer's left / +Z front;
   - fit calibration, pose limits, clavicle lift;
   - optionally a simulation config.
4. Add a `kind: '3d'` entry to `GARMENTS` in `src/garments/catalogue.ts`, with fabric options, its
   name and description under `garments.items` in `src/i18n/en.ts` and `ar.ts`, and its thumbnail
   path to `TARGETS` in `scripts/generate-3d-thumbnail.mjs`; then generate the thumbnail. Check it in `/?inspect=3d` (dev server) and on footage with the landmark
   overlay. No renderer changes are needed.

## Licences

App code: yours to choose (no licence file added). Dependencies: MIT / ISC / Apache-2.0 (see
[docs/RESEARCH.md](docs/RESEARCH.md)); the AI backend adds `fashn` and `sharp` (Apache-2.0) and
Fastify packages (MIT). The pose models are Apache-2.0 (MediaPipe model card). Demo
2D garments: CC0 (original). **The 3D V-neck (both cuts) is third-party content from Fab** under its
own licence (not CC0); see [assets/garments/vneck/SOURCE.md](assets/garments/vneck/SOURCE.md) before
redistributing or deploying it. **The AI product photos** were supplied by the project owner and their
licence is not recorded yet; confirm it before a public deployment (see
[assets/garments/ai/SOURCE.md](assets/garments/ai/SOURCE.md)). The test footage is third-party, CC BY/BY-SA, and not committed —
see [test-footage/SOURCES.md](test-footage/SOURCES.md).

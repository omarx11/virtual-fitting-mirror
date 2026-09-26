# Testing

Date: 2026-09-26. Machine: Windows 10 Pro (10.0.19045), AMD Ryzen 9 5900X, 32 GB RAM, **AMD Radeon
RX 9070 XT** (driver 32.0.31041.1004; WebGL renderer "ANGLE (AMD … Direct3D11)"), Node 24.19.0.
Browser: Playwright Chromium 153.0.8010.12 (headless, real GPU via ANGLE/D3D11). The user's own video
and a physical webcam were **not available** (see "Not verified").

## Automated checks (all passing)

| Command | Result |
| --- | --- |
| `npm run typecheck` (TypeScript 7.0.2, strict) | ✅ no errors |
| `npm run lint` (Biome 2.5.14) | ✅ 81 files, no issues |
| `npm test` (Vitest 5.0.2) | ✅ 63 tests in 7 files |
| `npm run build` (Vite 8.3.1) | ✅ built; WASM bundled locally |
| `npm run test:e2e` (Playwright 1.63.0) | ✅ 13 passed (3 of them need the downloaded footage) |

### What the unit tests cover (synthetic landmarks / mocked backend — logic only)

These use **hand-built synthetic landmarks** or a **mocked inference backend**. They prove the
logic, not the model's accuracy or speed.

- **View transform:** letterbox/pillarbox/cover for portrait and landscape; no stretching; DPR
  backing store and cap; mirroring exactly once around the video centre; inverse mapping after resize.
- **Garment fit:** shoulder anchors land symmetric on the wearer; near/far scaling; aspect clamp;
  rotation follows and is clamped; user scale/offset; sleeves attach at seams and follow the arm;
  catalogue sanity.
- **Smoothing:** One Euro jitter reduction and bounded lag with the app's real parameters; restart
  after gaps / time reversal; angle wrap-around across ±π.
- **State machine:** full vs upper mode; **upper-body start with no calibration frame**; hips near
  the bottom edge ignored; learned torso ratio reused; one-shoulder bridge then fade; brief hold then
  "lost"; "searching" before first detection; hysteresis (no flicker with alternating hips); reset on
  reappearance; no hopping to a far-away person; second person does not steal the subject; back
  view, hidden face, strong yaw, bending (foreshortening) and tilt rejected; moderate yaw fades;
  "move back" when too close; paused frames apply at once; time going backwards = discontinuity.
- **Scheduler:** at most one inference in flight; superseded frames dropped (no queue); stale
  results from an old generation discarded; no submission until the tracking reset finishes; paused
  frames not re-inferred; rate limit; pause/resume; frame closed if disposed mid-capture.
- Status messages never turn a model failure into posture advice; preferences validation;
  subject selection.

### Browser tests (`tests/e2e`)

| Test | Kind |
| --- | --- |
| App loads, tracker starts **in a worker**, Strict Mode double mount leaves exactly 1 worker, no console errors | real model, synthetic video |
| Model 404 → actionable "run npm run setup:assets" error, video still plays, **Retry** recovers | real model |
| File: play, pause (no duplicate inference while paused), garment switch paused & playing **without model reload or new timeline**, seek back (new generation), loop wrap, restart, loop off → ends, 0 scheduler errors | synthetic video (no person) |
| Undecodable file → explanation, app still usable | fixture |
| Mirror toggle, cover framing, viewports 1080×1920 / 390×844 / 1600×900 → canvas matches stage | synthetic video |
| Keyboard reachability and labels of all controls and sliders | UI |
| Camera unavailable (no device in this environment) → clear error, video mode still works | real browser, no camera |
| **Fake camera** (Chromium `--use-fake-device-for-media-stream`): permission only on click, **no audio requested**, all tracks `ended` after switching to a file | synthetic camera |
| Real footage: chest-up clip initialises (upper/full) and shows the garment | real footage |
| Real footage: seek back 30 s hides the old pose immediately; restart reacquires; 0 errors | real footage |
| Real footage: back view stays "turned" and hidden | real footage |

## Real-footage visual matrix

Clips: see `test-footage/SOURCES.md` (openly licensed; derived clips are **digital crops**, not
different camera positions). Checked through landmark overlays, contact sheets of the running app,
and traces of the phase and diagnostics.

| Case | Ran? | Clip(s) | Observed result |
| --- | --- | --- | --- |
| Front-facing torso / full body | ✅ | Jumping jacks | Stable shirt on the torso during jumping jacks; sleeves follow raised arms (screenshot below). |
| Starts with hips off-screen | ✅ | derived_upper_landscape (from frame 0) | "Upper-body view" from the first detection; shirt placed from shoulders × default ratio. |
| Near/far movement | ⚠️ partial | Distance changes only through crops and the burpees | Scale follows the shoulders with log-space smoothing. **No real walking toward/away from the camera was available.** |
| Mild lean / rotation | ✅ partial | Jumping jacks, dance | Rotation follows the shoulder line; moderate yaw fades the shirt instead of distorting it. |
| Crossed arms / sideways turn | ⚠️ sideways only | Squat & frontal raise (side), burpees (side-on) | Side views: yaw ~85° → hidden with "Face the mirror". **No crossed-arm footage**; occlusion unvalidated. |
| Bending over (burpees) | ✅ | Jumping jacks | Head below shoulders / foreshortened torso → hidden. Before the fix, upper-body fallback drew a full-length shirt over the bent body; fixed and unit-tested. |
| Back view | ✅ | Squat demo | Hidden for the whole clip (screenshot). |
| Leaves and re-enters | ✅ | derived_leave_reenter | searching → tracking → hold ≤350 ms + fade → "Tracking lost" → clean reacquisition. The stale reference width that flagged re-entry as "narrow" was found and fixed. |
| Multiple people | ✅ (stress) | Dance (crowd) | Subject kept while tracked; after loss, picks the largest central person. Constant turning means the shirt is hidden most of the time. One case of a shirt drawn on a back-facing man led to the **face-visibility gate** (fixed). |
| Garment switch playing/paused | ✅ | e2e + manual | Immediate, no model reload (initMs unchanged, generation unchanged). |
| Seek back / restart / loop | ✅ | e2e (synthetic + real) | New generation, stale results dropped (counted), no timestamp errors. |
| Portrait / landscape / resize / mirror | ✅ | derived_full_portrait, fixtures | Aligned in 1080×1920 kiosk (mirrored), 1500×850 landscape and 390×844 DPR 3 phone with cover crop. |
| Camera absent / denied | ✅ absent; ⚠️ denied (logic only) | e2e | Absent verified. Denied/busy messages are mapped from DOMException names; not triggered with a real device. |
| Model download / load failure | ✅ | e2e (404) | Actionable message + Retry. |
| Several minutes of playback | ✅ | 5-min soak (below) | No backlog, no growth. |

![Mirrored kiosk layout](images/kiosk-mirror.png)
![Upper-body clip over time](images/upper-body-sequence.png)
![Back view stays hidden](images/back-view-hidden.png)

(Screenshot credits: `docs/images/ATTRIBUTION.md`.)

## Performance (measured, not guaranteed)

Methodology: headless Chromium with the real GPU, 12 s of playback per case after the tracker was
ready; values from the in-app diagnostics.
- **Video/Render FPS:** new video frames presented / canvas draws per second.
- **Inference/s:** completed pose results per second.
- **Inference ms:** time inside `detectForVideo` in the worker.
- **Frame→pose ms:** from the frame being presented (rVFC callback) to its result reaching the main
  thread. Includes `createImageBitmap`, transfer, queueing and inference.
- **Pose age:** media-time gap between the frame being displayed and the frame the drawn pose came
  from.

This is not photon-to-photon latency; display latency is not included.

| Model / delegate / backend | Source → processing | Video fps | Inference/s | Inference ms (med/p95) | Frame→pose ms (med/p95) | Pose age ms (med/p95) |
| --- | --- | --- | --- | --- | --- | --- |
| Lite / GPU / worker | 640×480 → 512×384 | 29.6 | 29.9 | 14.9 / 19.8 | 15.4 / 20.5 | 33 / 34 |
| **Full / GPU / worker (default)** | 640×480 → 640×480 | 29.6 | 29.4 | 16.4 / 22.6 | 16.9 / 23.4 | 33 / 34 |
| Lite / CPU / worker | 640×480 → 512×384 | 29.3 | 25.7 | 37.8 / 52.1 | 56.3 / 72.7 | 67 / 100 |
| Full / CPU / worker | 640×480 → 640×480 | 29.6 | 20.7 | 47.1 / 75.6 | 67.6 / 94.2 | 100 / 101 |
| Full / GPU / worker | 1280×720 → 640×360 | 29.9 | 30.1 | 14.5 / 16.1 | 15.0 / 16.7 | (hidden: back view) |
| Full / GPU / worker | 480×640 portrait → 480×640 | 24.6 (clip is 25 fps) | 24.8 | 14.9 / 19.8 | 15.4 / 21.6 | 40 / 40 |
| Full / GPU / **main thread (forced worker failure)** | 640×480 → 640×480 | 29.1 | 11.1 (capped at 12) | 13.7 / 19.4 | 30.7 / 56.5 | 67 / 100 |

Other measurements:
- One-time GPU shader warm-up at startup: 3.3–3.8 s (hidden behind "Preparing tracker…"). Tracker
  graph reset after a seek: 26–220 ms (GPU).
- With the default preset on this machine, inference keeps up with 30 fps video, and the drawn
  pose is one frame (33 ms) behind the displayed frame.
- The forced main-thread fallback showed the note "Worker tracking failed … Running on the main
  thread at up to 12 inferences/s."; video stayed at 29 fps.

### Soak test (5 minutes, default preset, looping 640×480 clip)

First the source was replaced 4 times; then heap, DOM, workers and scheduler state were sampled
every 30 s (after a forced GC):

| t | JS heap | `<video>` elements | Workers | In flight | Inferences | Errors | Inference/s | Inference ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 s | 24.0 MB | 1 | 1 | 0 | 140 | 0 | 24.2 | 14.8 |
| 60 s | 24.4 MB | 1 | 1 | 1 | 1,930 | 0 | 29.7 | 15.3 |
| 180 s | 24.7 MB | 1 | 1 | 0 | 5,506 | 0 | 29.6 | 15.3 |
| 300 s | 24.6 MB | 1 | 1 | 0 | 9,079 | 0 | 29.8 | 15.5 |

No backlog (never more than one in flight), no heap growth, and the replaced sources and workers were
released. 54 frames were superseded and 1 stale result was dropped over the run; there were no
console errors.

## Network / privacy

Unmodified, MediaPipe sends one metrics POST to `odml.pa.googleapis.com` (121 bytes, about 4 s
after the tracker starts). The app now blocks it by default. `tests/e2e/privacy.spec.ts` records
every request during 8+ s of tracking and asserts none leaves localhost, for both the worker and
the forced main-thread fallback:

| Configuration | Result |
| --- | --- |
| Fetch guard + CSP (shipped) | ✅ 0 external requests (dev server and production `vite preview`) |
| Fetch guard only (CSP removed) | ✅ 0 external requests |
| CSP only (guard removed) | ✅ 0 external requests |
| Neither (negative control) | ❌ test fails, showing the `odml.pa.googleapis.com/v1/log` request, so the test really detects it |

Tracking was unaffected (29.6 inferences/s in the production build). Model and WASM are always local.

## Not verified (manual steps needed)

1. **Your own recorded video.** Open it with **Open a video file**, turn on Diagnostics →
   *Show landmarks*, and go through the matrix above. Note any "Face the mirror" / "Tracking lost"
   periods that look wrong, together with the diagnostics values (yaw, face visibility, reason).
2. **A physical webcam.** Connect it, open `http://localhost:5173`, click **Use camera**, and allow
   access. Also check: deny permission once; start with the camera in use by another app; unplug
   it while running (the app should show "camera stopped").
3. **Real walking near/far, crossed arms, and the real kiosk distance and lighting.**
4. **The target kiosk PC's performance** (record the Diagnostics numbers there).
5. **Other browsers** (Firefox, Safari) and non-AMD GPUs.

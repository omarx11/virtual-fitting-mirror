# Build a Free Virtual Fitting Mirror

## Your role and objective

You are my implementation partner in VS Code. Research, design, build, and verify this project in the current workspace. Produce a working application, not just a plan or mockup. Make sensible technical decisions and continue through the implementation phases unless an actual manual prerequisite blocks progress.

This is a college graduation project for a friend, not a commercial retail system. The idea is a vertical screen that feels like a mirror: a person selects clothing and sees it overlaid on their camera image without changing clothes physically.

I currently have a recorded video and no webcam. Video-file mode must be fully usable first. Design camera mode alongside it so a webcam can be connected later. Do not tailor the implementation to one test video, person, resolution, or camera position.

The software should be free wherever possible, run locally, and require no paid API, subscription, account, backend server, or model training. Do not introduce a paid dependency silently. Existing computer hardware and electricity are outside this software-cost requirement.

## Manual steps: tell me before proceeding past a blocker

Before implementation, inspect the workspace, applicable repository instructions, available tools, and Node/package-manager versions. Preserve existing files and changes. If this is an unrelated existing project and the target directory is ambiguous, ask where to create this project before modifying it.

Identify any immediate manual requirements early. If none exist, say so and proceed. You are authorized to create the project files, install appropriate project-local dependencies, download publicly available compatible models with verified terms, and run local validation.

If you need something only I can provide—an unavailable runtime installation, account login, camera permission, a local file inaccessible to you, a restricted model download, administrator action, or an important unresolved scope decision—explain:

1. What is blocked and why.
2. The exact action I must take, using Windows/PowerShell instructions where applicable.
3. What information or file I should provide afterward.
4. Any practical free alternative.

Pause the blocked work and wait for my reply before proceeding past that requirement. Do not repeatedly request permission for routine implementation choices. Do not block initial development on my video: provide a file picker and use appropriately licensed test footage if available. If real footage is unavailable, implement what you can, clearly separate synthetic checks from real tracking validation, and ask for footage before claiming real-video acceptance.

Do not purchase, publish, deploy, push to a remote, modify global machine settings, or delete unrelated files without my instruction. Do not assume any GPU model or claim hardware compatibility without checking.

## Product expectations and honest scope

Build a responsive real-time **2D shirt overlay** prototype using:

- React and TypeScript for interface and application state.
- `@mediapipe/tasks-vision`, using the current supported Pose Landmarker API, for tracking.
- Canvas for compositing the garment onto the video.

The entire body must not be required. Upper-body framing, including both shoulders with hips outside the image, is an explicit target. MediaPipe detection can still fail under extreme crops or occlusion; handle that gracefully. Estimated off-screen landmarks are not ground truth.

I want broad robustness, but do not claim it works in every possible scenario. A transparent 2D garment does not physically simulate fabric, replace underlying clothing, infer accurate clothing size, or produce a photorealistic fitting. Real clothes may remain visible around its edges. Explain these limits briefly in the documentation.

Out of scope for the first delivery: generative image/video try-on, diffusion pipelines, full 3D garments, cloth physics, body measurements, size recommendations, multiple simultaneous shoppers, e-commerce, accounts, payments, and inventory systems. Keep interfaces extensible without building these features.

## Research before selecting versions and implementing

Use current official documentation, original repositories, release notes, package registries, and browser API documentation. Verify APIs and compatible stable versions instead of copying obsolete tutorials. If browsing is unavailable, disclose that and use accessible package types/documentation; do not fabricate research.

Starting references to inspect:

- https://github.com/google-ai-edge/mediapipe
- https://github.com/google-ai-edge/mediapipe-samples
- https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
- https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- https://vite.dev/guide/
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
- https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- https://gery.casiez.net/1euro/

Confirm current MediaPipe model choices, model and code licenses, supported browsers, worker behavior, CPU/GPU delegation, timestamp semantics, segmentation output, and model/JavaScript/WASM compatibility. Prefer the current Tasks API; do not build on obsolete `mp.solutions.pose` examples.

Use public GitHub try-on projects as references only after checking the actual implementation, license, maintenance, and dependency versions. Do not equate repository popularity or README performance claims with verified quality. Do not copy code or assets without compatible permission and attribution.

Write concise findings in `docs/RESEARCH.md`, including source URLs, date accessed, exact installed versions, selected model, license notes, relevant limitations, and why the chosen architecture suits this prototype.

## Stack and dependency selection

Default to Vite + React + TypeScript with strict type checking. This is a browser application; Next.js and a Python server are not required unless inspection reveals a concrete reason to use them.

Choose current compatible stable versions, keep the lockfile, and document the supported Node version. Respect an existing package manager; use npm for an empty workspace. Avoid prereleases unless they solve a demonstrated blocker.

Evaluate these options and adopt only what earns its place:

| Need | Preferred starting point |
| --- | --- |
| Pose tracking | `@mediapipe/tasks-vision` |
| UI styling | CSS/CSS modules; Tailwind only if it simplifies the interface |
| Accessible icons | `lucide-react`, if useful |
| Worker communication | Native typed messages; Comlink only if it simplifies lifecycle and transfers |
| Input/schema validation | Small typed validators; Zod if garment/settings schemas justify it |
| Smoothing | A small tested One Euro filter implementation or a maintained compatible package |
| Unit tests | Vitest |
| Browser tests | Playwright |
| Formatting/linting | Biome if compatible with the selected toolchain |

Do not add all candidate packages automatically. Prefer native browser APIs and a small dependency surface. Avoid adding OpenCV.js, TensorFlow.js, Three.js, PixiJS, a state library, or an animation library without a measured or functional need. If a mesh renderer becomes necessary, justify the smallest suitable Canvas/WebGL extension before introducing a larger rendering stack.

## User experience

Create a polished, restrained interface with the video/mirror as the main focus. Support desktop landscape and vertical kiosk layouts, plus usable smaller screens. Avoid a marketing landing page.

Required controls and states:

- Choose a local video, or switch to webcam mode when available.
- Play/pause, scrub, restart, and loop video.
- Select among at least three clearly different sample shirts without interrupting playback or tracking.
- Toggle the garment, mirror view, and fullscreen.
- Adjust garment scale and vertical placement, with a reset button.
- Show loading progress/status for tracking assets and understandable retryable errors.
- Show tracking states such as “Tracking”, “Upper-body view”, “Move back slightly”, and “Tracking lost”. Use messages matching the actual failure; do not tell a stationary user to stand still when the model failed to load.
- An optional diagnostics panel for tracking landmarks, confidence, render FPS, inference rate, latency, and active model/delegate.
- Keyboard-accessible controls, visible focus, labels, sufficient contrast, and reduced-motion support for decorative UI animations.

Keep implementation details in the diagnostics panel rather than the default shopper view. Do not display a false “perfect fit” or body-measurement claim.

## Video and webcam input

Create one common source/frame abstraction so both modes feed the same tracker and renderer.

For local video:

- Use browser-local file access and an object URL; do not upload footage.
- Validate that the browser can decode the file. Explain unsupported codecs rather than promising all MP4/WebM files work.
- Respect intrinsic dimensions and portrait/landscape orientation; do not stretch the image.
- Handle pause, seeking, loops, source replacement, playback-rate changes if exposed, and end of playback.
- On discontinuities, reset temporal state or recreate the tracker as required. Respect strictly increasing inference timestamps without carrying stale smoothing or tracking across unrelated frames.
- Paused frames must allow garment changes and rendering without continuous duplicate inference.
- Revoke object URLs and close frame resources on replacement/unmount.

For webcam:

- Ask for permission only when the user selects camera mode. Do not access the microphone.
- Handle permission denial, no device, occupied device, unsupported constraints, and disconnection.
- Prefer sensible initial resolution constraints, with fallback when unavailable.
- Explain the secure-context requirement: localhost during development, HTTPS for remote camera use.
- Stop all camera tracks when switching sources or closing the component.
- No camera must not prevent the rest of the application from running.

## Tracking and partial-body behavior

Separate pose estimation from interpretation and garment placement. Use MediaPipe visibility/presence and practical bounds checks; a returned coordinate alone does not mean the landmark is trustworthy.

Implement a small explicit tracking state machine with hysteresis so it does not flicker between states:

| Input condition | Required response |
| --- | --- |
| Both shoulders and hips reliable | Use shoulder/hip geometry to position, rotate, and scale the torso garment |
| Both shoulders reliable, hips unavailable | Enter upper-body mode; use shoulder width, garment proportions, and reliable recent torso proportions if available |
| One shoulder briefly unreliable | Brief bounded fallback from recent reliable tracking, then fade if it does not recover |
| Too little torso, no reliable shoulders, or person absent | Hide/fade the garment and show a helpful status |
| Person reappears | Reacquire cleanly; reset stale history and avoid an obvious snap from an old person/location |
| Strong side view/back turn or implausible geometry | Reduce confidence and fade or show a limitation; never expand/collapse the shirt wildly |

Upper-body mode must be able to start directly on a chest-up clip without requiring an earlier full-body calibration frame. Shoulder-based length is a visual approximation, not a body measurement. Clamp implausible scale, rotation, and aspect changes. Do not use invisible hips as precise anchors.

Prefer one person. If more people enter the frame, avoid hopping identities; maintain a stable selected subject where feasible and describe the one-person operating requirement. Do not add face recognition.

## Garment assets and rendering

Provide at least three original or compatibly licensed transparent shirt assets. If realistic assets are unavailable, create original placeholder SVG/PNG shirts and label them as demo assets. They must be replaceable with real garment cutouts later.

Define a typed garment catalogue with ID, name, preview, asset path, intrinsic dimensions, normalized shoulder/neck/hem anchors as appropriate, default fit adjustment, supported views, and license/attribution metadata.

- Use asset-specific anchors rather than one arbitrary hard-coded offset for all images.
- Support alpha transparency, consistent sizing, preloading, and decode errors.
- Position using the shoulder midpoint, width, shoulder tilt, and reliable torso geometry.
- Clip garments naturally at the video viewport; do not require the lower garment to fit on screen.
- Handle letterboxing, cropping if offered, device pixel ratio, resize, and fullscreen through a shared coordinate transform.
- Apply mirroring consistently to the video and overlay exactly once; controls and text stay readable.
- Keep MediaPipe anatomical left/right semantics separate from display mirroring.
- Begin with a stable anchor-based transform. Add a small piecewise-affine/triangulated warp only if it improves a demonstrated torso alignment issue without excessive stretching or seams.

Crossed-arm handling is a staged enhancement after baseline alignment works. Investigate a lightweight method for drawing original foreground arm pixels over the shirt. Landmark-derived masks are approximate and can expose the old clothing; handle low confidence conservatively and document the limitation. Pose person/background segmentation alone cannot distinguish arms from torso. Do not claim realistic occlusion from a whole-person mask. Add a separate body-part model only if license, performance, and integration evidence justify it.

Do not block delivery of the functional baseline on perfect occlusion or claim that a 2D shirt supports a realistic 360-degree view.

## Smoothness, scheduling, and performance

Aim for an approximately 30 FPS responsive preview on the actual test device, but report measurements rather than guaranteeing a frame rate. Render FPS, inference FPS, and end-to-end delay are different metrics.

- Keep high-frequency landmarks and frame data outside React state. Use React for controls and low-rate status updates.
- Prefer `requestVideoFrameCallback` for newly decoded frames, with a guarded `requestAnimationFrame` fallback.
- Run MediaPipe inference in a Web Worker where the selected browser/delegate path supports it. Verify support through a small spike first. If worker/GPU support fails, provide a controlled CPU or reduced-rate main-thread fallback with an honest status.
- Transfer frame resources where practical and close them promptly; avoid per-frame base64 encoding and unnecessary readbacks.
- Allow at most one inference in flight. Use backpressure and drop superseded frames; never accumulate a growing queue.
- Separate frame rendering and inference cadence. Keep frame timestamps and a session/source generation ID so late results from an old source cannot affect the current view.
- Measure video/pose timing mismatch. Bound result age; choose a documented strategy for compositing against the corresponding frame or using recent smoothed poses. Reject stale results instead of displaying a lagging shirt indefinitely.
- Smooth position, scale, and rotation with a time-aware filter. Evaluate One Euro filtering for low jitter at rest and responsiveness during motion. Handle angle wraparound and reset on tracking/source changes.
- Balance smoothing against latency. Do not conceal poor tracking with excessive delay.
- Keep short missing-landmark fallback bounded and tunable; fade out instead of leaving a frozen shirt floating on an empty scene.
- Preload garments and avoid rebuilding the tracker on garment selection.
- Evaluate Lite versus Full pose models on representative footage. Use a quality preset or conservative adaptive resolution/inference rate if useful; avoid frequent model reloads.
- Start with a reasonable processing size and measure. Preserve the display aspect ratio and map coordinates correctly when resizing inference frames.
- Pause or reduce work when the tab is hidden, and resume safely.
- Release workers, models, textures/bitmaps, streams, listeners, and scheduled callbacks. Verify cleanup under React development Strict Mode.

Store model and compatible WASM assets locally in the application where licensing permits. Pin the JavaScript and WASM versions together. Provide a reproducible download/setup script and useful missing-asset errors. Avoid production runtime dependence on an unpinned CDN `latest` URL. Verify the actual network behavior before claiming offline operation or making blanket privacy statements about third-party runtime telemetry.

## Suggested architecture

Use a small modular structure, adapting names where useful:

```text
src/
  app/                  # page layout and low-rate application state
  components/           # controls, catalogue, statuses, diagnostics
  media/                # video/camera adapters and frame scheduling
  tracking/             # worker protocol, model setup, pose interpretation
  fitting/              # anchors, transforms, partial-body fallback, filters
  rendering/            # Canvas composition and optional occlusion
  garments/             # catalogue types and definitions
  config/               # documented thresholds and performance presets
public/
  garments/
  models/
  wasm/
scripts/                # reproducible asset setup if needed
tests/
docs/
```

Use clear TypeScript interfaces between these layers. Keep geometry, confidence interpretation, and filters as independently testable pure logic. Avoid a giant component containing media lifecycle, tracking, rendering, and UI.

Persist only harmless preferences locally when useful. Do not save user footage or screenshots automatically. No database is needed.

## Implementation sequence

1. **Inspect and research:** report immediate manual blockers, verify APIs/versions/licenses, and write a short plan and research notes.
2. **Prove the technical path:** make a minimal local-video tracker with visible landmarks; validate model loading, the chosen worker/delegate, and frame timing before styling a large UI.
3. **Build baseline try-on:** common video/camera input, reliable shirt placement, catalogue switching, controls, and honest error states.
4. **Add resilience:** upper-body startup and fallback, confidence gating, smoothing, tracking loss/recovery, source transitions, resize/mirroring correctness, and performance instrumentation.
5. **Polish and evaluate:** responsive kiosk layout, practical occlusion improvement if feasible, measured optimization, accessibility, and representative footage testing.
6. **Verify and document:** fix failures, finish setup/troubleshooting docs, and provide a concise handoff with remaining limitations.

Keep `docs/IMPLEMENTATION_PLAN.md` current with completed work, blockers, and next steps. Continue through phases without asking for approval between routine steps. If context is getting long, record the exact state and next task so work can resume without restarting.

## Meaningful validation and acceptance

Use automated tests where they address actual risks:

- Coordinate transforms across aspect ratios, mirroring, DPR, and viewport resize.
- Shoulder/hip fit math and missing-landmark cases, including upper-body-only startup.
- Smoothing, confidence transitions, bounded tracking loss, and reset behavior.
- Timestamp/source discontinuities, stale worker replies, and backpressure.
- Browser-level file loading, play/pause/seek/loop, garment switching, and source errors.

Synthetic landmarks and mocked inference are useful for deterministic tests but do not prove real model accuracy. Label them accordingly. Never report camera mode as physically verified when no camera was used.

Use consented or appropriately licensed real footage for the visual matrix below, and record which cases actually ran. A crop of full-body footage is useful to test partial framing. Do not claim camera perspective changes were tested merely by digitally scaling one clip.

| Test case | Acceptance expectation |
| --- | --- |
| Front-facing torso/full body | Stable approximate shirt placement during modest motion |
| Starts with hips/legs off-screen | Upper-body overlay can initialize when shoulders are trackable |
| Near/far movement | Scale follows without extreme jumps or collapse |
| Mild lean/rotation | Shirt follows smoothly within the 2D method's limits |
| Crossed arms/sideways turn | No catastrophic distortion; limitations/fallback remain honest |
| Leaves and re-enters frame | Overlay disappears and reacquires without a stale floating shirt |
| Garment switch while playing/paused | No model reload; selected garment appears promptly |
| Seek backward/restart/loop | No timestamp crash or stale pose carryover |
| Portrait/landscape/resize/mirror | Video and garment remain aligned |
| Camera absent/denied | Video mode remains available with clear errors |
| Model download/load failure | Actionable status and retry path |
| Several minutes of playback | No growing inference backlog or persistent resource growth |

For performance results, record browser, actual hardware when available, model/delegate, video and processing resolutions, render FPS, inference FPS, and latency methodology. Distinguish inference duration from end-to-end delay. Do not invent target achievement or infer speed from a mocked test.

Run type checking, linting, relevant automated tests, and a production build. Verify the application in a real browser if tools permit. If browser access, camera access, or actual footage is unavailable, state the exact unverified items and the manual steps needed.

## Required deliverables

- Runnable, typed source code and a reproducible lockfile.
- Scripts for development, production build/preview, type checking, linting, formatting, and relevant tests.
- Sample garment assets, documented anchors, and attribution/license notes.
- Reproducible local model/WASM asset setup with exact versions and sources.
- `README.md`: Windows/PowerShell setup, run commands, loading a video, switching to camera, controls, supported environment, and troubleshooting.
- `docs/RESEARCH.md`: primary sources, version choices, model/runtime constraints, and license findings.
- `docs/IMPLEMENTATION_PLAN.md`: actual progress and unresolved blockers.
- `docs/TESTING.md`: test matrix, executed checks, measured performance, and unverified cases.
- `docs/LIMITATIONS.md`: partial-body limits, 2D realism, occlusion, privacy/network findings, and sensible future improvements.

At completion, tell me briefly what works, how to run it, what was verified, what remains limited, and whether I must do anything manually. Do not present unimplemented features as complete.

Start now by inspecting the workspace and checking immediate manual prerequisites. If none block you, research and implement the project through the phases above.

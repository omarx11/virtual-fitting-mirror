# Research notes

Accessed **2026-09-26** unless stated. Browsing was available. Where the docs site and the installed
package disagreed, the **installed package's type definitions (`vision.d.ts`) and bundle** were
treated as authoritative, and that is noted below.

## Sources consulted

| Source | What it was used for |
| --- | --- |
| https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker (page updated 2026-08-17) | Model variants, 33-landmark topology, option defaults |
| https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js | Web Tasks API usage (`FilesetResolver`, `createFromOptions`, `detectForVideo`), recommendation to use Web Workers |
| https://github.com/google-ai-edge/mediapipe/releases (v0.10.32 … v1.0.0) | Web fixes relevant to workers: v0.10.32 "patch for importScripts error with modules in workers", v0.10.35 "Allow MP Task files to be used in Vite's workers"; v1.0.0 changes |
| `node_modules/@mediapipe/tasks-vision/vision.d.ts`, `vision_bundle.mjs`, `README.md` (v1.0.1) | Exact API, WASM loader selection, worker/OffscreenCanvas behaviour, privacy notice, telemetry endpoint |
| https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf | Model licence, intended use, out-of-scope uses, limitations |
| npm registry (`npm view … time/dist-tags/engines/peerDependencies`) | Current stable versions, prerelease status, Node engine ranges |
| https://vite.dev/guide/ | Vite 8 worker (`new Worker(new URL(...), {type:'module'})`) and `?url` asset imports |
| MDN: `HTMLVideoElement.requestVideoFrameCallback`, `OffscreenCanvas`, `MediaDevices.getUserMedia` | Frame scheduling, worker canvas, camera errors / secure-context rule |
| https://gery.casiez.net/1euro/ (Casiez, Roussel & Vogel, CHI 2012) | One Euro filter algorithm (implemented from the paper's equations; no code copied) |
| Wikimedia Commons file pages (see `test-footage/SOURCES.md`) | Licensed real test footage |

The mediapipe-samples repository was not needed beyond the official guide: the web sample follows
the same `createFromOptions` + `detectForVideo` pattern. No third-party try-on repository code or
assets were copied; the anchor-based placement, state machine and garment art are original.

## Version choices (exact installed versions)

| Package | Version | Licence | Why |
| --- | --- | --- | --- |
| @mediapipe/tasks-vision | **1.0.1** | Apache-2.0 | Latest stable (2026-07-31). 1.1.0 exists only as daily `-rc` builds → not used. |
| react / react-dom | 19.3.0 | MIT | Current stable |
| vite | 8.3.1 (rolldown 1.2.11) | MIT | Current stable; requires Node ^20.19 or >=22.12 |
| @vitejs/plugin-react | 6.1.1 | MIT | Peer `vite ^8` |
| typescript | 7.0.2 | Apache-2.0 | `latest` tag (native compiler). Used only for `tsc -b` type checking; Vite transpiles. |
| vitest | 5.0.2 | MIT | Requires Node ^22.12 / ^24 |
| @playwright/test | 1.63.0 | Apache-2.0 | Chromium 153 (revision 1243) was already cached locally |
| @biomejs/biome | 2.5.14 | MIT/Apache-2.0 | Lint + format in one tool, works with TS 7 (does not depend on the TS compiler) |
| lucide-react | 1.48.0 | ISC | Small accessible icon set (canonical v1 names used, e.g. `TriangleAlert`) |
| @types/node | 24.13.6 | MIT | Matches Node 24 |
| three | **0.186.1** | MIT | 3D garment path (added 2026-09-26): GLTFLoader, SkeletonUtils, SkinnedMesh, used directly in the engine (no React Three Fiber) |
| @types/three | 0.186.0 (dev) | MIT | Types matching three 0.186 |
| jolt-physics | **1.1.0** | MIT | Experimental cloth mode: single-threaded WASM build, lazy-loaded; the Node tests use the embedded `wasm-compat` build |
| @gltf-transform/cli | 4.5.0 (dev) | MIT | Inspecting/validating the GLB (`npx gltf-transform inspect/validate`); no derived assets were written |

Not adopted: Tailwind (plain CSS was simpler), Zod (the two schemas — preferences and catalogue —
are small typed validators), Comlink (native typed messages were ~150 lines), any state library,
OpenCV.js, TensorFlow.js, PixiJS. Nothing measured required them. (Three.js was later adopted for
the 3D garments: see the last section.)

Development machine (all measurements in docs/TESTING.md): Windows 10 Pro 22H2 (10.0.19045),
AMD Ryzen 9 5900X, 32 GB RAM, AMD Radeon RX 9070 XT (driver 32.0.31041.1004), Node 24.19.0,
npm 11.17.0, Chrome 153.0.8010.53 and Playwright Chromium 153.0.8010.12.

## Model

| Variant | Pinned URL (`/float16/1/`, not `latest`) | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Lite | `…/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` | 5,777,746 | `59929e1d…90d574a` |
| Full (default) | `…/pose_landmarker_full/float16/1/pose_landmarker_full.task` | 9,398,198 | `5134a3aa…839011b1` |

- Licence: the model card states **Apache License 2.0**.
- Heavy (30.7 MB) was not adopted: Full already runs at the video frame rate here, and Heavy would
  hurt weaker kiosk PCs.
- Note: at the time of access, `full/float16/latest` had a *different* MD5 from `full/float16/1`
  with the same size. We pin `/1/` and verify SHA-256, so an upstream change cannot slip in.
- Model card, relevant limits: intended for **single-person** video; out of scope: multiple people,
  people farther than ~4 m, **head not visible**, metric depth, and any surveillance/identity use.
  Input should contain the person with margin; quality degrades with poor light, noise, motion and
  occlusion.

## API findings (v1.0.1)

- `PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetBuffer | modelAssetPath, delegate: 'GPU'|'CPU' }, runningMode: 'VIDEO', numPoses, minPoseDetectionConfidence, minPosePresenceConfidence, minTrackingConfidence, outputSegmentationMasks })`.
- `detectForVideo(frame, timestampMs)` — timestamps must be **strictly increasing per landmarker**.
  The app uses a monotonic clock plus a +1 ms guard, so seeks/loops can never violate it.
- `NormalizedLandmark` in 1.0.1 has `x, y, z, visibility` only — **no `presence` field**, although
  some documentation mentions presence. The app uses visibility plus image-bounds checks.
- Masks returned by the synchronous `detectForVideo` are copies; we request no masks.
- `setOptions({...})` rebuilds the task graph (clears the previous-frame tracking ROI) without
  reloading WASM or the model. Measured: 26–220 ms on GPU, 19–77 ms on CPU. Used after seeks/loops/
  source changes.
- **First GPU inference compiles shaders: 3.3–3.8 s** on this machine. The app runs a warm-up
  inference during "Preparing tracker…" so the first real frame is not delayed.
- WASM: the package ships a classic loader (`vision_wasm_internal.js`, loaded via `<script>`) and an
  ES-module loader (`vision_wasm_module_internal.js`, loaded via `import()` inside module workers,
  selected with `FilesetResolver.forVisionTasks(base, /*useModule*/ true)` or an explicit
  `WasmFileset`). Each loader must be paired with its own `.wasm` binary.
- In a worker, the GPU delegate creates its own `OffscreenCanvas(1,1)` WebGL context automatically.
- Inputs are `TexImageSource`; we transfer an `ImageBitmap` (resized with `createImageBitmap`) to the
  worker and `close()` it there after inference.
- MediaPipe prints `landmark_projection_calculator: Using NORM_RECT without IMAGE_DIMENSIONS…` for
  non-square input. On our footage, landmarks drawn back over portrait and landscape frames were
  visually aligned (see TESTING.md screenshots); treated as a benign internal warning.

## Worker / delegate spike (step 2 of the plan)

A minimal page (`spike.html`, kept as a diagnostic tool) loaded the model and ran it on a real clip
(640×480) before any UI existed. Median inference, one inference in flight, processing long side 512:

| Backend | Delegate | Model | Inference median / p95 (ms) | Inferences/s (30 fps video) |
| --- | --- | --- | --- | --- |
| Worker | GPU | Lite | 10.8 / 14.9 | 26.8 |
| Worker | GPU | Full | 12.4 / 19.9 | 26.6 |
| Worker | CPU | Lite | 37.0 / 53.5 | 18.3 |
| Main thread | GPU | Lite | 10.5 / 17.3 | 27.2 |

Conclusion: the module-worker + GPU path works on this machine with Chromium 153; CPU in the
worker is a usable fallback; the main-thread path works and is kept as the last fallback.

## Privacy / network behaviour (verified, not assumed)

- Video frames never leave the browser: files are opened via object URLs; the camera stream is
  processed locally; nothing is uploaded by this app.
- **However**, `@mediapipe/tasks-vision` itself sends **usage/performance metrics to Google**:
  a `POST https://odml.pa.googleapis.com/v1/log` (protobuf, 121 bytes observed, first ~4 s after
  load, then batched every 60 s). This is documented in the package README's *Privacy Notice*
  (last modified 2026-06-05): input data is not sent, metrics are, and "you are responsible for
  obtaining informed consent from your app users". There is no public API switch to disable it.
- The logger uses the global `fetch` (no XHR or `sendBeacon`); the endpoint string appears only in
  `vision_bundle.mjs`, not in the WASM loaders. **Decision (2026-09-26, at the user's request):
  block it by default** with a local-only `fetch` guard in the page and worker plus a
  `connect-src 'self'` CSP. With the endpoint blocked, tracking continued normally (29.6
  inferences/s, no errors) and **zero** non-localhost requests were made, in dev and in the
  production build.
- Model and WASM are served locally, so the app works offline once `npm install` and
  `npm run setup:assets` have run; there is no runtime CDN dependency.

## Why this architecture

- A pure browser app (Vite + React + TS) fits "free, local, no server, no training": MediaPipe runs
  in WASM/WebGL, Canvas 2D composites. No Next.js or Python server was needed.
- Inference is in a Web Worker so decoding, drawing and the UI stay responsive; one frame in flight
  with drop-oldest backpressure bounds latency and memory.
- Pose interpretation, fit geometry and smoothing are pure TypeScript modules, unit-tested without a
  browser. React only renders controls and a 4 Hz status snapshot.
- An anchor-based affine transform (plus separately rotated sleeves) is stable and predictable;
  a triangulated warp was not added because the measured problems (bending, turning, off-screen
  hips) are interpretation problems, not warp problems.

## Live 3D garments (2026-09-26, branch `dev/live-3d-garments`)

### Sources consulted (3D work)

The installed packages' own type declarations and runtime behaviour were treated as authoritative
where they differed from online docs.

| Source | Used for |
| --- | --- |
| three.js docs: GLTFLoader, SkinnedMesh, SkeletonUtils, color management, MeshStandardMaterial/MeshPhysicalMaterial | Loading, skin binding (`bind`, `bindMode 'attached'`), safe cloning, sRGB output without tone mapping |
| `node_modules/jolt-physics/dist/types.d.ts` (1.1.0) | The actual soft-body API: `SoftBodySharedSettings` (faces, `CreateConstraints` with bend types, `mSkinnedConstraints`, `mInvBindMatrices`), `SoftBodyMotionProperties.SkinVertices`, `SetSkinnedMaxDistanceMultiplier`; no JS constructors for `InvBind`/`Skinned` (use `resize()` + `at(i)`) |
| JoltPhysics.js repository, soft-body demo, Jolt architecture docs (soft bodies) | Concepts (skinned constraints, max distance, LRA, bend types) and the layer/interface setup pattern |
| MediaPipe Pose Landmarker web guide | `worldLandmarks`: metres, origin at the hip midpoint; paired with `landmarks` by index |
| glTF Transform CLI | `inspect` / `validate` of the downloaded GLB |
| Rapier soft-body docs | Considered as an alternative only; not installed, because Jolt passed every required capability test |

### Asset findings

- The GLB is valid: 0 errors, 1 warning (skinned mesh node not at the root, harmless). 7,717
  vertices, 14,079 triangles, 19 weighted joints, no textures, no animations.
- **Every joint node has an identity local transform.** The bind pose exists only in the inverse
  bind matrices, which include Unreal's 0.01 scale. Loaded naively, the skinned shirt collapses
  into a ~35 cm blob at the origin.
- The fix, `src/garments/modelLoader.ts`, runs at load:
  1. rebuild each joint's rest transform as `inverse(parentWorld) · inverse(IBM)`;
  2. move the complete hierarchy under a clean rig root, including hands, fingers, calves, IK and
     helper nodes;
  3. re-bind with an identity bind matrix;
  4. verify on the CPU that the rest pose reproduces the vertices (measured error <0.1 mm).
- Skin space is already metres, +Y up, +X = wearer's left, front = +Z, so the documented rest
  rotation is identity.

### Coordinate conventions

| Space | Units | Axes |
| --- | --- | --- |
| MediaPipe normalized image | 0..1 of the processed frame | +x right, +y down; z relative depth |
| MediaPipe world | metres, hip-centred | +x image right, +y **down**, +z **away** from the camera |
| Body / garment rest space | metres | +x image right = wearer's **left** when facing, +y up, +z toward the camera |
| Source pixels | px | +x right, +y down (the video frame) |
| Scene (WebGL) | px | X = source x, Y = −source y, Z toward the camera; the orthographic camera spans exactly the source frame |
| Display | device px | `sourceToCanvas` affine: letterbox/cover, DPR, **mirror** |

- World → body is `(x, −y, −z)`.
- The garment root holds only a uniform px-per-metre scale and a translation; all rotation is in
  the bones.
- Mirroring is applied exactly once, when the WebGL layer is composited into the 2D canvas with the
  video's transform. Anatomical left/right is never flipped internally.

### Projection and fit (weak perspective)

- **Orientation:** torso frames are built from the world shoulders — the hips too when the
  interpreter trusts them, otherwise camera-up. A rotation about the view axis is then added so the
  *projected* shoulder line equals the image shoulder line exactly.
- **Position:** the image shoulder midpoint.
- **Scale:** image lengths ÷ projected world lengths of the same segments (shoulders, plus torso when
  the hips are usable).
- **Proportions:** the wearer's shoulder width and torso ratio are learned slowly, and only from
  near-frontal samples. Arms use the world elbow and wrist directions, but only when the interpreter
  trusted those landmarks in the image.
- No perspective FOV is assumed. Registration is checked in unit tests through the full display
  transform, and visually with the magenta anchor overlay.

### Interpreter change for 3D

- The 2D thresholds are unchanged. A 3D garment switches the interpreter to its rig limits: fade
  from 50°, hide beyond 72°, and a "narrow shoulders" ratio of cos(72°).
- **Bug found by the synthetic 3D tests:** the "foreshortened torso" rule divided the torso length by
  the *current* shoulder width. Starting tracking on someone already turned 45° was therefore
  misread as bending. In 3D mode the width is now divided by cos(yaw) first
  (`yawCompensatedWidth`); the 2D mode keeps the old behaviour.

### Jolt evaluation

A local proof (kept as `tests/unit/cloth.test.ts › Jolt capability proof`) showed:

- pinned (invMass 0) vertices follow a moving skinned joint to <0.1 mm through `SkinVertices`;
- free vertices stay within their per-vertex skinned max distance;
- vertical stretch is below 5% with rigid edges;
- a moving kinematic capsule (`MoveKinematic`) is never penetrated.

That covers every capability required, so the XPBD fallback and Rapier were not needed. Integration
findings:

1. **Linear-blend skinning distorts the target shape** near joints (armpits compress and stretch up
   to ~4×), and rigid cloth edges then fight the attachment limits. Two fixes:
   - particles whose skin weights are split between torso and arm are pinned too;
   - slightly compliant edges are used (5e-5; measured overshoot 7 cm at 0 → ~2 cm).
2. **Float rounding** sometimes produced 0 substeps for a 1/60 s frame, which left Jolt's targets a
   frame stale. Fixed with an epsilon in the step count; a frame without a step reuses the previous
   displacement.
3. **Heap layout:** `SoftBodyVertex` has a stride of 80 bytes with `mPosition` at offset 16, and a
   `Mat44` is 64 bytes, column-major. Particle positions and joint matrices are therefore
   read/written through `HEAPF32` with no per-particle allocations. Offsets are measured at runtime,
   not hard-coded.
4. **Ownership:**
   - `sIdentity()` returns an Emscripten static temporary: it is borrowed and never destroyed;
   - shared settings and shapes are ref-counted and owned by their bodies;
   - the JoltInterface, joint array and reusable vectors are destroyed on dispose.
5. **Loading:** Vite emits `jolt-physics.wasm.wasm` as a local asset (2.0 MB, 0.76 MB gzip).
   `locateFile` points to it, so the fetch guard and CSP pass; this is verified in dev and in
   production preview. No cross-origin isolation or multithreading is used.

### Rendering decisions

- The 3D garment is drawn into a **separate transparent WebGL canvas**, because the visible canvas
  owns a 2D context. That layer is then composited with `drawImage` in the same task right after
  `render()`, so `preserveDrawingBuffer` is not needed; the copy measured ≤0.1 ms.
- The layer is rendered opaque and faded as a whole with `globalAlpha`, which avoids
  double-sided transparency sorting artefacts.
- Output is sRGB with no tone mapping; the video never passes through WebGL.
- Material: MeshPhysicalMaterial (roughness ~0.86, metalness 0, light sheen, double-sided) under a
  hemisphere light, a frontal key and a weak fill. There are no shadows.
- In cloth mode the renderer switches to a plain (non-skinned) mesh. Its vertices are CPU-skinned,
  then displaced, and normals are recomputed across UV-seam welds, so nothing is skinned twice.

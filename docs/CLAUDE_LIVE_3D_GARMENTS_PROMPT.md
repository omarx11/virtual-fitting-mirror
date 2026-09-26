# Implementation prompt for Claude: live 3D fitting mirror

Read this whole prompt, inspect the repository, then implement the work. Do not stop after producing another plan. Work in stages with brief progress updates, and verify each stage before building on it. Make routine implementation decisions yourself. Ask only when a genuinely missing input prevents progress, and continue independent work meanwhile.

## Objective

Upgrade this browser fitting mirror from articulated 2D shirt images to a connected, rigged 3D garment that follows a real person's live movements. It is intended for a large touchscreen in a clothing shop. Use the downloaded V-neck shirt as the first working asset. The shirt's torso and sleeves must deform together through its skeleton. Movement must come from the tracked person, not prerecorded animation clips.

Implement live skeletal deformation, good video alignment, restrained fabric shading, approximate foreground-arm occlusion, and a working optional cloth simulation mode. Prioritize stable tracking and alignment before fabric physics. Keep the application local and usable with both webcam and uploaded video.

This is a visually improved fitting preview. Do not represent monocular tracking as accurate body measurement, physical sizing validation, or guaranteed photorealistic clothing replacement.

## Branch and working-tree rules

- Work only on `dev/live-3d-garments`. This branch was created locally during planning; verify it exists and is checked out before editing.
- Start with `git status --short` and `git branch --show-current`. If the branch is absent, create it from the intended current base with `git switch -c dev/live-3d-garments`. If it exists, switch to it without discarding unrelated work.
- Do not edit or commit on `main`, merge into `main`, push to `main`, force-push, or reset user changes. Do not push any branch unless separately instructed.
- The downloaded files were untracked under `tests/cloths/vneck/` when inspected. Preserve them. They are inputs, not disposable test output.
- Keep all implementation, asset organization, and documentation work on this development branch. Local commits, if made, belong only there.

## Inspect and reuse the existing architecture

Read any applicable `AGENTS.md`, `package.json`, README, and existing test/documentation conventions first. This repository uses React, TypeScript, Vite, MediaPipe Tasks Vision, Vitest, Playwright, and Biome. Three.js is not installed yet. Use npm and update `package-lock.json`.

Important existing files:

- `src/app/MirrorEngine.ts`: non-React engine; owns source, inference scheduler, interpretation, smoothing, rendering, and lifecycle.
- `src/tracking/poseEngine.ts`: shared inference implementation for worker and main-thread fallback.
- `src/tracking/landmarks.ts`, `protocol.ts`, `pose.worker.ts`, `backends.ts`, and `scheduler.ts`: packed landmarks, worker transfers, generation guards, and inference scheduling.
- `src/fitting/observation.ts`, `interpreter.ts`, `subject.ts`, `oneEuro.ts`, and `smoother.ts`: landmark confidence, subject selection, front-view restrictions, state transitions, and temporal filtering.
- `src/rendering/compositor.ts` and `viewTransform.ts`: current Canvas 2D output, approximate forearm occlusion, contain/cover, mirroring, resize, and DPR handling.
- `src/garments/types.ts`, `catalogue.ts`, and `loader.ts`: currently assume 2D art and separately drawn sleeves.
- `src/app/preferences.ts`, UI controls, diagnostics, and `tests/unit/`, `tests/e2e/`.
- `src/tracking/networkGuard.ts`, `vite.config.ts`, and `index.html`: local-only requests and CSP.

Critical finding: `PoseEngine.detect()` currently packs only `result.landmarks`, then closes the result. It discards `result.worldLandmarks`. The existing pose and fit pipeline is primarily 2D. Adding a GLB loader alone cannot provide the requested motion.

Preserve camera/video controls, playback, garment selection, fit adjustments, mirror/fullscreen/framing controls, keyboard and touch usability, tracking recovery, and local-only operation. Keep high-frequency data outside React state. Avoid adding a second tracker or competing animation loops.

## Downloaded asset and required organization

Current inputs:

```text
tests/cloths/vneck/source.glb
tests/cloths/vneck/SM_Shirt_01_man.fbx
tests/cloths/vneck/SM_Shirt_01_woman.fbx
```

The GLB was structurally inspected:

- 610,068 bytes; one mesh; 7,717 render vertices; 14,079 triangles.
- One skin with 19 weighted joints; position, normal, UV, joint-index, and weight attributes exist.
- Weight sums were approximately one; joint indices and inverse bind matrices passed basic checks.
- Zero embedded images/textures and zero animation clips. Missing clips are fine for live bone driving.
- Material `M_Shirt_Vneck_rolled`: double-sided, metallic 0, roughness about 0.8554.
- The GLB identifies the male source model. Do not advertise it as a converted female variant.
- Both FBXs contain a skeleton and skin. Keep them for authoring and future conversions.

Actual GLB joint names include `pelvis_00`, `spine_01_01` through `spine_05_05`, `neck_01_06`, `clavicle_l_09`, `clavicle_r_036`, `upperarm_l_010`, `upperarm_r_037`, `lowerarm_l_011`, `lowerarm_r_038`, upper-arm twist joints, and thigh joints. Inspect the entire node hierarchy, including unweighted parents. Do not assume skin-array order is hierarchy order or assume an exact unsuffixed Unreal naming scheme.

Move the assets into a clear runtime/authoring layout:

```text
public/garments/3d/vneck/shirt-male.glb
assets/garments/vneck/source/SM_Shirt_01_man.fbx
assets/garments/vneck/source/SM_Shirt_01_woman.fbx
assets/garments/vneck/SOURCE.md
```

Put future runtime textures and simulation data beside the GLB; keep authoring files out of `public/` so Vite does not ship them. Keep calibration and rig configuration in typed source files, such as `src/garments/rigs/vneck.ts`. Generate a thumbnail from the actual model. Preserve the original FBXs and verify file hashes before and after moves. On Windows, resolve and check source/destination paths before moving directories; use literal paths and never recursively delete an unchecked path. Remove old directories only if empty after verified moves.

Record the asset title, creator, source URL, observed licence label, file hashes, and transformation steps in `SOURCE.md`. This is third-party content; do not put it under the demo art's CC0 licence. Do not claim redistribution permission beyond the actual applicable licence. Asset source: [Shirt V-neck with rolled sleeves](https://www.fab.com/listings/c4079e06-cef5-440c-8963-e05fd9462828).

No matched fabric maps were present in these downloads. Start with a neutral fabric material. Do not use another shirt's UV texture and call it a match. Missing maps must not block movement implementation. Document where the correct maps can later be attached.

## Dependencies and tools

Versions below were checked against npm during planning on 2026-09-26. Verify compatibility before installing; use exact versions and keep the lockfile consistent.

Required rendering dependencies:

```powershell
npm install --save-exact three@0.186.1
npm install --save-dev --save-exact @types/three@0.186.0
```

Reuse the installed `@mediapipe/tasks-vision`; an unrelated upgrade is unnecessary. Use Three.js directly inside the existing engine. React Three Fiber and Drei are not required for this architecture.

Imports from the Three.js package include:

```ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
```

Use `SkeletonUtils.clone()` when independently cloning a skinned garment; ordinary scene cloning can leave incorrect skeleton references. An `AnimationMixer` is not needed to drive live bone rotations.

At the physics stage, evaluate and implement Jolt first:

```powershell
npm install --save-exact jolt-physics@1.1.0
```

Its JavaScript source bindings expose soft bodies, skinned constraints, and `SkinVertices`. Check the installed package's declarations and runtime exports rather than assuming upstream `main` matches the published package. Prototype moving attachment targets and collisions before applying it to the entire shirt. Use one physics engine only.

Prefer a single-thread WASM build initially. Use package exports and a local Vite-resolved WASM URL/`locateFile`, or the compatible embedded build if it works with the network guard. Verify the production bundle. Do not require CDN access or add cross-origin isolation/multithreading unless measured performance justifies it. Lazy-load physics; skeletal mode must work without it.

Optional development tooling, only if used:

```powershell
npm install --save-dev --save-exact @gltf-transform/cli@4.5.0
```

Use glTF Transform to inspect and validate any derived assets; profile before reducing a model that is already about 14k triangles. Do not blindly simplify, weld, or prune a rigged asset: preserve UV seams, required ancestor bones, skin weights, bind matrices, and garment openings. Render-mesh reduction and making a simulation proxy are different tasks.

Blender is optional for FBX conversion, rig inspection, texture baking, or preparing a simulation proxy. It is not required to load the supplied GLB, and an offline Blender cloth cache is not live browser physics. Do not silently install a large desktop application or require Unreal/MetaHuman for this implementation.

Alternative research: Rapier's current documentation describes soft bodies, so do not repeat outdated claims that Rapier is rigid-body-only. `@dimforge/rapier3d-compat` was at 0.21.0 during this research. Treat it as an alternative only after verifying the released APIs meet this garment's needs. Do not install it alongside Jolt without a concrete reason.

## Stage 1: establish a real 3D garment path

1. Capture baseline check results and organize the downloaded files.
2. Extend catalogue types with an explicit 2D/3D discriminated union. A 3D entry needs runtime model URL, preview, rig/calibration configuration, material options, and optional simulation data. Avoid fake 2D body/sleeve fields for a 3D garment.
3. Add a loader with caching, visible loading/error states, stale-load cancellation/guards, and explicit GPU resource ownership. Validate that the loaded model contains a working skinned mesh; retain the complete rig hierarchy and original bind data.
4. Add a development-only inspection view or mode: model, skeleton, axes, bounding box, neutral pose, and deterministic arm poses. Verify scale, forward/up axes, rest pose, and influence of the twist/thigh bones. Correct coordinate conventions through a documented root transform, not arbitrary per-frame rotations.
5. Integrate a real Three.js renderer. The existing visible canvas already owns a 2D context, so do not request WebGL from that same canvas.

Recommended starting composition: render the garment into a separate transparent WebGL canvas, then composite it into the existing visible 2D canvas after the video and before foreground-arm pixels/diagnostics. Match source aspect ratio, cap render resolution, and use the existing source-to-canvas transform exactly once for video and garment. Measure the canvas copy cost; a different composition is acceptable if it preserves occlusion, privacy, and exact view alignment. Never enable `preserveDrawingBuffer` as an unexplained workaround.

Start with a documented orthographic/weak-perspective projection calibrated to source-image shoulders and torso. Use world landmarks for pose orientation and normalized image landmarks for on-screen placement/scale. World coordinates are hip-relative estimates, not calibrated camera extrinsics or absolute distance. Do not pretend an arbitrary perspective FOV solves registration.

Use an opaque fabric material with sensible roughness, restrained lighting, correct color management, and preserved normals/UVs. Keep the video's colors unchanged by 3D tone mapping. Avoid excessive gloss, dramatic studio lighting, or floating shadows. Garment fades must remain visually correct with the double-sided geometry.

Make the 3D V-neck selectable and the default for the new experience. Preserve legacy demos as a comparison/fallback if useful, but never draw their separate sleeve overlays over the 3D garment. Show a clear failure state if 3D cannot load. Add a configurable development fallback for WebGL failure without implying it is still rendering 3D.

## Stage 2: preserve 3D tracking and retarget the rig

1. Extend detection output with normalized and world landmark arrays paired by detected-person index. Keep the distinction explicit in types. Copy both before closing the MediaPipe result, transfer their buffers through the worker, and support identical results from the main-thread fallback. Do not pass world-meter values into code expecting normalized image coordinates.
2. Carry the selected subject's matched world pose into the 3D path. Preserve scheduler generation checks, source timestamps, confidence checks, and stale-frame rejection. Never attach one person's world pose to another person's image pose.
3. Document conversions between MediaPipe coordinates, Three.js coordinates, garment rest space, source pixels, and display pixels. Mirror the final presentation once; anatomical left/right remains consistent internally.
4. Build the torso frame from reliable shoulder/hip landmarks, with stable handling of nearly collinear vectors and missing hips. Fit root translation/scale from image anchors, while using depth cues and world directions for body rotation. Learn stable proportions only from reliable samples; do not vary body shape rapidly with noisy landmarks.
5. Derive bone rotation corrections from the inspected bind pose and parent hierarchy. Update parents before children. Map pelvis, distributed spine motion, clavicles, upper arms, and relevant lower arms. Convert desired world orientations into parent-local rotations correctly. Preserve rest offsets and avoid cumulative rotation drift. Handle twist conservatively: pose landmarks do not observe every axial rotation. Keep thigh influences near the hem anatomically stable even when legs are off-screen.
6. Preserve connected sleeve/torso deformation. Do not split the mesh into separately positioned clothing pieces. UV seams can use duplicate vertices; this alone does not mean the garment is visually disconnected.
7. Use time-aware translation/scale filtering and quaternion smoothing with shortest-path interpolation. Bound joint motion and velocities. Handle a missing wrist/elbow with a short confidence-aware hold/fade or neutral fallback, not a sudden zero rotation.
8. Reset calibration/smoothing/physics appropriately on source changes, seek/loop, subject changes, tracking loss/reacquisition, and fit discontinuities. Clamp large time steps after hidden tabs and resume.
9. Inspect the old interpreter's front-only view rejection. Allow validated modest turns in the 3D mode without weakening the legacy 2D mode indiscriminately. Keep unsupported back/extreme side views hidden with an appropriate status; a full garment mesh alone does not guarantee reliable 360-degree tracking.

Keep size and height controls functional as visual fit adjustments. Put asset-specific offsets, rest axes, bone mapping, and supported pose limits into configuration. Do not scatter magic values throughout the renderer.

Before adding physics, demonstrate left/right arm motion, both arms raised, modest torso turns, leaning, movement toward/away from the camera, and upper-body crops with skeletal deformation alone.

## Stage 3: depth and approximate occlusion

The shirt must not always paint over the person's forearms and hands. Reuse or improve the existing depth-aware forearm video cutout after the 3D render, with soft edges and confidence/depth gating. Ensure it respects garment sleeve boundaries and does not routinely cut holes in the torso or reveal broad patches of the original shirt.

For physics, build invisible body colliders from tracked/calibrated torso and arm proportions. Keep those distinct from any renderer depth occluders; a collider does not automatically make original video pixels appear in front of the garment. If using depth-only body geometry, test that it does not erase the garment because of a bad body estimate.

MediaPipe's optional person mask is a person silhouette, not a per-pixel map of hands versus shirt and not a depth map. Do not apply the whole person mask over the garment. Leave segmentation off unless a measured improvement justifies enabling it and handling mask ownership/transfer/disposal.

Document that the original clothing may remain visible outside the replacement silhouette and inside approximate cutouts. Removing it completely requires a separate reconstruction/inpainting problem; do not conceal that limitation in the completion report.

## Stage 4: implement optional live cloth physics

Provide two working modes: stable skeletal motion and experimental cloth motion. Skeleton tracking remains the motion driver; physics adds bounded secondary deformation around it. Do not substitute looping animations, shader sine waves, or a rotating model for cloth simulation.

First make a small local Jolt proof that verifies moving skinned/pinned targets, bending/stretch resistance, and collision against a moving capsule. Then integrate those capabilities with the garment. The documented JavaScript cloth example is a reference, not a ready-made shirt fitter.

Implementation requirements:

- Use a coarse simulation surface following the actual shirt topology, initially targeting roughly 500–1,500 particles as a profiling hypothesis. A rectangular flag behind the shirt is not a sufficient proxy. If full coarse-shirt preparation is impractical, simulate meaningful hem/sleeve regions with explicit stable boundaries and honestly label the scope.
- Preserve the neckline, armholes, sleeve openings, and front/back separation. Join intentional seam duplicates in the simulation topology only through an explicit mapping and suitable constraints. Do not blindly merge nearby front/back surfaces or alter the render UV seams.
- Prepare reproducible proxy data and a mapping from simulation surface to render vertices. Preserve the source asset. Include adjacency, rest lengths/bending information, anchor weights, and a documented coordinate space.
- Strongly constrain shoulder/neck attachment regions toward the live skinned targets, with a smooth transition to freer fabric at the hem/sleeves. Use stretch resistance, bending compliance, damping, small motion limits, gravity, and simple tracked body collisions. Avoid visible rubbery stretching.
- Update attachment targets and body colliders from the same smoothed pose. Do not allow fabric to fall away from the wearer. Handle rapid motion, rotation, root movement, and fit changes without injecting large artificial impulses.
- Define how animation, video playback speed, and simulation clocks interact. Use a fixed physics timestep, bounded substeps, and interpolated targets. Freeze on paused video and reset on seeks/discontinuities; do not catch up hundreds of missed steps after resume.
- Map physics displacement back to the garment without double skinning. One valid initial approach is to calculate the current skinned baseline, add mapped proxy displacement in the same coordinate space, and render a dynamic mesh whose vertices are not then skinned again. Retain the untouched rest geometry/rig separately. If using shader displacement instead, document where skinning and displacement occur and keep normals correct.
- Recompute/update normals and bounds appropriately. Check for NaNs, divergence, excessive stretch, and penetration. Recover to the current skinned pose when unstable, record the reason, and keep the application usable.
- Avoid starting with expensive self-collision, multiple physics engines, or simulation on every render vertex. Add complexity only when measured artifacts justify it.
- Dispose WASM-owned objects according to ownership rules; do not blindly destroy borrowed references. Profile allocation and avoid per-particle JS/WASM garbage every frame.

If the published Jolt APIs cannot support a necessary attachment operation, record the concrete failed capability test and use a focused XPBD solver for the limited garment regions or a verified Rapier alternative. Do not invent missing APIs. Do not call Stage 4 complete with only a toggle, interface, or TODO. A blocked advanced feature should leave the tested skeletal implementation working, and the report must explicitly distinguish implemented physics from remaining work.

Expose physics state and detailed tuning in diagnostics/developer controls. The shopper-facing UI should remain simple, with no engine names, bone indices, or solver controls.

## Performance and lifecycle

- Target at least 30 FPS at a representative 1080p kiosk viewport on the tested machine; treat this as a target, not an unmeasured guarantee. Document the browser, machine/GPU where available, source video, actual render resolution/DPR, and settings used.
- Report render/inference rates, pose age, physics cost, mesh triangles, and quality mode. Measure before deciding that the 14k-triangle mesh needs reduction; camera copies, inference, DPR, and WASM calls may dominate.
- Allow physics to reduce update cost or disable itself under sustained overload while skeletal tracking continues. Explain the degradation in diagnostics.
- Preserve local model/WASM/texture loading and block external requests after setup. Keep existing CSP/network protection intact.
- Handle React Strict Mode, resize, fullscreen, source/garment switches, load failure, WebGL context loss, and disposal without orphaned render loops, workers, video tracks, textures, or physics objects.
- Keep future garment support data-driven: another compatible model should need an asset plus calibration/rig configuration, not renderer rewrites.

Suggested module boundaries, adapting to repository conventions:

```text
src/rendering/three/GarmentRenderer.ts
src/garments/modelLoader.ts
src/garments/rigs/vneck.ts
src/fitting/pose3d.ts
src/fitting/retargeter.ts
src/fitting/fit3d.ts
src/physics/ClothSimulation.ts
src/physics/joltCloth.ts
src/physics/bodyColliders.ts
```

Do not build a generic engine framework beyond what this feature requires.

## Verification and completion criteria

Run baseline checks and distinguish existing failures from regressions. Add focused tests for new failure-prone behavior, not tests that simply repeat implementation details.

Required automated coverage:

- Pairing/transfer of image and world landmarks, selected-subject correspondence, worker/fallback consistency, and stale generations.
- Bind/rest pose preservation, anatomical left/right, coordinate conversion, parent-local rotations, finite normalized quaternions, and missing/low-confidence landmarks.
- Garment/video registration under mirror on/off, contain/cover, portrait/landscape, resize, and DPR changes.
- Loading the actual local GLB into a skinned garment and changing geometry/bone poses under deterministic synthetic input. Do not rely solely on the presence of a canvas element.
- Physics attachment bounds, finite state and reset behavior across pause/seek/reacquisition, tested without relying on random timing.
- Switching modes/assets repeatedly, renderer failure/fallback, and local-only requests for the new assets and WASM.

Use synthetic pose sequences for deterministic behavior tests, and available local footage plus webcam for visual validation where hardware access permits. Synthetic tests do not prove real camera tracking quality. Review screenshots or recordings of neutral pose, each arm raised, crossed forearms, modest turns, and a tracking-loss/recovery sequence. Include a pose/anchor overlay to detect registration errors. Do not report webcam validation if no real camera was tested.

Run:

```powershell
npm run check
npm run test:e2e
```

Use the repository's existing Playwright setup; install its Chromium only if missing. Check the production build/preview as well as development mode so package/WASM paths and local-only loading are proven. Report skipped tests or unavailable footage explicitly. Fix regressions instead of weakening assertions to accept a broken output.

Acceptance criteria:

1. The supplied shirt loads from its new runtime location and is visibly rendered over the actual video.
2. Torso and sleeves deform together in response to live pose changes, including independent arm movement; there is no prerecorded movement driving the garment.
3. Garment and video stay registered when mirrored, resized, cropped, or switched between portrait/landscape framing.
4. The garment disappears/reacquires cleanly on unreliable poses without jumping to a different person or displaying stale motion.
5. Skeletal mode works independently; the experimental physics mode demonstrates real bounded secondary motion or is explicitly reported as incomplete with the precise blocker.
6. Foreground-arm occlusion has been visually reviewed, and remaining inaccuracies are documented.
7. Existing media/control/privacy behaviors remain functional and relevant checks pass.
8. All changes remain on `dev/live-3d-garments`; nothing is pushed or merged to `main`.

Update README plus appropriate research/testing/limitations documents with setup, architecture, asset conversion, material limitations, performance measurements, and how to add another garment. Finish with a concise report: branch, implemented behavior, changed asset locations, installed package versions, tests and visual evidence, measured performance, and concrete remaining issues. Never claim a complete realistic fitting system solely because the GLB appears on screen.

## Primary references

Use these sources to check actual APIs; follow the installed versions when examples differ. The integration decisions above are recommendations based on this repository, not promises made by these libraries.

- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html): loading the runtime asset.
- [Three.js SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html): skin attributes, bind data, and deformation.
- [Three.js SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html): safe cloning of skeleton hierarchies.
- [Three.js color management](https://threejs.org/manual/pages/color-management.html) and [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html): material rendering and texture color spaces.
- [MediaPipe Pose Landmarker for Web](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js): normalized/world landmarks, worker guidance, and person segmentation semantics.
- [JoltPhysics.js repository](https://github.com/jrouwe/JoltPhysics.js): WASM package variants, loading, and memory ownership.
- [Jolt JavaScript cloth demo](https://jrouwe.github.io/JoltPhysics.js/soft/soft_body.html) and [its source](https://github.com/jrouwe/JoltPhysics.js/blob/main/Examples/soft/soft_body.html): a basic soft-body reference.
- [Jolt JavaScript bindings](https://github.com/jrouwe/JoltPhysics.js/blob/main/JoltJS.idl): verify `SoftBodySharedSettings`, skin constraints, and `SoftBodyMotionProperties.SkinVertices` against the installed build.
- [Jolt architecture: soft bodies](https://github.com/jrouwe/JoltPhysics/blob/master/Docs/Architecture.md#soft-bodies): engine concepts and constraints.
- [Rapier JavaScript soft bodies](https://rapier.rs/docs/user_guides/javascript/soft_bodies/): alternative to evaluate only if needed.
- [Ten Minute Physics](https://matthias-research.github.io/pages/tenMinutePhysics/) and [cloth notes](https://matthias-research.github.io/pages/tenMinutePhysics/14-cloth.pdf): background for a focused XPBD fallback. Check the source licence before reusing code.
- [glTF Transform CLI](https://gltf-transform.dev/cli): asset inspection and optional optimization tooling.

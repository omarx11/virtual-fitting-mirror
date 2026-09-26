# Limitations

This is a **visual fitting preview**. A rigged 3D shirt follows the tracked person, which looks far
more convincing than the old flat overlay. It is still not a realistic try-on, and it must not be
presented as body measurement, sizing validation or guaranteed photorealistic clothing replacement.

## The 3D garment (default)

- **Monocular tracking only.** One camera and MediaPipe landmarks: orientation comes from the
  model's hip-relative *world* estimates, which are not calibrated depth or camera pose. Registration
  uses a weak-perspective projection fitted to the image shoulders (and hips when visible), so
  strong perspective effects close to the camera (large head, foreshortened torso) are not modelled.
- **No sizing.** The shirt is uniformly scaled to the person's tracked shoulder width, and the torso
  is gently stretched (×0.88–1.15) to the learned shoulder-to-hip ratio. Both are visual fits, not
  measurements, and they say nothing about which size fits.
- **Your own clothing stays visible** outside the replacement silhouette: long sleeves below the
  rolled cuffs, a collar above the stand collar, loose garments at the sides or below the hem, and
  inside forearm cutouts. Removing it would need a separate reconstruction/inpainting system, which
  is not part of this prototype.
- **Linear-blend skinning artefacts.** The model is rigged in an A-pose, and its armpit vertices are
  weighted to both the arm and the spine.
  - With arms high above the head, the armpit stretches and the rolled sleeves bunch into stubby
    shapes. Unit tests bound the stretch at 90° abduction; the 150° case is only checked for no
    tearing.
  - Axial twist of the forearm and upper arm is not observed by pose landmarks, so it is not
    applied (the twist bones follow the arm conservatively).
  - Legs are not driven: the thigh bones follow the pelvis, keeping the hem stable.
- **Collar vs. face.** The model has a stand collar. When the head drops forward (for example at the
  start of a burpee) or the neck is short in the image, the collar can overlap the chin. There is
  no face or neck occlusion.
- **Turns.** Modest turns are followed: fade from ~50°, hidden from ~72° estimated yaw. Back
  views, bending over and strong tilts are hidden with "Face the mirror", as before. A full 3D mesh
  does not make 360° tracking reliable.
- **Missing arms** (elbow/wrist not reliably visible) hold their last direction for 0.3 s, then ease
  to a neutral hanging arm. If the real arm is raised but occluded, the sleeve will hang.
- **Material.** No fabric texture maps matched the downloaded model, so it is rendered in flat
  neutral colours with a PBR fabric material (roughness ~0.86, light sheen). The video's lighting is
  not transferred to the shirt, and the colours are not calibrated to a real product.
- **Male source model only.** No female-variant GLB has been converted, and the catalogue says so.
- **Licence.** The model is third-party content from Fab. The creator name and licence label still
  need to be recorded from the listing or receipt (see `assets/garments/vneck/SOURCE.md`) before
  any public deployment.

## Experimental fabric motion (cloth mode)

What is implemented and tested:

- Real live simulation with Jolt Physics 1.1.0 (single-threaded WASM, loaded lazily).
- A ~1,000-particle proxy built from the actual shirt topology:
  - explicit seam welds;
  - front/back surfaces are never merged;
  - edge, shear and distance-bend constraints.
- Particles are pinned near the neck and shoulders and in regions where the skin weights are split
  between torso and arm. They become free toward the hem and sleeve ends, within at most 4.5 cm of
  the skinned pose.
- Gravity, damping, and four body capsules (two torso, two upper arm) that follow the tracked pose.
- A fixed 1/60 s step with at most 3 substeps, following the media clock:
  - frozen when the video is paused;
  - reset on seeks, loops, large time gaps, reacquisition and garment changes;
  - reset on instability.

What it does not do:

- **Scope of motion.** The effect is deliberately subtle: hem and sleeve sway, lag during fast
  turns, and settling under gravity. Root movement across the screen (walking sideways) is not fed
  into the solver as inertia, which avoids artificial impulses.
- **Not modelled:** fabric-on-fabric self-collision; sleeve collision against the forearm (only the
  upper arms have capsules); wind; material-specific parameters (one tuning for this shirt).
- **The proxy is coarse** (3.5 cm voxels), so fine wrinkles come from the modelled mesh and skinning,
  not the simulation. Very short proxy edges at pinned/free boundaries can stretch locally: the
  worst frame of a ±40°/1.5 Hz turning stress test reached p99 ×1.23, and single-edge maxima of about
  ×1.6 were observed on real footage. Displacements are clamped to the allowed deviation + 2 cm
  before rendering.
- **Very fast limb motion** can briefly exceed the allowed deviation. It is clamped, and repeated
  large violations reset the fabric (visible as a small settle).

## Foreground arms (approximate occlusion)

- **"Arms in front (beta)"** stays off by default. It redraws original video pixels in soft-edged
  capsules around forearms and hands, but only when the world landmarks put the wrist at least
  ~12 cm in front of the torso plane (through the shoulder joints). The shirt front itself lies
  ~10 cm in front of that plane. The cutout starts past the elbow so the rolled sleeve end is not
  cut.
- **Accuracy.** It is a landmark capsule, not segmentation: it can reveal a sliver of the original
  shirt beside the forearm, or miss part of a hand.
- **Validation.** It was reviewed on the available clips: no holes in the torso and no broad reveals
  were observed. **No footage with forearms crossed in front of the chest was available**, so that
  case is verified only by synthetic unit tests.
- **No person mask.** MediaPipe's person mask is not used: it is a whole-person silhouette, not an
  arm-vs-shirt or depth map.

## Legacy 2D garments

The four flat demo shirts remain for comparison. They are images moved, scaled and rotated as a
whole, with separately rotating sleeves. They follow front views only; the 2D thresholds were not
relaxed.

## Tracking and partial-body framing

- **The head must be visible.** The model card lists "head not visible" as out of scope, and the
  app uses face landmarks to tell front from back. If the face is above the top of the frame, the
  status asks the user to move back.
- **Upper-body mode** (hips off-screen) works from the first frame:
  - For 2D shirts, length comes from shoulder width × a torso ratio (default 1.35, or learned from
    full-body frames).
  - For the 3D shirt, the torso frame uses camera-up when the hips are unreliable, and the torso
    stretch uses the learned ratio (default ×1).
  - Hips within 5% of the bottom edge are ignored: MediaPipe often reports off-screen hips just
    inside the edge with high visibility.
- **Estimated landmarks are not ground truth.** Off-screen or occluded points are guesses by the
  model; the app only trusts landmarks that are both visible and in-bounds.
- **One person.** With several people the app keeps the previously tracked person and prefers to
  fade out rather than jump. After 1.5 s without them, the largest, most central person is picked.
  In the crowd test clip, the garment appeared on another person after the dancer was lost.
- **Distance.** Beyond ~4 m (model card), or with very small shoulders (<12 px), tracking is
  unreliable or rejected.
- **Temporal behaviour.** Short dropouts (≤350 ms) are bridged, then the shirt fades out. Poses more
  than 250 ms older than the displayed frame are not drawn.
- **Tuning.** Thresholds were tuned on public clips (`test-footage/SOURCES.md`), not on the final
  mirror setup. Re-tune `src/config/tracking.ts` and `src/garments/rigs/vneck.ts` for the real
  camera, lighting and distance.

## Camera

- Camera mode was exercised only with **Chromium's synthetic fake camera**. **No physical webcam was
  tested**, including with the 3D shirt.
- Camera access needs a secure context: `http://localhost` works during development; any other
  address requires HTTPS.

## Privacy and network

- Video (file or camera) is processed in the browser and is **never uploaded**. No footage or
  screenshots are saved; only UI preferences go to `localStorage`.
- **MediaPipe usage metrics are blocked by default** in two layers: a local-only `fetch` guard
  (page and worker) and a `connect-src 'self'` CSP.
- The GLB, the MediaPipe WASM and models, and the Jolt WASM are all served from the app's origin.
  The e2e privacy tests assert that no request leaves localhost with the 3D shirt and cloth mode
  active, in dev and in the production preview.

## Browsers and hardware

- Verified in Chromium 153 (Playwright, headless, real GPU through ANGLE/D3D11) on Windows with an
  AMD RX 9070 XT. Firefox, Safari and weaker kiosk GPUs were not tested.
- Fallbacks:
  - WebGL failure shows a clear "3D shirt unavailable" state. In `npm run dev` only, a flat 2D
    image is drawn and labelled "not 3D".
  - A lost WebGL context hides the garment until it is restored.
  - Cloth overload first reduces solver work, then disables the cloth layer.

## Sensible next steps

1. Record the Fab creator and licence in SOURCE.md; test on the real kiosk camera, distance and
   lighting.
2. Validate foreground-arm occlusion and turns on consented footage with crossed arms and slow 360°
   turns.
3. Attach matched fabric maps when available, and consider simple shading transfer from the video.
4. Improve armpit deformation with corrective skinning (dual-quaternion skinning or helper joints)
   if raised arms matter.
5. Add forearm colliders and a proxy tuned per fabric if cloth mode becomes a product feature.

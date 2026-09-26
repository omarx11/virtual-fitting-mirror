# Limitations

This is a **2D shirt overlay prototype**. It is useful for demonstrating the idea of a virtual
mirror; it is not a realistic try-on and should not be presented as one.

## What a 2D overlay cannot do

- **No fabric simulation.** The shirt is a flat image moved, scaled and rotated as a whole; sleeves
  rotate with the upper arms. It does not drape, fold, stretch or react to motion.
- **It does not replace your clothes.** Real clothing stays visible around the edges (especially
  loose or long garments, collars, long sleeves and trousers above the hem).
- **No sizing.** Garment width and length follow the tracked shoulders and an approximate torso
  length. That is not a body measurement and says nothing about which size would fit. The UI never
  claims a "perfect fit".
- **Front view only.** Side views, back views and bending over are detected and the shirt fades out
  with "Face the mirror". A 2D front image cannot represent a 360° view.
- **Look.** Flat demo art with painted shading; the real video's lighting is not applied to the shirt.

## Tracking and partial-body framing

- **The head must be visible.** The model card lists "head not visible" as out of scope, and the
  app uses face landmarks to tell front from back. If the face is above the top of the frame, the
  status asks the user to move back.
- **Upper-body mode** (hips off-screen) works from the first frame. Shirt length then comes from
  shoulder width × a torso ratio: the default is 1.35, or the ratio learned from recent full-body
  frames of the same person. It is a visual approximation. MediaPipe often reports off-screen hips
  *inside* the bottom edge with high visibility, so hips within 5% of the bottom edge are ignored.
- **Estimated landmarks are not ground truth.** Off-screen or occluded points are guesses by the
  model; the app only trusts landmarks that are both visible and in-bounds.
- **Crossed arms / arms in front** ("Arms in front (beta)", off by default): when a forearm is
  estimated to be in front of the torso, the original video pixels are drawn back over the shirt
  inside a capsule around the forearm and hand. The capsule is approximate: it can reveal a sliver
  of the real clothing or miss part of the arm. **It was not validated on real crossed-arm
  footage** (none was available). Whole-person segmentation cannot separate the arms from the
  torso, so it was not used for this.
- **One person.** The model is designed for a single person. With several people the app keeps the
  previously tracked person (by position and size, with no face recognition) and would rather fade
  out than jump to someone else. After the tracked person has been gone for more than 1.5 s, the
  largest, most central person is picked. In the crowded test clip (dance), the garment appeared on
  other people after the dancer was lost, and was hidden most of the time because of constant
  turning.
- **Distance.** Beyond ~4 m (model card) or with very small shoulders (<12 px in the source frame),
  tracking is unreliable or rejected.
- **Temporal behaviour.** Short dropouts (≤350 ms) are bridged, then the shirt fades out; it never
  stays frozen on an empty scene. Poses more than 250 ms older than the displayed frame are not drawn.
- Thresholds were tuned on four public clips (see `test-footage/SOURCES.md`), not on the final
  mirror setup. Expect to re-tune `src/config/tracking.ts` for the real camera, lighting and distance.

## Camera

- Camera mode was exercised only with **Chromium's synthetic fake camera**. It was **not tested with
  a physical webcam** (none was connected). Real devices can differ in resolution, frame rate,
  exposure, and how they report "device in use".
- Camera access needs a secure context: `http://localhost` works during development; any other
  address requires HTTPS.

## Privacy and network

- Video (file or camera) is processed in the browser and is **never uploaded** by this app. No
  footage or screenshots are saved; only UI preferences go to `localStorage`.
- **MediaPipe usage metrics are blocked by default.** Unmodified, `@mediapipe/tasks-vision` 1.0.1
  POSTs small performance/usage metrics to `https://odml.pa.googleapis.com/v1/log` (documented in
  its privacy notice; observed as one 121-byte request a few seconds after load). This app blocks
  all non-local requests in two independent layers:
  1. a local-only `fetch` guard (`src/tracking/networkGuard.ts`) installed in the page and in the
     worker before MediaPipe runs. MediaPipe's logger uses `fetch`, and this works on any host;
  2. `Content-Security-Policy: connect-src 'self' …` as a `<meta>` tag (page) and as a dev/preview
     response header (worker).

  Verified: with either layer alone, and with both, no request left localhost (dev server,
  production build, worker and main-thread fallback). With both removed, the test catches the
  request. Tracking is unaffected. Caveat: a future MediaPipe version could use a different network
  API; the CSP layer and `tests/e2e/privacy.spec.ts` are there to catch that. Rerun the e2e tests
  after upgrading.
- After `npm install` and `npm run setup:assets`, the app runs offline; the model and WASM are
  served locally.

## Browsers and hardware

- Verified in Chromium 153 on Windows with an AMD RX 9070 XT (details in TESTING.md). Firefox and
  Safari were not tested. The code has fallbacks (rAF when `requestVideoFrameCallback` is missing,
  CPU when GPU init fails, main-thread inference when the worker fails), but behaviour there is
  unverified.
- Performance on the actual kiosk PC is unknown until measured there (diagnostics panel).

## Sensible future improvements

1. Real garment cutouts with measured anchors, and per-garment sleeve parts.
2. Shading transfer: modulate the shirt with the video's luminance for folds and lighting.
3. A dedicated body-part / clothing segmentation model for arm occlusion — only if its licence,
   speed and quality are verified.
4. Mesh warping (piecewise affine on shoulders, waist and hips) once real footage shows a need.
5. Calibrating the torso ratio and fit defaults on the real mirror setup.
6. Testing Firefox/Safari, and a physical webcam at the kiosk distance.

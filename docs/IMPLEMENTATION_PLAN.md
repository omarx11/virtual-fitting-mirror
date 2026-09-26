# Implementation plan and status

Last updated: 2026-09-26.

## Phases

| # | Phase | Status | Notes |
| --- | --- | --- | --- |
| 1 | Inspect and research | ✅ Done | Empty workspace (only this prompt). Node 24.19 / npm 11.17, git, Chrome 153, cached Playwright Chromium, ffmpeg, network all available. **No blocking manual prerequisites.** Findings in RESEARCH.md. |
| 2 | Prove the technical path | ✅ Done | `spike.html`: worker + GPU + Lite/Full on real footage, CPU and main-thread variants measured. Found the 3.3 s first-inference shader warm-up and ~30–220 ms `setOptions` reset cost. |
| 3 | Baseline try-on | ✅ Done | Common source abstraction (file/camera), worker inference with backpressure, anchor-based placement, 4 demo shirts, controls, error states. |
| 4 | Resilience | ✅ Done | Tracking state machine with hysteresis, upper-body start, bounded hold + fade, reacquisition reset, subject selection, back/side/bend rejection, face-visibility gate, One Euro smoothing, generation IDs, stale-pose rejection, visibility pause, Strict Mode-safe cleanup. |
| 5 | Polish and evaluate | ✅ Done (with limits) | Responsive landscape/kiosk/phone layout, keyboard and a11y, diagnostics, articulated sleeves, experimental forearm occlusion (off by default: not validated on real crossed-arm footage), telemetry finding and opt-in blocking. |
| 6 | Verify and document | ✅ Done | Type-check, lint, 60 unit tests, Playwright suite, production build, soak test, performance matrix; README, RESEARCH, TESTING, LIMITATIONS. |

## Key decisions

- **Vite + React + TypeScript (strict)**, npm; no backend.
- **MediaPipe Tasks `PoseLandmarker` 1.0.1, VIDEO mode, in a module Web Worker**, GPU delegate with
  automatic CPU fallback, then a main-thread fallback at ≤12 inferences/s.
- **WASM from the installed npm package via Vite `?url`** (so JS and WASM versions cannot diverge);
  **models version-pinned and SHA-256 verified** by `scripts/setup-assets.mjs`.
- **Default quality "Balanced" = Full model**, processing long side 640 px. On the dev machine it
  keeps up with 30 fps video; "Fast" = Lite model at 512 px.
- **numPoses = 2**, so a second person does not silently replace the subject; the app picks the
  subject itself.
- **Anchor-based affine garment + rotating sleeves**, no mesh warp (no demonstrated need).
- **Display strategy:** draw the newest video frame with the most recent smoothed pose; poses older
  than 250 ms are not drawn. Measured pose age is ~1 frame (33 ms median) on the dev machine.
- **Experimental occlusion is off by default** because it could not be validated.

## Blockers / needs from the user

None block the software. For a real acceptance evaluation:

1. **Your recorded video** was not in the workspace. Real-footage checks used openly licensed
   clips instead (TESTING.md). Run the app on your own clip and walk through the matrix in TESTING.md.
2. **A physical webcam** was not available. Camera mode was only exercised with Chromium's fake
   device.
3. ~~MediaPipe usage metrics~~ — **resolved:** blocked by default (fetch guard + CSP), verified by
   `tests/e2e/privacy.spec.ts`.

## Next steps (if continuing)

1. Test with your video and webcam at the kiosk; tune `src/config/tracking.ts` and garment `fit`.
2. Replace demo SVGs with real garment cutouts (see `public/garments/LICENSE.md`).
3. Shading transfer from the video to the shirt (see LIMITATIONS.md → future improvements).
4. Test Firefox/Safari if they are targets.
5. Add a `LICENSE` file for the project code if it will be shared.

## Resuming work

`npm ci && npm run setup:assets && npm run fetch:footage && npm run check && npm run test:e2e`
recreates the full verified state. Real-footage e2e tests are skipped if the footage is missing.

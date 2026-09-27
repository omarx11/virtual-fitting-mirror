# Claude implementation prompt: add AI as the third fitting option

Read this prompt and `docs/AI_TRYON_RESEARCH.md`, inspect the repository, then implement the feature. Complete the working integration and verification, not another planning-only response. Give concise progress updates. Preserve existing functionality and user work.

## User decisions and scope

- Add an explicit **2D / 3D / AI** mode selector. AI is a generated photo preview; existing 2D and 3D remain live tracked previews.
- The owner chose **cloud API inference** for easier setup and accepts paid generation and external photo processing. Do not install local inference stacks or download model weights for this implementation.
- Use FASHN through a server-side adapter. Default to **Try-On Max, fast, 1K, one output**, with v1.6 performance as an optional developer-configured comparison preset. Validate these combinations against current official docs and account capabilities.
- Do not promise live 30-FPS generative try-on. Capture, generate, then display the result. No continuous upload, automatic refresh generation, prerecorded animation, or image-to-video feature is requested.
- Work exclusively on `development`. Inspect status and branch first, preserve existing commits and untracked work, and do not switch back to the former `dev/live-3d-garments` branch. Leave `main` untouched until the owner explicitly says otherwise. Do not merge, force-push, deploy, or push new work as part of this prompt.
- Do not purchase credits, create an account, or read unrelated secrets. Implement and test with a fake provider before credentials are supplied. A missing API key must not prevent completing the UI, real adapter, backend, tests, and setup instructions. A live paid smoke test is a separate explicit command using approved test images; do not infer permission to spend from a discovered key.

## Existing app: inspect before changing

Read applicable `AGENTS.md`, package scripts, README, existing tests, and these integration points:

- `src/app/App.tsx`, `MirrorEngine.ts`, `useMirrorEngine.ts`, and `preferences.ts`.
- `src/components/GarmentPicker.tsx`, `ViewControls.tsx`, `SourceControls.tsx`, and stage/diagnostics components.
- `src/garments/catalogue.ts` and `types.ts`: currently a 2D/3D garment union; picker cards group some colour variants.
- `src/rendering/compositor.ts`: the visible canvas contains the video PLUS garment and diagnostic overlays.
- `src/media/` and the engine's privately owned video source: reuse it for capture, without a second camera stream.
- `src/tracking/networkGuard.ts`, `vite.config.ts`, and `index.html`: browser requests currently restricted to same origin.
- `tests/unit`, `tests/e2e`, `playwright.preview.config.ts`, and documented local footage.

The project is React/TypeScript/Vite on Node >=22.12, with MediaPipe and Three.js/Jolt. It currently has no cloud-facing backend. Keep the existing framework; do not migrate to Next.js just because the vendor provides a Next.js example. Avoid unrelated upgrades.

## Dependencies

Versions below were read from npm on 2026-09-27. Check compatibility and pin the versions actually used in `package-lock.json`.

```powershell
npm install --save-exact fashn@0.15.0 fastify@5.12.5 @fastify/multipart@10.1.2 @fastify/rate-limit@11.2.0 @fastify/static@10.1.5 sharp@0.35.4
npm install --save-dev --save-exact tsx@4.23.15 concurrently@10.0.5
```

- `fashn`: official server-side SDK; never import it into browser modules.
- Fastify: small backend; JSON-schema validation is sufficient, so an additional validation package is optional, not mandatory.
- Multipart plugin: bounded image uploads; enforce limits on the stream before buffering.
- Rate-limit plugin: one protection against accidental/repeated requests. It does not replace job deduplication or spending limits.
- Static plugin: serve built frontend at the same origin as the API.
- Sharp: decode/validate, apply EXIF orientation, strip metadata, and normalize uploads safely.
- `tsx` and `concurrently`: cross-platform development scripts. Use native Node environment-file support or another small justified approach; keep secrets entirely server-side.

No PyTorch, CUDA, ROCm, Python, diffusion packages, Hugging Face download, ComfyUI, or extra Three.js package is required. If an installed package now has incompatible requirements, select a verified compatible release and document why.

## Shopper experience

Provide a clearly labelled selector: `2D`, `3D`, `AI`. Keep separate last-selected garment preferences where needed. Migrate existing stored preferences without breaking them; retain the existing 3D default until the user chooses AI.

AI workflow:

1. Show an ordinary live camera/video preview with no virtual garment painted into it. Guide one person to face the camera with torso visible and arms slightly clear of clothing. Handle tracking unavailability without crashing; a user-supplied still image can also be supported for testing.
2. `Capture photo` freezes a clean frame for review. Provide `Retake`. For video input, capture the current decoded frame and preserve playback state appropriately.
3. Select a garment product photo from an AI-compatible catalogue. Support a local garment-photo upload for development so missing shop assets do not block testing.
4. Explain that AI sends the captured photo and garment to FASHN. Provide a concise per-session opt-in before the first upload and a link/details view for retention. Do not persist consent across unrelated kiosk customers.
5. `Generate preview` starts one request. Selection, entering AI mode, capture, or a countdown alone must not trigger cloud generation. Disable duplicate submissions while active; show elapsed time and honest stage labels rather than invented percentage completion.
6. Show the AI result as a still image, with a clear `AI-generated preview` label, garment identity, before/after comparison, `Retake`, `Try another garment`, and `End session`.
7. Trying another garment uses the SAME original captured photo if the customer chooses to keep it; do not repeatedly feed previous generated results back into the model.
8. Returning to 2D/3D restores live controls and stops AI polling. Late responses must never reappear over live mode or the next customer's screen.

Use touch-friendly controls and keyboard accessibility. Keep provider/model names and tuning parameters in diagnostics/operator configuration. Briefly explain that appearance may differ from the real product; do not claim accurate sizing, identical logos, or perfect identity preservation.

Model AI state explicitly: inactive, unconfigured, ready-to-capture, capture-review, submitting, queued, generating, result, error, and abandoned/expired as needed. Keep capture/session/request tokens so garment changes, retakes, mode switches, and component remounts cannot display a stale result.

Pause unnecessary cloth rendering/pose work while a still result is displayed, without losing the camera stream or breaking return to the live modes. Handle React Strict Mode without extra submissions.

## Clean capture and garment assets

Add a bounded engine API such as `captureSourceFrame()` that returns a Blob plus source dimensions/time. Draw from the underlying `HTMLVideoElement` into a temporary canvas, not from the stage canvas. Verify there is no rendered shirt, landmark overlay, status label, letterbox background, or screen UI in the uploaded image.

Capture canonical unmirrored pixels. Present the input/result consistently with the current mirror setting, applying the display transform once. Preserve aspect ratio and EXIF orientation for uploaded photos. Do not distort a landscape frame into a portrait image; allow an explicit crop/review if necessary. Keep the same crop and orientation for before/after comparison and account for output dimensions.

An AI garment needs a **product photograph**, not skeleton/skin data. Add a small independent AI catalogue/capability type rather than pretending an AI entry has 2D anchors or 3D bones. Include product/variant ID, label, preview, local image path, category, photo type, provenance, and demo flag. Share product identity with existing modes where meaningful; allow an item to support only some modes.

Suggested locations:

```text
public/garments/ai/<product-id>/product.jpg
public/garments/ai/<product-id>/preview.jpg
assets/garments/<product-id>/SOURCE.md
src/garments/aiCatalogue.ts
```

Use real owner-provided shop photos when available, ideally a clear front/flat-lay or ghost-mannequin view showing the whole garment. Never scrape paid photos or assume demo/example images are licensed for shop deployment. An isolated render of the existing V-neck may serve as a visibly labelled synthetic demo, but its missing textures prevent it from representing a real shop product accurately. Existing GLB/FBX files remain in their current proper locations; do not move them again.

Do not mislabel a catalogue thumbnail as an adequate product image. Colour variants require corresponding image inputs; changing a Three.js material does not update an AI product photograph automatically. Let the developer upload a garment image when no suitable fixture exists, and distinguish the resulting technical test from shop-product validation.

## Backend and network architecture

Browser -> same-origin `/api/ai/*` -> local Node backend -> FASHN. Default backend binding is `127.0.0.1`. Preserve the browser's local-only fetch guard and CSP. The new backend is the only component allowed to call the configured cloud provider; update privacy claims to describe this accurately.

Development: Vite proxies `/api` to the local backend. Production: build the existing frontend, then have the backend serve `dist/` plus its API, or document an equivalent same-origin reverse proxy. A static `dist/` upload alone cannot run this feature. Add development, production, and preview-test scripts; preserve existing commands wherever practical. Ensure unknown `/api/*` routes return JSON 404s, not the SPA HTML fallback.

Suggested files:

```text
src/ai/types.ts
src/ai/client.ts
src/ai/useAiTryOn.ts
src/components/TryOnModeSelector.tsx
src/components/AiTryOnPanel.tsx
src/components/AiResultView.tsx
server/app.ts
server/index.ts
server/config.ts
server/ai/routes.ts
server/ai/jobs.ts
server/ai/images.ts
server/ai/providers/fashn.ts
server/ai/providers/fake.ts
server/ai/catalogue.ts
tests/server/
```

Keep server modules outside the browser import graph. Add server typechecking and tests to the repository's check workflow. Reuse schema/type definitions without importing server SDK or Node modules into React.

Define an application-owned API, for example:

- `GET /api/ai/capabilities`: configured/disabled state and enabled presets; no key disclosure or paid provider call.
- `POST /api/ai/session`: create a short-lived, private local session.
- `POST /api/ai/jobs`: multipart clean person photo and catalogue garment ID (or permitted temporary garment upload), preset, consent version, client request UUID. Validate everything before submission; return 202 and an opaque local job ID.
- `GET /api/ai/jobs/:id`: sanitized status; poll through the backend with throttling/caching.
- `GET /api/ai/jobs/:id/result`: decoded image bytes, with `Cache-Control: no-store` and correct content type.
- `DELETE /api/ai/jobs/:id` and/or session deletion: abandon result and purge local customer images; do not claim this cancels cloud processing or refunds it.

Own jobs through an ephemeral session, such as an HttpOnly SameSite cookie plus appropriate origin/CSRF controls. Check ownership on every read, result retrieval, and deletion. IDs alone are not permission. Reject arbitrary provider prediction IDs from clients. Validate Origin/Host, avoid wildcard CORS, and do not expose an unauthenticated billable endpoint on a public host. The initial localhost-only kiosk does not require inventing a full account system; any later network deployment must add suitable access control and HTTPS.

Keep the job store bounded and simple. Use a short documented local result TTL, for example two minutes after completion, and a kiosk idle timeout. Clear captured photo/results on End session and between customers. Retain only the minimal non-image job metadata needed to discard late output and prevent duplicate charging. Expiry must be enforced server-side even if the browser disappears.

## Provider implementation

Use the official `fashn` SDK server-side. Read the installed typings; its current API includes `client.predictions.run(...)` and `client.predictions.status(id)`. Prefer separate submission/polling behind our job API. Configure `maxRetries: 0` for generation submission and prevent sensitive SDK debug logging. Retrying status reads with bounded backoff is different from submitting another paid generation.

Documented REST operations are `POST https://api.fashn.ai/v1/run` and `GET https://api.fashn.ai/v1/status/{id}`, with Bearer authentication. All endpoint-specific parameters belong inside `inputs`.

Default request construction:

```ts
{
  model_name: 'tryon-max',
  inputs: {
    model_image: personDataUri,
    product_image: productDataUri,
    generation_mode: 'fast',
    resolution: '1k',
    num_images: 1,
    output_format: 'jpeg',
    return_base64: true,
    seed
  }
}
```

Optional faster comparison preset:

```ts
{
  model_name: 'tryon-v1.6',
  inputs: {
    model_image: personDataUri,
    garment_image: productDataUri,
    category: 'tops',
    garment_photo_type: 'flat-lay',
    mode: 'performance',
    num_samples: 1,
    output_format: 'jpeg',
    return_base64: true,
    seed
  }
}
```

Category/photo type must come from actual product metadata, not a hardcoded value for all garments. The two models have different parameter names: do not send `garment_image`, `mode`, or `num_samples` to Max. Explicitly set the chosen generation mode so provider defaults do not silently increase cost. Do not add optional prompts that reshape bodies or redesign garments. Keep normal provider safety controls; report rejected inputs without disabling protections automatically.

Validate provider response shape before use. Map starting/in_queue/processing/completed/failed and any documented terminal SDK states into our state machine. Handle missing/empty output, invalid base64, expired output markers, unknown states, account errors, moderation/pose errors, rate limits, provider failures, and timeouts. Parse only expected raster image data URIs with strict size/type limits; decode to local image responses. Do not forward arbitrary provider URLs or HTML to the browser. If supporting documented CDN output as a fallback, enforce a narrow HTTPS hostname allowlist and response/redirect limits.

Define bounded polling and an overall job deadline, with elapsed time shown to the user. Network loss while polling must not automatically start a replacement job. The SDK source indicates that stopping its polling does not guarantee server cancellation; preserve that distinction in UI and documentation.

## Secrets, spending, and image handling

Provide `.env.example` with placeholders such as:

```dotenv
FASHN_API_KEY=
AI_PROVIDER=fashn
AI_PRESET=max-fast-1k
AI_ENABLED=false
AI_PORT=3001
AI_MAX_CONCURRENT_JOBS=1
AI_MAX_DAILY_CREDITS=20
AI_RESULT_TTL_SECONDS=120
```

Names/defaults can be refined, but enforce the documented behavior. Add actual environment files to `.gitignore`, preserving the example. Never use a `VITE_` prefix for secrets or ask the user to paste a secret into chat. Give instructions to enter it locally. Do not expose key suffixes in diagnostics unnecessarily.

Spend controls:

- One output per explicit Generate action, one active job per kiosk/session initially, and bounded global concurrency.
- Deduplicate a client request UUID atomically before the first provider POST. Bind it to the session and request payload; reject reuse with different inputs. Test simultaneous duplicate requests, not just repeated sequential clicks.
- Do not automatically retry a POST after an ambiguous timeout or connection failure. The provider may have accepted it. Mark the outcome uncertain and retain its budget reservation rather than risk a second charge.
- Reserve expected credits before submission; reconcile from provider results/headers when available. Keep unknown/abandoned submissions conservatively reserved. A local daily cap needs a durable, atomic, non-image usage ledger if it is meant to survive process restarts; document its scope and timezone. Rate limiting alone is not a daily spending cap.
- Do not silently switch to a more expensive preset or send batches. An explicit new generation is a new possible charge. A cancelled local view does not imply a cancelled charge.

Image handling:

- Set conservative application input limits, for example 8 MiB per image and a bounded decoded pixel count. Distinguish our limits from the vendor's limits. Enforce multipart byte/count limits before buffering; reject decompression bombs, corrupt data, animated images, SVG, and unsupported formats.
- Decode with Sharp, apply orientation, strip metadata, and preserve aspect ratio. Resize only when intentionally limiting upload cost/dimensions, using a documented quality target. Account for base64 expansion in outbound request limits.
- Resolve catalogue files from an allowlisted directory/manifest. Never accept arbitrary filesystem paths or fetch arbitrary customer-supplied URLs.
- Send photo and product as data URIs for this initial integration; no public storage bucket is needed. Drop raw local input buffers after submission/processing as soon as feasible.
- Do not write customer images/base64 to logs, localStorage, IndexedDB, session-replay tools, repository fixtures, or disk by default. Disable body logging and SDK debug output. Revoke object URLs and clear browser references on reset.
- Do not say cloud images are immediately deleted. Link current provider retention terms: local cleanup cannot control their retained request metadata or temporary processing copies.

The user's cloud choice authorizes this architecture. Customer-facing opt-in remains a product requirement because different shoppers will use the kiosk. Keep that flow short and understandable, not an implementation checklist.

## Configuration and fallback behavior

With no backend/key, 2D and 3D must still run. AI should show a useful unconfigured/unavailable state with operator setup instructions; never display a fake generated success. Show service errors in the AI panel without taking down the camera or renderer.

Implement a deterministic fake provider for offline tests and development only. Mark its output unmistakably as a test result, disable it in production by default, and never claim fake-provider success proves image quality or a live paid integration.

Do not store consent/photos in existing preference persistence. Save only harmless settings. Avoid automatic cloud fallback for either live mode. Switching away from AI should immediately abandon UI consumption of pending jobs; stale completion must be discarded even after a new session starts.

## Tests and quality evidence

Run the existing baseline checks before changes and fix regressions. Add meaningful tests for:

- Mode selection and preference migration; last-selected live garment settings preserved.
- Raw capture excludes overlays and handles mirror, crop, portrait/landscape, no frame, camera changes, and source seeking.
- Missing key/backend, accepted/rejected consent, valid/invalid product inputs, byte/pixel limits, orientation, and EXIF removal.
- Session isolation, cross-session job/result denial, local cleanup/TTL, unknown routes, and CSRF/origin checks.
- Correct distinct request schemas for Max and v1.6, base64 image validation, and sanitized error mapping.
- Concurrent duplicate clicks produce exactly one provider submission; ambiguous submission timeouts cause no automatic retry; budget reservations remain sound across failures and restart.
- Queue/status progression, recoverable polling interruption, abandonment, late completion after reset, and mode switching during generation.
- Browser makes same-origin calls only; backend calls only the intended provider in a controlled mocked integration; no external calls occur in 2D/3D, before consent, or in normal tests.
- Production frontend bundle excludes credentials/server modules; production serves API and frontend at one origin, with private results uncached.

Include server tests in `npm run check` or a clearly documented mandatory additional command. Run existing unit and e2e suites plus production-preview tests, adapting their server setup to the new architecture. Keep GPU-heavy or paid tests out of ordinary CI.

Add an opt-in real-provider smoke command with one explicitly approved image pair and a one-output cap. Record preset, image dimensions, observed total and provider latency, actual credits where reported, and result quality. Do not run paid tests merely because a key exists. If a key or approved photo is unavailable, finish all independent work and report real inference as **not verified**, alongside the exact remaining setup steps.

For actual visual review, inspect faces/identity, garment colour, text/logos, seams, sleeves, crossed arms, background preservation, body shape, and transitions from loose/long clothing to fitted/short clothing. Test the actual webcam and touchscreen when available. Do not equate passing mocked tests with a successful AI try-on or a store-ready deployment.

## Definition of done

1. The app visibly exposes three options: 2D, 3D, AI, and preserves the live modes.
2. AI captures a clean frame, accepts a suitable garment image, obtains session opt-in, and creates one controlled backend job on Generate.
3. A real FASHN adapter is implemented, with keys restricted to the server and correct model-specific schemas.
4. Results display as still AI previews with comparison/retake/end-session controls; old results cannot leak into a new customer's session.
5. Setup, missing credentials, provider failures, spending bounds, privacy text, cleanup, tests, and production routing are implemented.
6. Automated tests pass, and the final report clearly separates offline/mock validation from any real paid/camera tests.
7. All work remains on `development`; `main` is untouched.

Update README and relevant testing/privacy/limitations documents. Finish with a concise report of implemented behavior, packages, tests, setup commands, local credential placement, estimated per-generation cost with a dated source, and any unverified real-world behavior. Do not say AI is fully working if only the UI or fake provider was exercised.

## Primary references

Use current official docs and installed types when older examples disagree:

- [FASHN TypeScript SDK guide](https://docs.fashn.ai/sdk/typescript)
- [Official SDK source](https://github.com/fashn-AI/fashn-typescript-sdk) and [prediction implementation](https://github.com/fashn-AI/fashn-typescript-sdk/blob/main/src/resources/predictions.ts)
- [Official sample try-on app](https://github.com/fashn-AI/tryon-nextjs-app): reference implementation, not a reason to migrate frameworks; preserve licence notices if reusing code
- [Try-On Max parameters](https://docs.fashn.ai/api-reference/tryon-max)
- [Try-On v1.6 parameters](https://docs.fashn.ai/api-reference/tryon-v1-6)
- [Authentication, run/status, billing](https://docs.fashn.ai/api-overview/api-fundamentals)
- [Error handling](https://docs.fashn.ai/api-overview/error-handling)
- [API setup](https://docs.fashn.ai/getting-started/api-setup)
- [Current API pricing](https://help.fashn.ai/plans-and-pricing/api-pricing)
- [Image preprocessing](https://docs.fashn.ai/guides/image-preprocessing-best-practices)
- [Provider retention and privacy](https://docs.fashn.ai/api-overview/data-retention-privacy)
- [Fastify guide](https://fastify.dev/docs/latest/Guides/Getting-Started/), [multipart](https://github.com/fastify/fastify-multipart), [rate limits](https://github.com/fastify/fastify-rate-limit), [static serving](https://github.com/fastify/fastify-static)
- [Sharp image metadata](https://sharp.pixelplumbing.com/api-input/)

For the broader GitHub model comparison and deferred local/video options, see `docs/AI_TRYON_RESEARCH.md`. Do not mix those research pipelines into the selected cloud implementation.

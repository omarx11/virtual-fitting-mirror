# AI-mode product photos: provenance

AI mode sends a **product photograph** of the garment to the try-on provider. The images in
`public/garments/ai/<id>/` (`product.jpg` 800 × 1000, `preview.jpg` 240 × 240) are **demo
stand-ins**. They are not shop photography and must not be presented as real products.

They were generated on 2026-09-27 by `npm run generate:ai-garments`
(`scripts/generate-ai-garments.mjs`) from this project's own sources only. Nothing was scraped or
downloaded.

| ID | Source | Licence | Limits |
| --- | --- | --- | --- |
| `vneck-stone`, `vneck-navy` | Rendered from the rigged 3D V-neck model (`public/garments/3d/vneck/shirt-male.glb`) in a neutral pose, one fabric colour per image | Derived from the third-party Fab asset; see `assets/garments/vneck/SOURCE.md` | The model has **no fabric texture**, so the render shows no weave, stitching detail or print. It is a synthetic demo, not the product. |
| `coral-crew-tee`, `breton-stripe-tee`, `chambray-button-shirt`, `forest-v-neck` | Rasterized from the project's original 2D demo SVG artwork (`public/garments/<id>/preview.svg`) | CC0-1.0 (see `public/garments/LICENSE.md`) | Flat illustration, not a photograph. The try-on model may interpret it loosely. |

Each colour variant has its own image. Changing a 3D material does not change an AI product
photograph.

## Adding real shop products

1. Use photos the shop owns or is licensed to use for this purpose. Do not assume demo or example
   images from vendors are licensed for deployment.
2. Prefer a clear front **flat-lay** or **ghost-mannequin** photo showing the whole garment on a
   plain background, or an on-model photo (then set `photoType: 'model'`).
3. Put the photo at `public/garments/ai/<product-id>/product.jpg` (JPEG/PNG/WebP, under 8 MiB) and a
   square `preview.jpg`.
4. Add an entry to `src/garments/aiCatalogue.ts` with the real `category`, `photoType`, provenance
   text, `demo: false`, and `liveGarmentId` if the same product exists in 2D/3D.
5. Record the source and licence in this file.

The developer "Upload a garment photo" option is for technical tests only; it does not validate a
shop product.

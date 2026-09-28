# AI-mode product photos: provenance

AI mode sends a **product photograph** of the garment to the try-on provider. The images live in
`public/garments/ai/<id>/` (`product.jpg`, and a square 240 × 240 `preview.jpg` for the picker) and
are built by `npm run generate:ai-garments` (`scripts/generate-ai-garments.mjs`).

## Real garments (product photos)

Supplied by the project owner on 2026-09-28 as WebP product shots and kept unmodified in
`assets/garments/ai/photos/<id>.webp`; the generator converts them to JPEG. Each shows the garment
alone (flat-lay or ghost mannequin) with **no person**: on-model photos were dropped because the
provider copied the model's face and accessories onto the user. None of them is a product sold by
this project. **Their licence is not recorded here — confirm the right to use them before any
public deployment** (see "Adding real shop products" below).

| ID | Original file | For | Category / photo type |
| --- | --- | --- | --- |
| `dress-green-lace` | `AW3325s5.webp` | Women | one-pieces / flat-lay |
| `dress-teal-floral` | `F48262s5.webp` | Women | one-pieces / flat-lay |
| `dress-cream-botanical` | `H18491s5.webp` | Women | one-pieces / flat-lay |
| `jumpsuit-navy-sequin` | `417010s5.webp` | Women | one-pieces / flat-lay |
| `jumpsuit-black-dot` | `AJ6386s9.webp` | Women | one-pieces / flat-lay |
| `thobe-white` | `1_org_zoom.webp` | Men | one-pieces / ghost mannequin (black backdrop) |
| `thobe-gold-trim` | `H72370s7.webp` | Men | one-pieces / flat-lay |

## Demo renders

| ID | Source | Licence | Limits |
| --- | --- | --- | --- |
| `vneck-stone`, `vneck-navy` | Rendered from the rigged 3D V-neck model (`public/garments/3d/vneck/shirt-male.glb`) in a neutral pose, one fabric colour per image | Derived from the third-party Fab asset; see `assets/garments/vneck/SOURCE.md` | The model has **no fabric texture**, so the render shows no weave, stitching detail or print. It is a synthetic demo, not the product. |

The earlier flat CC0 illustrations (coral, Breton stripe, chambray, forest tees) were removed from AI
mode on 2026-09-28; they remain the legacy 2D live garments.

Each colour variant has its own image. Changing a 3D material does not change an AI product
photograph.

## Adding real shop products

1. Use photos the shop owns or is licensed to use for this purpose. Do not assume demo or example
   images from vendors are licensed for deployment.
2. Use a clear front **flat-lay** or **ghost-mannequin** photo showing the whole garment on a
   plain background, with no person in it (an on-model photo lets the provider copy the model's
   face and accessories onto the user).
3. Put the original at `assets/garments/ai/photos/<id>.webp`, add the ID to `PHOTOS` in
   `scripts/generate-ai-garments.mjs` and run `npm run generate:ai-garments -- --photos-only`.
4. Add an entry to `src/garments/aiCatalogue.ts` with the real `category`, `photoType`, provenance
   text, `demo: false`, and `liveGarmentId` if the same product exists in 2D/3D.
5. Record the source and licence in this file.

The developer "Upload a garment photo" option is for technical tests only; it does not validate a
shop product.

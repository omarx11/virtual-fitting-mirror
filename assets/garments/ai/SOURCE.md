# AI-mode product photos: provenance

AI mode sends a **product photograph** of the garment to the try-on provider. The images live in
`public/garments/ai/<id>/` (`product.jpg`, and a square 240 × 240 `preview.jpg` for the picker) and
are built by `npm run generate:ai-garments` (`scripts/generate-ai-garments.mjs`).

## Real garments (stock photos)

Downloaded on 2026-09-28 and kept unmodified (1600 px wide) in `assets/garments/ai/photos/`. They
show real garments worn by models; none of them is a product sold by this project. The Pexels and
Unsplash licences allow free use and modification, including commercially, without attribution;
credit is given anyway.

| ID | Photo | Photographer | Licence | Category / photo type |
| --- | --- | --- | --- | --- |
| `dress-green` | [Woman in a Green Dress](https://www.pexels.com/photo/woman-in-a-green-dress-11046451/) | Vika Kirillova | [Pexels licence](https://www.pexels.com/license/) | one-pieces / on model |
| `dress-purple` | [Elegant woman in a long, stylish purple dress](https://www.pexels.com/photo/elegant-woman-in-a-long-stylish-purple-dress-36414508/) | abubakar mamman | [Pexels licence](https://www.pexels.com/license/) | one-pieces / on model |
| `thobe-white` | [Man in white thobe standing](https://unsplash.com/photos/I4B-IZ7cd-g) | Abdulrhman Alkhnaifer | [Unsplash licence](https://unsplash.com/license) | one-pieces / on model |
| `fanila-white` | [Photo of a Man Wearing a White Tank Top](https://www.pexels.com/photo/photo-of-a-man-wearing-a-white-tank-top-15072827/) | Sharon Snider | [Pexels licence](https://www.pexels.com/license/) | tops / on model (cropped above the shorts) |

Not found: an openly licensed photo of a Saudi **sirwal** (white drawstring trousers). Only the
fanila (undershirt) half of the sirwal-and-fanila set is offered until a licensed photo exists; add it
as `bottoms` following the steps below.

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
2. Prefer a clear front **flat-lay** or **ghost-mannequin** photo showing the whole garment on a
   plain background, or an on-model photo (then set `photoType: 'model'`).
3. Put the photo at `public/garments/ai/<product-id>/product.jpg` (JPEG/PNG/WebP, under 8 MiB) and a
   square `preview.jpg`.
4. Add an entry to `src/garments/aiCatalogue.ts` with the real `category`, `photoType`, provenance
   text, `demo: false`, and `liveGarmentId` if the same product exists in 2D/3D.
5. Record the source and licence in this file.

The developer "Upload a garment photo" option is for technical tests only; it does not validate a
shop product.

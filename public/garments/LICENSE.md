# Demo garment artwork

All files in this folder are **original placeholder artwork** created for this prototype by
`scripts/generate-garments.mjs`. They are not real products. Dedicated to the public domain under
**CC0-1.0** (https://creativecommons.org/publicdomain/zero/1.0/).

| Garment | Folder | Parts |
| --- | --- | --- |
| Coral crew tee | `coral-crew-tee/` | body, left/right sleeve, preview |
| Breton stripe | `breton-stripe-tee/` | body, left/right sleeve, preview |
| Chambray shirt | `chambray-button-shirt/` | body, left/right sleeve, preview |
| Forest V-neck | `forest-v-neck/` | body, left/right sleeve, preview |

## Anchors (body image 600 × 720, front view)

The wearer's LEFT side is on the image's RIGHT.

| Anchor | Pixel | Normalized |
| --- | --- | --- |
| Wearer's left shoulder seam | (425, 120) | (0.7083, 0.1667) |
| Wearer's right shoulder seam | (175, 120) | (0.2917, 0.1667) |
| Neck centre | (300, 95) | (0.5, 0.1319) |
| Hem centre | (300, 680) | (0.5, 0.9444) |

Sleeves are 200 × 170 with the pivot at (100, 22) and the long axis pointing down (+y).
Fit defaults (in `src/garments/catalogue.ts`): `widthScale 1.18`, `lengthScale 0.97`,
`verticalOffset −0.12` shoulder widths.

## Replacing with a real garment

1. Photograph the garment flat and front-on; cut it out to a transparent PNG (any size).
2. Measure the shoulder seams and hem centre in pixels and divide by the image size.
3. Add an entry to `GARMENTS` in `src/garments/catalogue.ts` with `body`, `anchors`, `fit`,
   `license` (author/source of the photo) and omit `sleeves` (they stay baked into the photo).
4. Only use images you own or that are licensed for this use, and record the licence.

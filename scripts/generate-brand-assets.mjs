/**
 * Builds the web-sized Qassim University brand images from the original logo in assets/brand/.
 * Outputs are committed and imported by the app (Vite fingerprints them), so this only needs to run
 * again when the source logo changes: `npm run generate:brand`.
 */
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const SOURCE = 'assets/brand/qassim-university-logo.png';
const OUT = 'src/assets/brand';
mkdirSync(OUT, { recursive: true });

// Full lockup (English + Arabic wordmarks), shown at up to ~360 CSS px wide → 2x for high-DPI.
await sharp(SOURCE)
  .resize({ width: 720 })
  .webp({ quality: 90, alphaQuality: 100 })
  .toFile(`${OUT}/qassim-university-logo.webp`);

// The lattice mark alone, for the collapsed sidebar rail and small badges. The crop box also catches
// the tops of the English and Arabic wordmarks in its bottom corners; those are erased first.
const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="175">
    <rect x="0" y="140" width="58" height="35"/><rect x="238" y="130" width="62" height="45"/>
  </svg>`,
);
const lattice = await sharp(SOURCE)
  .extract({ left: 340, top: 0, width: 300, height: 175 })
  .composite([{ input: mask, blend: 'dest-out' }])
  .png()
  .toBuffer();
await sharp(lattice)
  .trim()
  .resize({ height: 128 })
  .webp({ quality: 90, alphaQuality: 100 })
  .toFile(`${OUT}/qassim-university-mark.webp`);

for (const name of ['qassim-university-logo.webp', 'qassim-university-mark.webp']) {
  const { width, height, size } = await sharp(`${OUT}/${name}`).metadata();
  console.log(`${name}: ${width}×${height}${size ? `, ${size} B` : ''}`);
}

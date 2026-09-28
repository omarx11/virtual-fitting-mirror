/**
 * Builds the web-sized Qassim University brand images from the original logo in assets/brand/, and
 * the link-preview (Open Graph) image from public/icon.svg. Outputs are committed (the brand images
 * are imported by the app, so Vite fingerprints them), so this only needs to run again when a
 * source changes: `npm run generate:brand`.
 */
import { mkdirSync, readFileSync } from 'node:fs';
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

// Link-preview image: the app icon, square and under 600 px so chat apps and social sites show it
// as the small thumbnail beside the title and description. Drawn full-bleed (no rounded corners):
// crawlers flatten transparency to white or black, and most previews round the thumbnail anyway.
const icon = readFileSync('public/icon.svg', 'utf8').replace('rx="16"', 'rx="0"');
await sharp(Buffer.from(icon), { density: 72 * (512 / 64) })
  .resize(512, 512)
  .png({ compressionLevel: 9 })
  .toFile('public/og-image.png');

for (const path of [
  `${OUT}/qassim-university-logo.webp`,
  `${OUT}/qassim-university-mark.webp`,
  'public/og-image.png',
]) {
  const { width, height, size } = await sharp(path).metadata();
  console.log(`${path}: ${width}×${height}${size ? `, ${size} B` : ''}`);
}

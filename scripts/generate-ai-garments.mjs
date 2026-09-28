#!/usr/bin/env node
// Generates the product photos used by AI mode (public/garments/ai/<id>/product.jpg + preview.jpg):
//   - photos: product-only shots of real garments (no person), kept in assets/garments/ai/photos/
//     (sources in assets/garments/ai/SOURCE.md);
//   - vneck-*: DEMO renders of the actual 3D V-neck model (neutral pose, one fabric colour each) via
//     the development inspection view in Playwright's Chromium. The model has no fabric texture.
// Real shop products need real, owner-provided photos (see assets/garments/ai/SOURCE.md).
//
// Usage: npm run generate:ai-garments
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = join(root, 'public', 'garments', 'ai');
const PRODUCT = { width: 800, height: 1000 };
const PREVIEW = 240;
const BACKGROUND = { r: 242, g: 240, b: 236 };

/** Places a garment image (any size, may be transparent) centred on a light product backdrop. */
async function writeProduct(id, input) {
  const dir = join(outRoot, id);
  mkdirSync(dir, { recursive: true });
  const inner = await sharp(input)
    .resize(Math.round(PRODUCT.width * 0.86), Math.round(PRODUCT.height * 0.86), {
      fit: 'contain',
      background: { ...BACKGROUND, alpha: 0 },
    })
    .png()
    .toBuffer();
  const product = await sharp({
    create: { ...PRODUCT, channels: 3, background: BACKGROUND },
  })
    .composite([{ input: inner, gravity: 'center' }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  await sharp(product).toFile(join(dir, 'product.jpg'));
  await sharp(product)
    .resize(PREVIEW, PREVIEW, { fit: 'contain', background: BACKGROUND })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(join(dir, 'preview.jpg'));
  console.log(`[ai-garments] wrote ${id}`);
}

/**
 * Product-only photos (flat-lay / ghost mannequin, no person), kept as supplied (WebP) in
 * assets/garments/ai/photos/<id>.webp and converted to JPEG here.
 */
const PHOTOS = [
  'dress-green-plaid',
  'dress-teal-floral',
  'dress-cream-botanical',
  'jumpsuit-navy-sequin',
  'jumpsuit-black-dot',
  'thobe-white',
  'thobe-gold-trim',
];
const PHOTO_LONG_SIDE = 1400;

for (const id of PHOTOS) {
  const source = join(root, 'assets', 'garments', 'ai', 'photos', `${id}.webp`);
  const dir = join(outRoot, id);
  mkdirSync(dir, { recursive: true });
  // The photo's own backdrop colour (top-left corner) pads the square thumbnail.
  const corner = await sharp(source).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer();
  const backdrop = { r: corner[0], g: corner[1], b: corner[2] };
  await sharp(source)
    .rotate()
    .flatten({ background: backdrop })
    .resize(PHOTO_LONG_SIDE, PHOTO_LONG_SIDE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(join(dir, 'product.jpg'));
  // Whole garment in the square thumbnail.
  await sharp(source)
    .rotate()
    .flatten({ background: backdrop })
    .resize(PREVIEW, PREVIEW, { fit: 'contain', background: backdrop })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(join(dir, 'preview.jpg'));
  console.log(`[ai-garments] wrote ${id}`);
}
if (process.argv.includes('--photos-only')) process.exit(0);

// 3D V-neck renders from the actual model.
const server = await createServer({ root, server: { port: 5182, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5182/';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=default'] });
try {
  for (const material of ['stone', 'navy']) {
    const page = await browser.newPage();
    await page.goto(`${url}?inspect=3d&thumbnail&material=${material}`);
    await page.waitForSelector('[data-testid=inspect-canvas][data-rendered]', { timeout: 60_000 });
    const dataUrl = await page.evaluate(() => {
      const src = document.querySelector('[data-testid=inspect-canvas]');
      const { data, width, height } = src.getContext('2d').getImageData(0, 0, src.width, src.height);
      let x0 = width;
      let y0 = height;
      let x1 = 0;
      let y1 = 0;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (data[(y * width + x) * 4 + 3] > 8) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
      if (x1 <= x0 || y1 <= y0) throw new Error('Nothing was rendered');
      const out = document.createElement('canvas');
      out.width = x1 - x0 + 1;
      out.height = y1 - y0 + 1;
      out.getContext('2d').drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    });
    await writeProduct(`vneck-${material}`, Buffer.from(dataUrl.split(',')[1], 'base64'));
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

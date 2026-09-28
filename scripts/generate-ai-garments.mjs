#!/usr/bin/env node
// Generates the product photos used by AI mode (public/garments/ai/<id>/product.jpg + preview.jpg):
//   - photos: real garments worn by models, from free-licence stock photos kept in
//     assets/garments/ai/photos/ (sources and licences in assets/garments/ai/SOURCE.md);
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
 * On-model stock photos. `keep` trims the photo to the garment being offered (fractions of the
 * height, e.g. the fanila photo stops above the model's shorts); `focus` is the vertical centre of
 * the square picker thumbnail, as a fraction of the kept height.
 */
const PHOTOS = [
  { id: 'dress-green', focus: 0.47 },
  { id: 'dress-purple', focus: 0.45 },
  { id: 'thobe-white', focus: 0.5 },
  { id: 'fanila-white', focus: 0.42, keep: [0, 0.66] },
];
const PHOTO_LONG_SIDE = 1400;

for (const { id, focus, keep = [0, 1] } of PHOTOS) {
  const source = join(root, 'assets', 'garments', 'ai', 'photos', `${id}.jpg`);
  const { width, height } = await sharp(source).metadata();
  const top = Math.round(height * keep[0]);
  const kept = Math.round(height * (keep[1] - keep[0]));
  const dir = join(outRoot, id);
  mkdirSync(dir, { recursive: true });
  const trimmed = await sharp(source).rotate().extract({ left: 0, top, width, height: kept }).toBuffer();
  await sharp(trimmed)
    .resize(PHOTO_LONG_SIDE, PHOTO_LONG_SIDE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(join(dir, 'product.jpg'));
  // Square thumbnail across the garment: full width, centred on `focus`.
  const side = Math.min(width, kept);
  const y = Math.max(0, Math.min(kept - side, Math.round(kept * focus - side / 2)));
  await sharp(trimmed)
    .extract({ left: Math.round((width - side) / 2), top: y, width: side, height: side })
    .resize(PREVIEW, PREVIEW)
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

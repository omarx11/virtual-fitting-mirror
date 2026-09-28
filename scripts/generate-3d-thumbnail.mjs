#!/usr/bin/env node
// Renders the catalogue thumbnail FROM THE ACTUAL 3D MODEL (not hand-drawn art): starts a Vite dev
// server, opens the development inspection view in thumbnail mode (neutral pose, default fabric,
// transparent background) in Playwright's Chromium, crops to the garment and writes a 256×256 PNG.
//
// Usage: npm run generate:3d-thumbnail [-- <garment id>]   (default: every 3D garment)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 3D garment ID → thumbnail path (keep in step with the 3D entries in src/garments/catalogue.ts). */
const TARGETS = {
  'vneck-3d': join(root, 'public', 'garments', '3d', 'vneck', 'preview.png'),
  'vneck-women-3d': join(root, 'public', 'garments', '3d', 'vneck', 'preview-female.png'),
};
const only = process.argv[2];
if (only && !TARGETS[only]) throw new Error(`Unknown 3D garment "${only}"`);
const SIZE = 256;

const server = await createServer({ root, server: { port: 5181, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5181/';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=default'] });
try {
  for (const [id, out] of Object.entries(TARGETS)) {
    if (only && id !== only) continue;
    const page = await browser.newPage();
    await page.goto(`${url}?inspect=3d&thumbnail&garment=${id}`);
    await page.waitForSelector('[data-testid=inspect-canvas][data-rendered]', { timeout: 60_000 });
    const dataUrl = await page.evaluate((size) => {
      const src = document.querySelector('[data-testid=inspect-canvas]');
      const ctx = src.getContext('2d');
      const { data, width, height } = ctx.getImageData(0, 0, src.width, src.height);
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
      const side = Math.max(x1 - x0, y1 - y0) * 1.06;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const out = document.createElement('canvas');
      out.width = size;
      out.height = size;
      const o = out.getContext('2d');
      o.imageSmoothingQuality = 'high';
      o.drawImage(src, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
      return out.toDataURL('image/png');
    }, SIZE);
    writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`[thumbnail] wrote ${out}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

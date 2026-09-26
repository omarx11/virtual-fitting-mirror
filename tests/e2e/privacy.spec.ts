// Verifies that nothing leaves the machine while tracking runs — in particular MediaPipe's usage
// metrics POST to odml.pa.googleapis.com (normally sent ~4 s after the tracker starts).
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURES, openApp, openFile, snap, waitForTracker } from './helpers';

function watchExternal(page: Page): string[] {
  const external: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname) && !['blob:', 'data:'].includes(url.protocol)) {
      external.push(r.url());
    }
  });
  return external;
}

for (const mode of ['worker', 'main-thread fallback'] as const) {
  test(`no requests leave localhost while tracking (${mode})`, async ({ page }) => {
    const external = watchExternal(page);
    // Forcing the worker script to fail exercises the main-thread MediaPipe path.
    if (mode === 'main-thread fallback') await page.route('**/pose.worker*', (r) => r.abort());
    await openApp(page);
    await waitForTracker(page);
    expect((await snap(page)).tracker.backend).toBe(mode === 'worker' ? 'worker' : 'main-thread');
    await openFile(page, join(FIXTURES, 'synthetic-pattern.webm'));
    await expect
      .poll(async () => (await snap(page)).diagnostics.scheduler?.completed ?? 0)
      .toBeGreaterThan(5);
    await page.waitForTimeout(8000);
    expect((await snap(page)).diagnostics.scheduler?.errors).toBe(0);
    expect(external).toEqual([]);
  });
}

test('3D garment + cloth physics assets load locally and nothing leaves localhost', async ({ page }) => {
  const external = watchExternal(page);
  const local: string[] = [];
  page.on('request', (r) => local.push(new URL(r.url()).pathname));
  await openApp(page, { motion: 'cloth' });
  await waitForTracker(page);
  await openFile(page, join(FIXTURES, 'synthetic-pattern.webm'));
  await expect.poll(() => local.some((p) => /jolt-physics.*\.wasm$/.test(p)), { timeout: 20_000 }).toBe(true);
  expect(local.some((p) => p.endsWith('/garments/3d/vneck/shirt-male.glb'))).toBe(true);
  await page.waitForTimeout(6000);
  expect(external).toEqual([]);
});

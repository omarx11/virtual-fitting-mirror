// REAL-FOOTAGE checks. Skipped unless the licensed clips were fetched with
// `node test-footage/fetch-footage.mjs` (see test-footage/SOURCES.md). These verify behaviour on
// real model output for the specific clips listed; they are not a general accuracy claim.
import { expect, test } from '@playwright/test';
import { footage, hasFootage, openApp, openFile, snap, waitForTracker } from './helpers';

const UPPER = 'derived_upper_landscape.mp4';
const FULL = 'Jumping_jacks_and_burpees.webm';
const BACK = 'Squat_-_exercise_demonstration_video.webm';

test.describe('real footage', () => {
  test('upper-body clip initialises without a full-body frame and shows the garment', async ({ page }) => {
    test.skip(!hasFootage(UPPER), 'test footage not downloaded');
    await openApp(page, { mirror: false });
    await waitForTracker(page);
    await openFile(page, footage(UPPER));
    await expect
      .poll(async () => ['upper', 'full'].includes((await snap(page)).phase), { timeout: 10_000 })
      .toBe(true);
    await expect
      .poll(async () => (await snap(page)).diagnostics.opacity, { timeout: 5000 })
      .toBeGreaterThan(0.5);
  });

  test('seek backwards / restart on real tracking: no errors, no stale pose carried over', async ({
    page,
  }) => {
    test.skip(!hasFootage(FULL), 'test footage not downloaded');
    await openApp(page);
    await waitForTracker(page);
    await openFile(page, footage(FULL));
    await expect.poll(async () => (await snap(page)).phase, { timeout: 10_000 }).toBe('full');
    await page.evaluate(() =>
      (window as unknown as { __mirror: { seek(t: number): void } }).__mirror.seek(30),
    );
    // Immediately after a seek, the old pose must not be shown.
    const right = await snap(page);
    expect(right.diagnostics.opacity).toBeLessThan(0.05);
    await page.getByRole('button', { name: 'Restart' }).click();
    await expect.poll(async () => (await snap(page)).phase, { timeout: 10_000 }).toBe('full');
    expect((await snap(page)).diagnostics.scheduler?.errors).toBe(0);
  });

  test('back view is not dressed with a front garment', async ({ page }) => {
    test.skip(!hasFootage(BACK), 'test footage not downloaded');
    await openApp(page);
    await waitForTracker(page);
    await openFile(page, footage(BACK));
    await page.waitForTimeout(4000);
    const s = await snap(page);
    expect(s.phase).toBe('turned');
    expect(s.diagnostics.opacity).toBeLessThan(0.05);
  });
});

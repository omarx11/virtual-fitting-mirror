import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { collectErrors, currentTime, FIXTURES, openApp, openFile, snap, waitForTracker } from './helpers';

const pattern = join(FIXTURES, 'synthetic-pattern.webm');

test.describe('app shell and tracker', () => {
  test('loads, starts the tracker in a worker, and cleans up the Strict Mode double mount', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await expect(page.getByRole('heading', { name: 'Virtual fitting mirror' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open a video file' })).toBeVisible();
    await waitForTracker(page);
    const s = await snap(page);
    expect(s.tracker.backend).toBe('worker');
    // React Strict Mode mounts twice in development; the first engine's worker must be gone.
    await expect.poll(() => page.workers().length, { timeout: 5000 }).toBe(1);
    expect(errors).toEqual([]);
  });

  test('model download failure shows an actionable error and Retry recovers', async ({ page }) => {
    await page.route('**/models/*.task', (route) => route.fulfill({ status: 404, body: 'missing' }));
    await openApp(page);
    await waitForTracker(page, 'error');
    expect((await snap(page)).tracker.kind).toBe('model-missing');
    await expect(page.getByText(/setup:assets/)).toBeVisible();
    // The rest of the app keeps working without tracking.
    await openFile(page, pattern);
    await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
    await expect(page.getByTestId('status')).toContainText('Tracking unavailable');
    await page.unroute('**/models/*.task');
    await page.getByTestId('status').getByRole('button', { name: 'Retry' }).click();
    await waitForTracker(page);
  });
});

test.describe('local video file', () => {
  test('plays, pauses, seeks, restarts, loops and switches garments without reloading the model', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await openApp(page, { mirror: false });
    await waitForTracker(page);
    await openFile(page, pattern);
    await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
    const s0 = await snap(page);
    expect(s0.source.width).toBe(320);
    expect(s0.source.height).toBe(240);
    expect(s0.playback.loop).toBe(true);
    const initMs = s0.tracker.info?.initMs;

    // Playing → frames are inferred (no person in this synthetic clip).
    await expect
      .poll(async () => (await snap(page)).diagnostics.scheduler?.completed ?? 0)
      .toBeGreaterThan(5);
    await expect(page.getByTestId('status')).toContainText('Step into view');

    // Pause.
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect.poll(async () => (await snap(page)).playback.paused).toBe(true);

    // Paused: no continuous duplicate inference.
    const pausedA = (await snap(page)).diagnostics.scheduler?.submitted ?? 0;
    await page.waitForTimeout(700);
    const pausedB = (await snap(page)).diagnostics.scheduler?.submitted ?? 0;
    expect(pausedB - pausedA).toBeLessThanOrEqual(1);

    // Garment switch while paused: selection changes, no model reload, no new timeline.
    const genBefore = (await snap(page)).diagnostics.generation;
    await page.getByRole('radiogroup', { name: 'Try-on mode' }).getByRole('radio', { name: /^2D/ }).click();
    await expect(page.getByRole('button', { name: /Shirt \(2D\)/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('radio', { name: 'Breton stripe' }).click();
    await expect(page.getByRole('radio', { name: 'Breton stripe' })).toHaveAttribute('aria-checked', 'true');
    let s = await snap(page);
    expect(s.tracker.info?.initMs).toBe(initMs);
    expect(s.diagnostics.generation).toBe(genBefore);

    // Seek backwards while paused → new generation, still no errors.
    await page.evaluate(() =>
      (window as unknown as { __mirror: { seek(t: number): void } }).__mirror.seek(0.5),
    );
    await expect.poll(async () => (await snap(page)).diagnostics.generation).toBeGreaterThan(genBefore);
    await expect.poll(() => currentTime(page)).toBeCloseTo(0.5, 1);

    // Play again, switch garment while playing.
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(async () => (await snap(page)).playback.paused).toBe(false);
    await page.keyboard.press(']'); // next 2D colour
    await expect(page.getByRole('radio', { name: 'Chambray' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radiogroup', { name: 'Try-on mode' }).getByRole('radio', { name: /^3D/ }).click();
    await expect(page.getByRole('button', { name: /V-neck \(3D\)/ })).toHaveAttribute('aria-pressed', 'true');
    s = await snap(page);
    expect(s.tracker.info?.initMs).toBe(initMs);

    // Loop: the 4 s clip wraps around without timestamp errors.
    const genBeforeLoop = s.diagnostics.generation;
    await expect
      .poll(async () => (await snap(page)).diagnostics.generation, { timeout: 8000 })
      .toBeGreaterThan(genBeforeLoop);
    expect((await snap(page)).playback.ended).toBe(false);

    // Restart.
    await page.getByRole('button', { name: 'Restart' }).click();
    await expect.poll(() => currentTime(page)).toBeLessThan(1.5);

    // Loop off → ends.
    await page.getByRole('button', { name: 'Loop' }).click();
    await expect.poll(async () => (await snap(page)).playback.loop).toBe(false);
    await expect.poll(async () => (await snap(page)).playback.ended, { timeout: 8000 }).toBe(true);

    expect((await snap(page)).diagnostics.scheduler?.errors).toBe(0);
    expect(errors).toEqual([]);
  });

  test('rejects an undecodable file with an explanation and stays usable', async ({ page }) => {
    await openApp(page);
    await openFile(page, join(FIXTURES, 'not-a-video.mp4'));
    await expect.poll(async () => (await snap(page)).source.state).toBe('error');
    await expect(page.getByRole('alert').first()).toContainText(/cannot play|could not be decoded|MP4|WebM/i);
    await openFile(page, pattern);
    await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
  });

  test('mirror, framing, fullscreen-safe resize and portrait viewport keep a valid canvas', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await openApp(page, { mirror: true });
    await openFile(page, pattern);
    await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
    await page.keyboard.press('m');
    await page.selectOption('.view-controls select', 'cover');
    for (const vp of [
      { width: 1080, height: 1920 },
      { width: 390, height: 844 },
      { width: 1600, height: 900 },
    ]) {
      await page.setViewportSize(vp);
      await expect
        .poll(async () => {
          const c = (await snap(page)).diagnostics.canvasSize;
          const box = await page.locator('.stage').boundingBox();
          return box ? Math.abs(c.width - Math.round(box.width)) <= 2 : false;
        })
        .toBe(true);
    }
    expect(errors).toEqual([]);
  });

  test('controls are keyboard reachable with visible labels', async ({ page }) => {
    await openApp(page);
    await openFile(page, pattern);
    await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
    for (const name of ['Pause', 'Restart', 'Loop', 'Shirt', 'Mirror', 'Fullscreen', 'Reset fit']) {
      await expect(page.getByRole('button', { name: new RegExp(name) }).first()).toBeVisible();
    }
    await expect(page.getByRole('slider', { name: 'Size' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Height' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Seek' })).toBeVisible();
    // Tab reaches a garment button.
    let found = false;
    for (let i = 0; i < 25 && !found; i++) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(() => document.activeElement?.classList.contains('garment') ?? false);
    }
    expect(found).toBe(true);
  });
});

test.describe('camera', () => {
  test('no camera / denied: explains the problem and video mode still works', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Use camera' }).click();
    await expect.poll(async () => (await snap(page)).source.state).toBe('error');
    const s = await snap(page);
    expect(['no-camera', 'permission-denied', 'camera-busy', 'unknown']).toContain(s.source.errorKind);
    await expect(page.getByRole('alert').first()).toBeVisible();
    await openFile(page, pattern);
    await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
  });
});

test.describe('research page', () => {
  test('loads on its own, shows every screenshot, and links back to the mirror', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/research');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Behind the mirror');
    // The mirror (and its tracker worker) is not started on this page.
    expect(page.workers()).toHaveLength(0);
    const images = page.locator('.rs-gallery img');
    await expect(images).toHaveCount(4);
    for (const img of await images.all()) {
      await img.scrollIntoViewIfNeeded();
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
        .toBeGreaterThan(0);
    }
    await page.getByRole('link', { name: 'Back to the mirror' }).click();
    await page.waitForFunction(() => '__mirror' in window);
    expect(errors).toEqual([]);
  });

  test('is linked from the About dialog', async ({ page }) => {
    await openApp(page);
    await page
      .getByRole('button', { name: /About this project/ })
      .first()
      .click();
    await expect(page.getByRole('link', { name: /Research, testing/ })).toHaveAttribute('href', '/research');
  });
});

test.describe('language', () => {
  test('switches the whole app to Saudi Arabic, right to left, and remembers it', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await page.getByTestId('language-toggle').first().click();
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('lang', 'ar-SA');
    await expect(page).toHaveTitle('مرآة القياس الافتراضية');
    await expect(page.getByRole('heading', { name: 'مرآة القياس الافتراضية' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'افتح ملف فيديو' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'وضع التجربة' })).toBeVisible();
    // The sidebar stays on the right of the mirror (the page layout does not flip), its content reads
    // right to left, and nothing spills sideways.
    const panel = await page.getByRole('complementary').boundingBox();
    const stage = await page.getByRole('main').boundingBox();
    expect(panel && stage && panel.x > stage.x).toBe(true);
    expect(await page.getByRole('complementary').evaluate((el) => getComputedStyle(el).direction)).toBe(
      'rtl',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Status messages follow the language too.
    await openFile(page, pattern);
    await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
    await expect(page.getByTestId('status')).toContainText(/[\u0600-\u06FF]/);

    await page.reload();
    await page.waitForFunction(() => '__mirror' in window);
    await expect(html).toHaveAttribute('dir', 'rtl');
    // L switches back.
    await page.keyboard.press('l');
    await expect(html).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Virtual fitting mirror' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('?lang=ar opens the research page in Arabic', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/research?lang=ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('كواليس المرآة');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.rs-gallery img')).toHaveCount(4);
    await page.getByTestId('language-toggle').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Behind the mirror');
    expect(errors).toEqual([]);
  });
});

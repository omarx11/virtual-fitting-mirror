// 3D garment path in a real browser (WebGL via ANGLE). Pixel checks read the actual rendered
// canvases; they never rely on a canvas element merely existing.
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import {
  collectErrors,
  FIXTURES,
  footage,
  hasFootage,
  openApp,
  openFile,
  snap,
  waitForTracker,
} from './helpers';

const PATTERN = join(FIXTURES, 'synthetic-pattern.webm');
const UPPER = 'derived_upper_landscape.mp4';

async function g3(page: Page) {
  return page.evaluate(() => {
    const s = (
      window as unknown as { __mirror: { snapshot(): Record<string, unknown> } }
    ).__mirror.snapshot();
    const d = s.diagnostics as { garment3d: Record<string, unknown> | null; opacity: number };
    return {
      status: s.garment3d as { state: string; fallback?: string | null },
      d3: d.garment3d,
      opacity: d.opacity,
    };
  });
}

/** Mean absolute RGB difference inside a region of the visible canvas between two captures. */
async function canvasPixels(page: Page, selector: string): Promise<number[]> {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel) as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = 160;
    copy.height = Math.round((160 * c.height) / c.width);
    const ctx = copy.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(c, 0, 0, copy.width, copy.height);
    return Array.from(ctx.getImageData(0, 0, copy.width, copy.height).data);
  }, selector);
}

function diff(a: number[], b: number[], region?: (i: number) => boolean): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (region && !region(i / 4)) continue;
    sum +=
      Math.abs((a[i] ?? 0) - (b[i] ?? 0)) +
      Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)) +
      Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0));
    n++;
  }
  return sum / Math.max(1, n);
}

test.describe('3D garment', () => {
  test('the V-neck GLB loads from its runtime location and is the default garment', async ({ page }) => {
    const errors = collectErrors(page);
    const glb: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/garments/3d/vneck/shirt-male.glb')) glb.push(`${r.status()}`);
    });
    await openApp(page);
    await expect.poll(async () => (await g3(page)).status.state, { timeout: 20_000 }).toBe('ready');
    expect(glb).toContain('200');
    await expect(page.getByRole('button', { name: /V-neck \(3D\)/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('radiogroup', { name: 'Fabric colour' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('inspection view: the actual model renders and deforms under deterministic poses', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto('/?inspect=3d');
    const canvas = page.getByTestId('inspect-canvas');
    await expect(canvas).toHaveAttribute('data-rendered', /\d+/, { timeout: 20_000 });
    await page.getByRole('checkbox', { name: /Skeleton/ }).uncheck();
    const shot = async (name: string) => {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(canvas).toHaveAttribute('data-pose', name);
      return canvasPixels(page, '[data-testid=inspect-canvas]');
    };
    const neutral = await shot('neutral');
    // Garment pixels exist (not just a background).
    const bg = [0x3a, 0x3f, 0x47];
    let garmentPixels = 0;
    for (let i = 0; i < neutral.length; i += 4) {
      if (Math.abs((neutral[i] ?? 0) - (bg[0] ?? 0)) + Math.abs((neutral[i + 2] ?? 0) - (bg[2] ?? 0)) > 30)
        garmentPixels++;
    }
    expect(garmentPixels).toBeGreaterThan(neutral.length / 4 / 10);
    const leftUp = await shot('left arm raised');
    // Unmirrored view: the wearer's LEFT sleeve is on the image RIGHT. The other side only moves by
    // the small shoulder-anchor shift from the clavicle lift.
    const w = 160;
    const rightTop = (p: number) => p % w > w * 0.6 && Math.floor(p / w) < 80;
    const leftTop = (p: number) => p % w < w * 0.4 && Math.floor(p / w) < 80;
    const raisedSide = diff(neutral, leftUp, rightTop);
    expect(raisedSide).toBeGreaterThan(8);
    expect(raisedSide).toBeGreaterThan(3 * diff(neutral, leftUp, leftTop));
    const turned = await shot('turn left 30°');
    expect(diff(neutral, turned)).toBeGreaterThan(2);
    expect(errors).toEqual([]);
  });

  test('switching garments, fabrics and motion modes repeatedly stays clean', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page, { mirror: false });
    await waitForTracker(page);
    await openFile(page, PATTERN);
    await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
    const initMs = (await snap(page)).tracker.info?.initMs;
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: /Breton stripe/ }).click();
      await expect.poll(async () => (await g3(page)).status.state).toBe('inactive');
      await page.getByRole('button', { name: /V-neck \(3D\)/ }).click();
      await expect.poll(async () => (await g3(page)).status.state).toBe('ready');
      await page.getByRole('radio', { name: i % 2 ? 'Navy' : 'Olive' }).click();
      await page.getByRole('button', { name: 'Fabric motion (beta)' }).click();
      await expect
        .poll(async () => ((await g3(page)).d3?.cloth as { state: string } | undefined)?.state, {
          timeout: 20_000,
        })
        .toMatch(/running|frozen|settling/);
      await page.getByRole('button', { name: 'Fabric motion (beta)' }).click();
      await expect
        .poll(async () => ((await g3(page)).d3?.cloth as { state: string } | undefined)?.state)
        .toBe('off');
    }
    expect((await snap(page)).tracker.info?.initMs).toBe(initMs); // no model reloads
    expect((await snap(page)).diagnostics.scheduler?.errors).toBe(0);
    expect(errors).toEqual([]);
  });

  test('WebGL unavailable: explicit failure state, labelled 2D development fallback, video still works', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl' || type === 'webgl2') return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await openApp(page);
    await expect.poll(async () => (await g3(page)).status.state).toBe('error');
    // Dev server ⇒ the configured development fallback; it must say it is NOT 3D.
    expect((await g3(page)).status.fallback).toBe('legacy-2d');
    await expect(page.getByRole('alert').filter({ hasText: /not 3D/ })).toBeVisible();
    await openFile(page, PATTERN);
    await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
  });

  test('WebGL context loss is reported and recovers', async ({ page }) => {
    await openApp(page);
    await expect.poll(async () => (await g3(page)).status.state).toBe('ready');
    await openFile(page, PATTERN);
    await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
    // The extension handle must be taken BEFORE the loss (getExtension returns null afterwards).
    const lose = (restore: boolean) =>
      page.evaluate((restore) => {
        const w = window as unknown as {
          __mirror: { renderer3d: { canvas: HTMLCanvasElement } };
          __lose?: WEBGL_lose_context | null;
        };
        if (!w.__lose)
          w.__lose = w.__mirror.renderer3d.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
        if (restore) w.__lose?.restoreContext();
        else w.__lose?.loseContext();
      }, restore);
    await lose(false);
    await expect.poll(async () => (await g3(page)).d3?.contextLost).toBe(true);
    await lose(true);
    await expect.poll(async () => (await g3(page)).d3?.contextLost).toBe(false);
  });
});

test.describe('3D garment on real footage', () => {
  test('rendered over the actual video, following the person; skeletal and cloth modes', async ({ page }) => {
    test.skip(!hasFootage(UPPER), 'test footage not downloaded');
    const errors = collectErrors(page);
    await openApp(page, { mirror: false, materialId: 'navy' });
    await waitForTracker(page);
    await openFile(page, footage(UPPER));
    await expect.poll(async () => (await g3(page)).d3?.mode, { timeout: 15_000 }).toBe('skeletal');
    await expect.poll(async () => (await g3(page)).opacity, { timeout: 5000 }).toBeGreaterThan(0.9);
    await page.evaluate(() => (window as unknown as { __mirror: { pause(): void } }).__mirror.pause());
    await page.waitForTimeout(300);
    const withShirt = await canvasPixels(page, 'canvas.stage-canvas');
    await page.keyboard.press('g');
    await page.waitForTimeout(400);
    const without = await canvasPixels(page, 'canvas.stage-canvas');
    // The garment visibly changes the torso region of the video (centre of the frame).
    const centre = (p: number) => Math.abs((p % 160) - 80) < 25 && Math.floor(p / 160) > 45;
    expect(diff(withShirt, without, centre)).toBeGreaterThan(20);
    await page.keyboard.press('g');
    // Experimental cloth mode on real motion: runs, stays bounded.
    await page.getByRole('button', { name: 'Fabric motion (beta)' }).click();
    await page.evaluate(() => (window as unknown as { __mirror: { play(): Promise<void> } }).__mirror.play());
    await expect
      .poll(async () => ((await g3(page)).d3?.cloth as { particles: number } | undefined)?.particles ?? 0, {
        timeout: 20_000,
      })
      .toBeGreaterThan(500);
    await page.waitForTimeout(2000);
    const cloth = (await g3(page)).d3?.cloth as { state: string; maxDeviationM: number };
    expect(['running', 'settling', 'frozen']).toContain(cloth.state);
    expect(cloth.maxDeviationM).toBeLessThan(0.1);
    expect(errors).toEqual([]);
  });
});

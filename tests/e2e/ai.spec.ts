// AI photo mode in a real browser against the local backend with the OFFLINE fake provider.
// These tests prove the UI flow, capture, request discipline and cleanup — NOT image quality and
// NOT the paid FASHN integration (see `npm run smoke:ai` for the opt-in real-provider check).
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import sharp from 'sharp';
import { PLANTED_KEY } from '../../playwright.config';
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

interface Req {
  method: string;
  path: string;
  host: string;
  protocol: string;
}

function recordRequests(page: Page): Req[] {
  const list: Req[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    list.push({ method: r.method(), path: u.pathname, host: u.hostname, protocol: u.protocol });
  });
  return list;
}

const count = (reqs: Req[], method: string, path: RegExp) =>
  reqs.filter((r) => r.method === method && path.test(r.path)).length;

const modeRadio = (page: Page, name: '2D' | '3D' | 'AI') =>
  page.getByRole('radiogroup', { name: 'Try-on mode' }).getByRole('radio', { name: new RegExp(`^${name}`) });

async function aiView(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as unknown as { __mirror: { snapshot(): { aiView: string } } }).__mirror.snapshot().aiView,
  );
}

async function aiPhase(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (window as unknown as { __ai?: { getState(): { phase: string } } }).__ai?.getState().phase ?? 'none',
  );
}

async function openAiWithVideo(page: Page, prefs: Record<string, unknown> = {}) {
  await openApp(page, { tryOnMode: 'ai', ...prefs });
  await openFile(page, PATTERN);
  await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
  await expect(page.getByRole('button', { name: 'Capture photo' })).toBeEnabled();
}

test.describe('try-on mode selector', () => {
  test('offers 2D / 3D / AI, keeps 3D as default and restores each mode’s garment', async ({ page }) => {
    const errors = collectErrors(page);
    const reqs = recordRequests(page);
    await openApp(page);
    await expect(modeRadio(page, '3D')).toHaveAttribute('aria-checked', 'true');
    await expect(modeRadio(page, '2D')).toBeVisible();
    await expect(modeRadio(page, 'AI')).toBeVisible();
    await expect(page.getByRole('button', { name: /V-neck \(3D\)/ })).toHaveAttribute('aria-pressed', 'true');

    await modeRadio(page, '2D').click();
    await expect(page.getByRole('button', { name: /Shirt \(2D\)/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('radio', { name: 'Breton stripe' }).click();

    // Live modes never talk to the AI backend.
    expect(count(reqs, 'GET', /^\/api\//) + count(reqs, 'POST', /^\/api\//)).toBe(0);

    await modeRadio(page, 'AI').click();
    await expect(page.getByRole('heading', { name: 'AI photo preview' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Shirts' })).toHaveCount(0);
    await expect.poll(() => aiView(page)).toBe('live');
    // Entering AI mode only reads capabilities (and the credit count): nothing is posted.
    await expect.poll(() => count(reqs, 'GET', /^\/api\/ai\/capabilities$/)).toBe(1);
    expect(count(reqs, 'POST', /^\/api\//)).toBe(0);

    await modeRadio(page, '3D').click();
    await expect(page.getByRole('button', { name: /V-neck \(3D\)/ })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => aiView(page)).toBe('off');
    await modeRadio(page, '2D').click();
    await expect(page.getByRole('radio', { name: 'Breton stripe' })).toHaveAttribute('aria-checked', 'true');

    // Persisted (harmless settings only). openApp's init script rewrites storage on reload, so
    // read what the app saved.
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('virtual-fitting-mirror.preferences.v1') ?? '{}'),
    );
    expect(saved).toMatchObject({
      tryOnMode: '2d',
      garmentId: 'breton-stripe-tee',
      lastGarment3d: 'vneck-3d',
    });
    expect(JSON.stringify(saved)).not.toMatch(/blob:|data:|consent/);
    expect(errors).toEqual([]);
  });
});

test.describe('clean capture', () => {
  test('captures the raw decoded frame: native size, unmirrored, no overlays', async ({ page }) => {
    await openApp(page, { mirror: true, showLandmarks: true });
    await waitForTracker(page);
    await openFile(page, PATTERN);
    await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
    await page.evaluate(() => {
      const m = (window as unknown as { __mirror: { pause(): void; seek(t: number): void } }).__mirror;
      m.pause();
      m.seek(1.2);
    });
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      type Mirror = {
        captureSourceFrame(): Promise<{ blob: Blob; width: number; height: number; source: string } | null>;
        updateSettings(p: Record<string, unknown>): void;
      };
      const m = (window as unknown as { __mirror: Mirror }).__mirror;
      const pixels = async (src: CanvasImageSource, w: number, h: number) => {
        const c = document.createElement('canvas');
        // 16×12 blocks: averages out JPEG chroma subsampling at the pattern's sharp edges.
        c.width = 16;
        c.height = 12;
        const ctx = c.getContext('2d') as CanvasRenderingContext2D;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, w, h, 0, 0, 16, 12);
        return Array.from(ctx.getImageData(0, 0, 16, 12).data);
      };
      const video = document.querySelector('video') as HTMLVideoElement;
      const a = await m.captureSourceFrame();
      if (!a) return null;
      const bitmapA = await createImageBitmap(a.blob);
      const raw = await pixels(video, video.videoWidth, video.videoHeight);
      const capA = await pixels(bitmapA, bitmapA.width, bitmapA.height);
      m.updateSettings({ mirror: false });
      const b = await m.captureSourceFrame();
      const bitmapB = b ? await createImageBitmap(b.blob) : null;
      const capB = bitmapB ? await pixels(bitmapB, bitmapB.width, bitmapB.height) : [];
      const stage = document.querySelector('.stage-canvas') as HTMLCanvasElement;
      const diff = (x: number[], y: number[]) => {
        let s = 0;
        for (let i = 0; i < x.length; i += 4)
          s += Math.abs((x[i] ?? 0) - (y[i] ?? 0)) + Math.abs((x[i + 1] ?? 0) - (y[i + 1] ?? 0));
        return s / (x.length / 4);
      };
      return {
        size: [a.width, a.height, bitmapA.width, bitmapA.height],
        stageSize: [stage.width, stage.height],
        source: a.source,
        rawVsCapture: diff(raw, capA),
        mirroredVsUnmirrored: diff(capA, capB),
        type: a.blob.type,
      };
    });
    expect(result).not.toBeNull();
    expect(result?.size).toEqual([320, 240, 320, 240]);
    expect(result?.stageSize).not.toEqual([320, 240]);
    expect(result?.source).toBe('file');
    expect(result?.type).toBe('image/jpeg');
    // Same pixels as the video element itself (JPEG noise only), independent of the mirror setting.
    expect(result?.rawVsCapture).toBeLessThan(6);
    expect(result?.mirroredVsUnmirrored).toBeLessThan(2);
  });

  test('on real footage the capture contains the person, not the rendered 3D shirt', async ({ page }) => {
    test.skip(!hasFootage('derived_upper_landscape.mp4'), 'test footage not downloaded');
    await openApp(page, { mirror: false });
    await waitForTracker(page);
    await openFile(page, footage('derived_upper_landscape.mp4'));
    await expect
      .poll(async () => (await snap(page)).diagnostics.opacity, { timeout: 20_000 })
      .toBeGreaterThan(0.8);
    const diffs = await page.evaluate(async () => {
      type Mirror = {
        pause(): void;
        captureSourceFrame(): Promise<{ blob: Blob } | null>;
      };
      const m = (window as unknown as { __mirror: Mirror }).__mirror;
      m.pause();
      await new Promise((r) => setTimeout(r, 300));
      const video = document.querySelector('video') as HTMLVideoElement;
      const stage = document.querySelector('.stage-canvas') as HTMLCanvasElement;
      const cap = await m.captureSourceFrame();
      if (!cap) return null;
      const bmp = await createImageBitmap(cap.blob);
      const grab = (src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number) => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 36;
        const ctx = c.getContext('2d') as CanvasRenderingContext2D;
        ctx.drawImage(src, sx, sy, sw, sh, 0, 0, 64, 36);
        return Array.from(ctx.getImageData(0, 0, 64, 36).data);
      };
      // The stage canvas shows the video letterboxed; map its video area for comparison.
      const view = (
        window as unknown as {
          __mirror: { viewTransform: { clip: { x: number; y: number; width: number; height: number } } };
        }
      ).__mirror.viewTransform.clip;
      const raw = grab(video, 0, 0, video.videoWidth, video.videoHeight);
      const captured = grab(bmp, 0, 0, bmp.width, bmp.height);
      const composited = grab(stage, view.x, view.y, view.width, view.height);
      const d = (a: number[], b: number[]) => {
        let s = 0;
        for (let i = 0; i < a.length; i += 4) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
        return s / (a.length / 4);
      };
      return { captureVsRaw: d(captured, raw), stageVsRaw: d(composited, raw) };
    });
    expect(diffs).not.toBeNull();
    expect(diffs?.captureVsRaw).toBeLessThan(6);
    // The stage shows the shirt; the capture does not.
    expect(diffs?.stageVsRaw).toBeGreaterThan((diffs?.captureVsRaw ?? 0) + 4);
  });
});

test.describe('AI photo flow (offline fake provider)', () => {
  test('capture → consent → generate → compare → try another → end session @preview', async ({ page }) => {
    const errors = collectErrors(page);
    const reqs = recordRequests(page);
    await openAiWithVideo(page);

    await page.getByRole('button', { name: 'Capture photo' }).click();
    await expect(page.getByTestId('ai-capture')).toBeVisible();
    await expect.poll(async () => (await snap(page)).playback.paused).toBe(true);
    await expect.poll(() => aiView(page)).toBe('still');

    await page
      .getByRole('radiogroup', { name: 'AI garment' })
      .getByRole('radio', { name: /Saudi thobe/ })
      .click();
    await page.getByRole('button', { name: 'Generate preview' }).click();
    const dialog = page.getByRole('dialog', { name: /Send your photo/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('FASHN');
    await expect(dialog).toContainText('Test mode');
    await dialog.getByRole('button', { name: 'Not now' }).click();
    await expect(dialog).toHaveCount(0);
    // Capture, garment choice and a declined opt-in sent nothing.
    expect(count(reqs, 'POST', /^\/api\/ai\/(session|jobs)$/)).toBe(0);

    await page.getByRole('button', { name: 'Generate preview' }).click();
    await dialog.getByRole('button', { name: 'Agree & generate' }).click();
    await expect(page.getByTestId('ai-progress')).toBeVisible();
    await expect(page.getByTestId('ai-progress')).toContainText(/Uploading|queue|Generating/);
    await expect(page.getByTestId('ai-result')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('ai-label')).toContainText('AI-generated preview');
    await expect(page.getByTestId('ai-label')).toContainText('Saudi thobe');
    await expect(page.getByTestId('ai-label')).toContainText('TEST RESULT');
    await expect(page.getByTestId('ai-result')).toHaveClass(/mirrored/);
    expect(count(reqs, 'POST', /^\/api\/ai\/jobs$/)).toBe(1);

    // Download saves the generated JPEG itself (from its blob: URL; nothing is fetched again).
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('ai-download').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^fitting-mirror-saudi-thobe-\d{4}-\d{2}-\d{2}-\d{4}\.jpg$/);
    expect((await sharp(await download.path()).metadata()).format).toBe('jpeg');
    expect(count(reqs, 'GET', /\/result$/)).toBe(1);

    await page.getByRole('radio', { name: 'Before' }).click();
    await expect(page.getByTestId('ai-before')).toBeVisible();
    await expect(page.getByTestId('ai-result')).toHaveCount(0);
    await page.getByRole('radio', { name: /Side by side/ }).click();
    await expect(page.getByTestId('ai-before')).toBeVisible();
    await expect(page.getByTestId('ai-result')).toBeVisible();
    const captureSrc = await page.getByTestId('ai-before').getAttribute('src');

    // Try another garment on the SAME photo; consent is kept for this session; double click = one job.
    await page.getByRole('button', { name: 'Try another garment' }).click();
    await expect(page.getByTestId('ai-capture')).toHaveAttribute('src', captureSrc ?? '');
    await page
      .getByRole('radiogroup', { name: 'AI garment' })
      .getByRole('radio', { name: /Green dress/ })
      .click();
    await page.getByRole('button', { name: 'Generate preview' }).dblclick();
    await expect(page.getByTestId('ai-result')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('ai-label')).toContainText('Green dress');
    expect(count(reqs, 'POST', /^\/api\/ai\/jobs$/)).toBe(2);
    expect(count(reqs, 'POST', /^\/api\/ai\/session$/)).toBe(1);

    // End session: images and opt-in are gone; the video resumes; the next customer is asked again.
    await page.getByRole('button', { name: 'End session' }).first().click();
    await expect(page.getByRole('button', { name: 'Capture photo' })).toBeVisible();
    await expect(page.getByTestId('ai-stage')).toHaveCount(0);
    await expect.poll(() => count(reqs, 'DELETE', /^\/api\/ai\/session$/)).toBe(1);
    await expect.poll(async () => (await snap(page)).playback.paused).toBe(false);
    await page.getByRole('button', { name: 'Capture photo' }).click();
    await page.getByRole('button', { name: 'Generate preview' }).click();
    await expect(page.getByRole('dialog', { name: /Send your photo/ })).toBeVisible();

    // Only this origin (object URLs of the stills are blob: and never leave the page).
    expect(
      reqs.filter(
        (r) => !['blob:', 'data:'].includes(r.protocol) && !['localhost', '127.0.0.1'].includes(r.host),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('switching to 3D mid-generation abandons the job; its late result never appears', async ({ page }) => {
    const errors = collectErrors(page);
    const reqs = recordRequests(page);
    await openAiWithVideo(page);
    await page.getByRole('button', { name: 'Capture photo' }).click();
    await page.getByRole('button', { name: 'Generate preview' }).click();
    await page.getByRole('button', { name: 'Agree & generate' }).click();
    await expect(page.getByTestId('ai-progress')).toBeVisible();
    await expect.poll(() => count(reqs, 'POST', /^\/api\/ai\/jobs$/)).toBe(1);
    await modeRadio(page, '3D').click();
    // Ending the AI session purges (abandons) its jobs server-side.
    await expect.poll(() => count(reqs, 'DELETE', /^\/api\/ai\/session$/)).toBe(1);
    await expect(page.getByRole('button', { name: /V-neck \(3D\)/ })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => aiView(page)).toBe('off');
    await expect.poll(async () => (await snap(page)).playback.paused).toBe(false);
    // Wait past the fake provider's completion, then return to AI: nothing stale is shown.
    await page.waitForTimeout(3000);
    await modeRadio(page, 'AI').click();
    await expect.poll(() => aiPhase(page)).toBe('ready');
    await expect(page.getByTestId('ai-result')).toHaveCount(0);
    await expect(page.getByTestId('ai-stage')).toHaveCount(0);
    expect(count(reqs, 'GET', /\/result$/)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a developer photo can replace the camera', async ({ page }) => {
    await openApp(page, { tryOnMode: 'ai' });
    await expect.poll(() => aiPhase(page)).toBe('ready');
    const jpeg = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#7a8899' } })
      .jpeg()
      .toBuffer();
    await page.getByText('Developer test inputs').click();
    await page.setInputFiles('[data-testid=ai-photo-input]', {
      name: 'me.jpg',
      mimeType: 'image/jpeg',
      buffer: jpeg,
    });
    await expect(page.getByTestId('ai-capture')).toBeVisible();
    const size = await page
      .getByTestId('ai-capture')
      .evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
    expect(size).toEqual([300, 400]);
  });
});

test.describe('AI availability', () => {
  test('backend down or unconfigured: explains setup; live modes keep working', async ({ page }) => {
    const errors = collectErrors(page);
    await page.route('**/api/ai/capabilities', (r) =>
      r.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad gateway' }),
    );
    await openApp(page, { tryOnMode: 'ai' });
    await expect(page.getByTestId('ai-unavailable')).toContainText('not running');
    await page.unroute('**/api/ai/capabilities');
    await page.route('**/api/ai/capabilities', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: false,
          reason: 'No FASHN API key is configured on the server (FASHN_API_KEY).',
          provider: null,
          testProvider: false,
          presets: [],
          defaultPreset: null,
          consentVersion: 'x',
          devUploads: false,
          access: { required: false, granted: true },
          keys: { server: false, user: false },
          limits: { maxUploadBytes: 1, maxInputPixels: 1 },
          localResultTtlSeconds: 120,
          jobDeadlineSeconds: 120,
          providerRetentionUrl: 'https://docs.fashn.ai/api-overview/data-retention-privacy',
        }),
      }),
    );
    await modeRadio(page, '3D').click();
    await modeRadio(page, 'AI').click();
    await expect(page.getByTestId('ai-unavailable')).toContainText('No FASHN API key');
    await openFile(page, PATTERN);
    await expect(page.getByTestId('ai-live-bar')).toContainText('unavailable');
    await modeRadio(page, '3D').click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as { __mirror: { snapshot(): { garment3d: { state: string } } } }
            ).__mirror.snapshot().garment3d.state,
        ),
      )
      .toBe('ready');
    expect(errors.filter((e) => !/502|Bad gateway/.test(e))).toEqual([]);
  });

  test('the API key never reaches the browser; results are private and uncached @preview', async ({
    page,
  }) => {
    const bodies: string[] = [];
    let resultHeaders: Record<string, string> | null = null;
    page.on('response', async (r) => {
      const type = r.headers()['content-type'] ?? '';
      if (/\/api\/ai\/jobs\/[^/]+\/result$/.test(new URL(r.url()).pathname)) resultHeaders = r.headers();
      if (/javascript|json|html|css|text/.test(type)) bodies.push(await r.text().catch(() => ''));
    });
    await openAiWithVideo(page);
    await page.getByRole('button', { name: 'Capture photo' }).click();
    await page.getByRole('button', { name: 'Generate preview' }).click();
    await page.getByRole('button', { name: 'Agree & generate' }).click();
    await expect(page.getByTestId('ai-result')).toBeVisible({ timeout: 20_000 });
    expect(resultHeaders).not.toBeNull();
    expect(resultHeaders?.['cache-control']).toBe('no-store');
    expect(resultHeaders?.['content-type']).toBe('image/jpeg');
    expect(bodies.length).toBeGreaterThan(3);
    for (const b of bodies) expect(b).not.toContain(PLANTED_KEY);
    const unknown = await page.request.get('/api/definitely-not-a-route', {
      headers: { accept: 'text/html' },
    });
    expect(unknown.status()).toBe(404);
    expect(unknown.headers()['content-type']).toMatch(/application\/json/);
  });

  test("a visitor's own API key is checked, saved in the browser and sent with their jobs", async ({
    page,
  }) => {
    const KEY = 'fa-visitor-key-123';
    // As if the server had no key of its own (the test server accepts visitor keys).
    await page.route('**/api/ai/capabilities', async (r) => {
      const res = await r.fetch();
      await r.fulfill({
        response: res,
        json: { ...(await res.json()), keys: { server: false, user: true } },
      });
    });
    const sent: (string | undefined)[] = [];
    page.on('request', (r) => {
      if (/^\/api\/ai\/(session|jobs(\/[^/]+)?)$/.test(new URL(r.url()).pathname) && r.method() !== 'DELETE')
        sent.push(r.headers()['x-fashn-key']);
    });
    await openAiWithVideo(page);
    await page.getByRole('button', { name: 'Capture photo' }).click();
    await expect(page.getByRole('button', { name: 'Generate preview' })).toBeDisabled();
    await expect(page.getByText('Add your FASHN API key in the panel first')).toBeVisible();

    const form = page.getByTestId('ai-key');
    await form.getByLabel('Your FASHN API key').fill(KEY);
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('ai-key-saved')).toContainText('Using your API key');
    expect(await page.evaluate(() => localStorage.getItem('virtual-fitting-mirror.fashn-key.v1'))).toBe(KEY);

    await page.getByRole('button', { name: 'Generate preview' }).click();
    await page.getByRole('button', { name: 'Agree & generate' }).click();
    await expect(page.getByTestId('ai-result')).toBeVisible({ timeout: 20_000 });
    expect(sent.length).toBeGreaterThan(2);
    expect(sent.every((h) => h === KEY)).toBe(true);
  });
});

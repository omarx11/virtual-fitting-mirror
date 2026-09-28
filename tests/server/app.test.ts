import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeProvider } from '../../server/ai/providers/fake';
import { ProviderBalanceError } from '../../server/ai/providers/types';
import { type BuiltApp, buildApp } from '../../server/app';
import type { ServerConfig } from '../../server/config';
import { AI_USER_KEY_HEADER } from '../../src/ai/types';
import {
  browserHeaders,
  HOST,
  jobParts,
  makeImage,
  multipart,
  ORIGIN,
  type Part,
  testConfig,
  waitFor,
} from './helpers';

const apps: BuiltApp[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.app.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function start(config: ServerConfig = testConfig(), provider?: FakeProvider) {
  const fake = provider ?? new FakeProvider({ scenario: 'success', stepMs: 10 });
  const built = await buildApp(config, { provider: fake, sweepIntervalMs: 20 });
  apps.push(built);
  return { ...built, fake };
}

async function newSession(app: BuiltApp['app']): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/ai/session', headers: browserHeaders() });
  expect(res.statusCode).toBe(200);
  const cookie = String(res.headers['set-cookie']);
  return cookie.split(';')[0] ?? '';
}

async function postJob(app: BuiltApp['app'], cookie: string, parts: Part[]) {
  const body = multipart(parts);
  return app.inject({
    method: 'POST',
    url: '/api/ai/jobs',
    headers: { ...browserHeaders(cookie), 'content-type': body.contentType },
    payload: body.payload,
  });
}

let personJpeg: Buffer;
const person = async () => {
  personJpeg ??= await makeImage(480, 640);
  return personJpeg;
};

describe('capabilities and configuration', () => {
  it('reports unconfigured AI without disclosing the key or calling the provider', async () => {
    const config = testConfig({
      AI_PROVIDER: 'fashn',
      FASHN_API_KEY: '',
      AI_ENABLED: 'true',
      AI_USER_KEYS: 'false',
    });
    const { app, fake } = await start(config);
    const res = await app.inject({ url: '/api/ai/capabilities', headers: browserHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enabled: false, provider: null, presets: [] });
    expect(res.json().reason).toMatch(/FASHN_API_KEY/);
    expect(res.headers['cache-control']).toBe('no-store');
    // Jobs are refused before any upload processing.
    const cookie = await newSession(app);
    const job = await postJob(app, cookie, jobParts(await person()));
    expect(job.statusCode).toBe(503);
    expect(job.json().error.code).toBe('not-configured');
    expect(fake.submitCount).toBe(0);
  });

  it('never includes a configured key in any response', async () => {
    const config = testConfig({
      AI_PROVIDER: 'fashn',
      FASHN_API_KEY: 'fa-SECRET-should-not-leak',
      AI_ENABLED: 'true',
    });
    const { app } = await start(config);
    const res = await app.inject({ url: '/api/ai/capabilities', headers: browserHeaders() });
    expect(res.body).not.toContain('SECRET');
    expect(res.json().enabled).toBe(true);
  });
});

describe("a visitor's own API key", () => {
  const GOOD = 'fa-visitor-key-123';
  /** No operator key; a visitor key pays through `fake`, and only GOOD passes the balance check. */
  async function startWithoutServerKey(env: Record<string, string> = {}) {
    const fake = new FakeProvider({ scenario: 'success', stepMs: 10 });
    const refused = new FakeProvider({ scenario: 'success', stepMs: 10 });
    Object.assign(fake, { balance: async () => ({ total: 7, subscription: 5, onDemand: 2 }) });
    Object.assign(refused, {
      balance: async () => {
        throw new ProviderBalanceError(401, 'FASHN balance request failed (HTTP 401).');
      },
    });
    const config = testConfig({ AI_PROVIDER: 'fashn', FASHN_API_KEY: '', ...env });
    const built = await buildApp(config, {
      provider: fake,
      userProvider: (key) => (key === GOOD ? fake : refused),
      sweepIntervalMs: 20,
    });
    apps.push(built);
    return { ...built, fake };
  }
  const withKey = (cookie?: string, key = GOOD) => ({ ...browserHeaders(cookie), [AI_USER_KEY_HEADER]: key });

  it('pays for jobs when the server has no key, and never counts against the daily cap', async () => {
    const { app, fake, services } = await startWithoutServerKey();
    const caps = (await app.inject({ url: '/api/ai/capabilities', headers: browserHeaders() })).json();
    expect(caps).toMatchObject({ enabled: true, keys: { server: false, user: true } });

    // Without a key nothing is sent to the provider.
    const cookie = await newSession(app);
    const refused = await postJob(app, cookie, jobParts(await person()));
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('key-required');
    expect(fake.submitCount).toBe(0);

    const body = multipart(jobParts(await person()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/jobs',
      headers: { ...withKey(cookie), 'content-type': body.contentType },
      payload: body.payload,
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    await waitFor(
      async () => (await app.inject({ url: `/api/ai/jobs/${id}`, headers: withKey(cookie) })).json().status,
      (s) => s === 'completed',
    );
    expect(fake.submitCount).toBe(1);
    expect((await services.ledger.today()).used).toBe(0);
    // Only a hash of the key is kept with the job.
    expect(JSON.stringify(res.json())).not.toContain(GOOD);
  });

  it('checks a key with the provider before the page saves it', async () => {
    const { app } = await startWithoutServerKey();
    const ok = await app.inject({ url: '/api/ai/key', headers: withKey() });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ credits: 7 });
    const wrong = await app.inject({ url: '/api/ai/key', headers: withKey(undefined, 'fa-wrong-key-999') });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe('provider-auth');
    const malformed = await app.inject({
      url: '/api/ai/key',
      headers: withKey(undefined, 'has space in it'),
    });
    expect(malformed.statusCode).toBe(400);
  });

  it('replaces the access code, and is refused where visitor keys are switched off', async () => {
    const { app } = await startWithoutServerKey({ AI_ACCESS_CODE: 'staff-code-1' });
    const denied = await app.inject({ method: 'POST', url: '/api/ai/session', headers: browserHeaders() });
    expect(denied.json().error.code).toBe('access-required');
    const allowed = await app.inject({ method: 'POST', url: '/api/ai/session', headers: withKey() });
    expect(allowed.statusCode).toBe(200);

    const { app: kiosk } = await start(testConfig({ AI_USER_KEYS: 'false' }));
    const caps = (await kiosk.inject({ url: '/api/ai/capabilities', headers: browserHeaders() })).json();
    expect(caps.keys).toEqual({ server: true, user: false });
    const res = await kiosk.inject({ method: 'POST', url: '/api/ai/session', headers: withKey() });
    expect(res.statusCode).toBe(400);
  });
});

describe('request protection', () => {
  it('rejects missing marker header, foreign origins, cross-site fetches and unknown hosts', async () => {
    const { app } = await start();
    const ok = await app.inject({ url: '/api/ai/capabilities', headers: browserHeaders() });
    expect(ok.statusCode).toBe(200);
    const cases: Record<string, string>[] = [
      { ...browserHeaders(), 'x-vfm-ai': '' },
      { ...browserHeaders(), origin: 'https://evil.example' },
      { ...browserHeaders(), 'sec-fetch-site': 'cross-site' },
      { ...browserHeaders(), host: 'evil.example:3001' }, // DNS rebinding
    ];
    for (const headers of cases) {
      const res = await app.inject({ url: '/api/ai/capabilities', headers });
      expect(res.statusCode).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('requires an allowed Origin on state-changing requests (CSRF)', async () => {
    const { app } = await start();
    const { origin: _o, ...noOrigin } = browserHeaders();
    const res = await app.inject({ method: 'POST', url: '/api/ai/session', headers: noOrigin });
    expect(res.statusCode).toBe(403);
    const evil = await app.inject({
      method: 'POST',
      url: '/api/ai/session',
      headers: { ...browserHeaders(), origin: 'http://localhost:9999' },
    });
    expect(evil.statusCode).toBe(403);
  });

  it('issues an HttpOnly, SameSite=Strict, path-scoped session cookie', async () => {
    const { app } = await start();
    const res = await app.inject({ method: 'POST', url: '/api/ai/session', headers: browserHeaders() });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^vfm_ai_sid=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/ai');
  });

  it('unknown API routes are JSON 404s', async () => {
    const { app } = await start();
    for (const url of ['/api', '/api/nope', '/api/ai/nope']) {
      const res = await app.inject({ url, headers: browserHeaders() });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.json().error.code).toBe('not-found');
    }
  });
});

describe('jobs over HTTP', () => {
  it('runs a job end to end and serves the private result uncached', async () => {
    const { app, fake } = await start();
    const cookie = await newSession(app);
    const res = await postJob(app, cookie, jobParts(await person()));
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    await waitFor(
      async () =>
        (await app.inject({ url: `/api/ai/jobs/${id}`, headers: browserHeaders(cookie) })).json().status,
      (s) => s === 'completed',
    );
    const result = await app.inject({ url: `/api/ai/jobs/${id}/result`, headers: browserHeaders(cookie) });
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toBe('image/jpeg');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-ai-test-result']).toBe('fake-provider');
    expect((await sharp(result.rawPayload).metadata()).format).toBe('jpeg');
    expect(fake.submitCount).toBe(1);
    // The uploaded photo reached the provider as a data URI, with EXIF-free re-encoded JPEG.
    expect(String(fake.requests[0]?.inputs.model_image)).toMatch(/^<data-uri \d+ chars>$/);
  });

  it('concurrent duplicate submissions (double click) create exactly one provider job', async () => {
    const { app, fake } = await start();
    const cookie = await newSession(app);
    const id = randomUUID();
    const img = await person();
    const [a, b, c] = await Promise.all([
      postJob(app, cookie, jobParts(img, { clientRequestId: id })),
      postJob(app, cookie, jobParts(img, { clientRequestId: id })),
      postJob(app, cookie, jobParts(img, { clientRequestId: id })),
    ]);
    expect([a?.statusCode, b?.statusCode, c?.statusCode]).toEqual([202, 202, 202]);
    expect(new Set([a?.json().id, b?.json().id, c?.json().id]).size).toBe(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.submitCount).toBe(1);
  });

  it('validates consent, request ID, garment choice, preset and images before submitting', async () => {
    const { app, fake } = await start(testConfig({ AI_DEV_UPLOADS: 'false' }));
    const cookie = await newSession(app);
    const img = await person();
    const expectError = async (parts: Part[], status: number, code: string) => {
      const res = await postJob(app, cookie, parts);
      expect(res.statusCode, JSON.stringify(res.json())).toBe(status);
      expect(res.json().error.code).toBe(code);
    };
    await expectError(jobParts(img, { consentVersion: 'old' }), 400, 'consent-required');
    await expectError(jobParts(img, { clientRequestId: 'not-a-uuid' }), 400, 'bad-request');
    await expectError(jobParts(img, { garmentId: 'no-such' }), 400, 'unknown-garment');
    await expectError(jobParts(img, { garmentId: '../../package.json' }), 400, 'unknown-garment');
    await expectError(jobParts(img, { preset: 'v16-performance' }), 400, 'bad-request'); // not enabled
    await expectError(jobParts(img, { garmentId: null }), 400, 'bad-request');
    await expectError(
      jobParts(img, { garmentId: null }, [{ name: 'garment', value: img, filename: 'g.jpg' }]),
      403,
      'uploads-disabled',
    );
    await expectError(
      jobParts(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
      400,
      'invalid-image',
    );
    await expectError(
      jobParts(img, {}, [{ name: 'extra', value: img, filename: 'x.jpg' }]),
      400,
      'bad-request',
    );
    expect(fake.submitCount).toBe(0);
  });

  it('enforces the upload byte limit while streaming', async () => {
    const { app, fake } = await start(testConfig({ AI_MAX_UPLOAD_BYTES: String(64 * 1024) }));
    const cookie = await newSession(app);
    const big = await sharp({
      create: {
        width: 1500,
        height: 1500,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    expect(big.length).toBeGreaterThan(64 * 1024);
    const res = await postJob(app, cookie, jobParts(big));
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('image-too-large');
    expect(fake.submitCount).toBe(0);
  });

  it('accepts a developer garment upload when allowed', async () => {
    const { app, fake } = await start(testConfig({ AI_DEV_UPLOADS: 'true' }));
    const cookie = await newSession(app);
    const res = await postJob(
      app,
      cookie,
      jobParts(await person(), { garmentId: null }, [
        {
          name: 'garment',
          value: await makeImage(300, 300, 'png'),
          filename: 'g.png',
          contentType: 'image/png',
        },
        { name: 'garmentCategory', value: 'tops' },
      ]),
    );
    expect(res.statusCode).toBe(202);
    await waitFor(
      () => fake.submitCount,
      (n) => n === 1,
    );
  });

  it('isolates sessions: another session cannot read, download or delete a job', async () => {
    const { app } = await start();
    const alice = await newSession(app);
    const bob = await newSession(app);
    const id = (await postJob(app, alice, jobParts(await person()))).json().id as string;
    await waitFor(
      async () =>
        (await app.inject({ url: `/api/ai/jobs/${id}`, headers: browserHeaders(alice) })).json().status,
      (s) => s === 'completed',
    );
    for (const [method, url] of [
      ['GET', `/api/ai/jobs/${id}`],
      ['GET', `/api/ai/jobs/${id}/result`],
      ['DELETE', `/api/ai/jobs/${id}`],
    ] as const) {
      const res = await app.inject({ method, url, headers: browserHeaders(bob) });
      expect(res.statusCode).toBe(404);
    }
    const noSession = await app.inject({ url: `/api/ai/jobs/${id}`, headers: browserHeaders() });
    expect(noSession.statusCode).toBe(401);
    const stillThere = await app.inject({ url: `/api/ai/jobs/${id}/result`, headers: browserHeaders(alice) });
    expect(stillThere.statusCode).toBe(200);
  });

  it('ending a session purges its results; a new session starts empty', async () => {
    const { app } = await start();
    const cookie = await newSession(app);
    const id = (await postJob(app, cookie, jobParts(await person()))).json().id as string;
    await waitFor(
      async () =>
        (await app.inject({ url: `/api/ai/jobs/${id}`, headers: browserHeaders(cookie) })).json().status,
      (s) => s === 'completed',
    );
    const end = await app.inject({
      method: 'DELETE',
      url: '/api/ai/session',
      headers: browserHeaders(cookie),
    });
    expect(end.statusCode).toBe(204);
    expect(String(end.headers['set-cookie'])).toContain('Max-Age=0');
    const after = await app.inject({ url: `/api/ai/jobs/${id}/result`, headers: browserHeaders(cookie) });
    expect(after.statusCode).toBe(401);
  });

  it('expires idle sessions server-side even if the browser disappears, images included', async () => {
    let now = 10_000_000;
    const config = testConfig({ AI_SESSION_IDLE_SECONDS: '30' });
    const fake = new FakeProvider({ scenario: 'success', stepMs: 10 });
    const built = await buildApp(config, { provider: fake, now: () => now, sweepIntervalMs: 10 });
    apps.push(built);
    const cookie = await newSession(built.app);
    const id = (await postJob(built.app, cookie, jobParts(await person()))).json().id as string;
    await waitFor(
      () => built.services.jobs.inFlightCount(),
      (n) => n === 0,
    );
    expect(await built.services.jobs.hasStoredResult(id)).toBe(true);
    now += 31_000;
    // The result never outlives the idle timeout (its time to live is capped by it).
    expect(await built.services.jobs.hasStoredResult(id)).toBe(false);
    const res = await built.app.inject({ url: `/api/ai/jobs/${id}`, headers: browserHeaders(cookie) });
    expect(res.statusCode).toBe(401);
  });

  it('abandoning a job hides its result', async () => {
    const { app } = await start(testConfig(), new FakeProvider({ scenario: 'success', stepMs: 40 }));
    const cookie = await newSession(app);
    const id = (await postJob(app, cookie, jobParts(await person()))).json().id as string;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/ai/jobs/${id}`,
      headers: browserHeaders(cookie),
    });
    expect(del.statusCode).toBe(204);
    await new Promise((r) => setTimeout(r, 200));
    const view = await app.inject({ url: `/api/ai/jobs/${id}`, headers: browserHeaders(cookie) });
    expect(view.json()).toMatchObject({ status: 'abandoned', resultAvailable: false });
    const result = await app.inject({ url: `/api/ai/jobs/${id}/result`, headers: browserHeaders(cookie) });
    expect(result.statusCode).toBe(404);
  });
});

describe('production same-origin serving', () => {
  it('serves the built frontend and the API from one origin, never HTML for /api', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vfm-dist-'));
    dirs.push(root);
    const dist = join(root, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>app</title>');
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
    const config: ServerConfig = { ...testConfig({}, true), staticRoot: dist };
    const { app } = await start(config);
    const index = await app.inject({ url: '/', headers: { host: HOST, accept: 'text/html' } });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('<title>app</title>');
    expect(index.headers['content-security-policy']).toBe("connect-src 'self' ws: wss: blob: data:");
    const spa = await app.inject({ url: '/some/route', headers: { host: HOST, accept: 'text/html' } });
    expect(spa.body).toContain('<title>app</title>');
    const asset = await app.inject({ url: '/assets/app.js', headers: { host: HOST } });
    expect(asset.statusCode).toBe(200);
    const api = await app.inject({
      url: '/api/ai/unknown',
      headers: { host: HOST, accept: 'text/html', origin: ORIGIN },
    });
    expect(api.statusCode).toBe(404);
    expect(api.headers['content-type']).toMatch(/application\/json/);
  });
});

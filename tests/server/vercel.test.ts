// The Vercel Function path: web Request → server/vercel.ts handler → the Fastify app, with the
// Vercel configuration (Redis store, access code, same-origin hosts, Secure cookies). The Redis
// database is replaced by the in-memory store with the same interface; server instances share it.
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryKv } from '../../server/ai/kv';
import { FakeProvider } from '../../server/ai/providers/fake';
import { type BuiltApp, buildApp } from '../../server/app';
import { ConfigError, loadConfig } from '../../server/config';
import { createHandler, PATH_PARAM } from '../../server/vercel';
import { AI_CLIENT_HEADER } from '../../src/ai/types';
import { jobParts, makeImage, multipart, ROOT, waitFor } from './helpers';

const SITE = 'https://fitting-mirror.vercel.app';
const CODE = 'demo-code-2026';

const VERCEL_ENV = {
  AI_ENABLED: 'true',
  AI_PROVIDER: 'fake',
  AI_ALLOW_FAKE_PROVIDER: 'true',
  AI_POLL_INTERVAL_MS: '5',
  AI_FAKE_STEP_MS: '10',
  AI_LOG_LEVEL: 'silent',
  KV_REST_API_URL: 'https://example.upstash.io',
  KV_REST_API_TOKEN: 'test-token',
  AI_ACCESS_CODE: CODE,
};

const vercelConfig = (env: Record<string, string> = {}) =>
  loadConfig({ ...VERCEL_ENV, ...env }, { production: true, root: ROOT, platform: 'vercel' });

const apps: BuiltApp[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.app.close();
});

/** Two "instances" (separate apps) sharing one store, like Vercel instances sharing Redis. */
async function deployment() {
  const kv = new MemoryKv();
  const fake = new FakeProvider({ scenario: 'success', stepMs: 10 });
  const make = async () => {
    const built = await buildApp(vercelConfig(), { provider: fake, kv });
    apps.push(built);
    return createHandler(async () => built);
  };
  return { fake, a: await make(), b: await make() };
}

/** A browser request as Vercel delivers it after the /api/ai rewrite in vercel.json. */
function request(
  path: string,
  init: { method?: string; cookie?: string; body?: RequestInit['body']; type?: string; origin?: string } = {},
) {
  const headers = new Headers({
    host: new URL(SITE).host,
    'sec-fetch-site': 'same-origin',
    [AI_CLIENT_HEADER]: '1',
    'x-real-ip': '203.0.113.7',
  });
  const method = init.method ?? 'GET';
  if (method !== 'GET' || init.origin) headers.set('origin', init.origin ?? SITE);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.type) headers.set('content-type', init.type);
  return new Request(`${SITE}/api/ai-gateway?${PATH_PARAM}=${encodeURIComponent(path)}`, {
    method,
    headers,
    ...(init.body ? { body: init.body } : {}),
  });
}

/** Response bodies used here (the server tsconfig has no DOM types for Response.json). */
interface Body {
  error: { code: string };
  id: string;
  status: string;
  enabled: boolean;
  access: { required: boolean; granted: boolean };
}
const read = (res: Response) => res.json() as Promise<Body>;

const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

describe('Vercel configuration', () => {
  it('requires Redis and an access code before AI can run', () => {
    expect(vercelConfig({ KV_REST_API_URL: '', KV_REST_API_TOKEN: '' }).ai.unavailableReason).toMatch(
      /Redis/,
    );
    expect(vercelConfig({ AI_ACCESS_CODE: '' }).ai.unavailableReason).toMatch(/AI_ACCESS_CODE/);
    expect(vercelConfig().ai.unavailableReason).toBeNull();
    expect(() => vercelConfig({ AI_ACCESS_CODE: 'short' })).toThrow(ConfigError);
    expect(() => vercelConfig({ AI_STORE: 'memory' })).toThrow(ConfigError);
  });

  it('fits the 4.5 MB request limit, serves no static files and uses Secure cookies', () => {
    const config = vercelConfig({ AI_MAX_UPLOAD_BYTES: String(4 * 1024 * 1024) });
    expect(config.ai.maxUploadBytes).toBe(4 * 1024 * 1024);
    expect(() => vercelConfig({ AI_MAX_UPLOAD_BYTES: String(8 * 1024 * 1024) })).toThrow(ConfigError);
    expect(config.staticRoot).toBeNull();
    expect(config.secureCookies).toBe(true);
    expect(config.ai.devUploads).toBe(false);
  });
});

describe('Vercel Function handler', () => {
  it('runs the whole flow across instances: access code, session, job, result', async () => {
    const { fake, a, b } = await deployment();

    const caps = await read(await a(request('capabilities')));
    expect(caps).toMatchObject({ enabled: true, access: { required: true, granted: false } });

    // No access yet: a session cannot be started.
    const denied = await a(request('session', { method: 'POST' }));
    expect(denied.status).toBe(403);
    expect((await read(denied)).error.code).toBe('access-required');

    const wrong = await a(
      request('access', { method: 'POST', body: JSON.stringify({ code: 'nope' }), type: 'application/json' }),
    );
    expect((await read(wrong)).error.code).toBe('access-denied');

    const unlock = await a(
      request('access', { method: 'POST', body: JSON.stringify({ code: CODE }), type: 'application/json' }),
    );
    expect(unlock.status).toBe(204);
    const setCookie = unlock.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    const access = cookieOf(unlock);
    // The signed cookie is valid on every instance.
    expect((await read(await b(request('capabilities', { cookie: access })))).access.granted).toBe(true);

    const session = await b(request('session', { method: 'POST', cookie: access }));
    expect(session.status).toBe(200);
    const cookie = `${access}; ${cookieOf(session)}`;

    const body = multipart(jobParts(await makeImage(480, 640)));
    const posted = await a(
      request('jobs', { method: 'POST', cookie, body: new Uint8Array(body.payload), type: body.contentType }),
    );
    expect(posted.status).toBe(202);
    const id = (await read(posted)).id as string;

    // Status reads can land on any instance.
    await waitFor(
      async () => (await read(await b(request(`jobs/${id}`, { cookie })))).status,
      (s) => s === 'completed',
    );
    const result = await a(request(`jobs/${id}/result`, { cookie }));
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe('image/jpeg');
    expect(result.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await result.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]); // binary intact
    expect(fake.submitCount).toBe(1);

    const end = await b(request('session', { method: 'DELETE', cookie }));
    expect(end.status).toBe(204);
    expect(await end.text()).toBe('');
    expect((await a(request(`jobs/${id}/result`, { cookie }))).status).toBe(401);
  });

  it('accepts only its own origin, and no path outside /api/ai', async () => {
    const { a } = await deployment();
    const evil = await a(request('session', { method: 'POST', origin: 'https://evil.example' }));
    expect(evil.status).toBe(403);
    expect((await read(evil)).error.code).toBe('forbidden');
    const bare = await a(new Request(`${SITE}/api/ai-gateway`));
    expect(bare.status).toBe(404);
    const traversal = await a(request('../../etc/passwd'));
    expect(traversal.status).toBe(404);
  });

  it('limits wrong access codes per client', async () => {
    const { a } = await deployment();
    const attempt = () =>
      a(
        request('access', {
          method: 'POST',
          body: JSON.stringify({ code: 'wrong-code' }),
          type: 'application/json',
        }),
      );
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(403);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    // Even the right code is refused while blocked.
    const right = await a(
      request('access', { method: 'POST', body: JSON.stringify({ code: CODE }), type: 'application/json' }),
    );
    expect(right.status).toBe(429);
  });

  it('reports a configuration error as unavailable instead of crashing', async () => {
    const handler = createHandler(async () => {
      throw new ConfigError('AI_PORT must be an integer');
    });
    const res = await handler(request('capabilities'));
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('not-configured');
  });
});

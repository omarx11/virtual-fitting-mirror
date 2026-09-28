/**
 * Vercel Function entry (bundled by `npm run build:vercel` into dist-vercel/vercel.js and exported
 * by api/ai-gateway.js). vercel.json rewrites /api/ai/<path> to this function, and Vercel passes
 * <path> as the query parameter vfmPath (named in the rewrite destination); the request is then handed to the same Fastify app the kiosk runs, in process.
 *
 * - One app per function instance, built on its first request and reused (Fluid compute keeps
 *   instances warm and runs concurrent requests in one instance).
 * - State is shared between instances through Redis (config platform 'vercel').
 * - Background job work (submission, provider polling) is kept alive with `waitUntil`, within the
 *   function's maxDuration (vercel.json).
 */
import { ipAddress, waitUntil } from '@vercel/functions';
import { type BuiltApp, buildApp } from './app';
import { ConfigError, loadConfig } from './config';

/** The rewrite's named segment (/api/ai/:vfmPath*), which Vercel passes on as a query parameter. */
export const PATH_PARAM = 'vfmPath';
const PREFIX = '/api/ai/';
/** Hop-by-hop or recomputed headers that must not be copied onto the Response. */
const SKIP = new Set(['connection', 'content-length', 'keep-alive', 'transfer-encoding']);

function json(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });
}

/** Builds the fetch handler around an app factory (tests pass one with an in-memory store). */
export function createHandler(getApp: () => Promise<BuiltApp>) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path =
      url.searchParams.get(PATH_PARAM) ??
      (url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : null);
    url.searchParams.delete(PATH_PARAM);
    if (path === null || path.includes('..')) return json(404, 'not-found', 'Unknown API route.');

    let built: BuiltApp;
    try {
      built = await getApp();
    } catch (error) {
      console.error('[api] AI server could not start:', error instanceof Error ? error.message : error);
      const message =
        error instanceof ConfigError
          ? `AI server configuration error: ${error.message}`
          : 'The AI server could not start.';
      return json(503, 'not-configured', message);
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    headers.host = request.headers.get('host') ?? url.host;
    const method = request.method.toUpperCase();
    const res = await built.app.inject({
      method: method as 'GET',
      url: `${PREFIX}${path.replace(/^\/+/, '')}${url.search}`,
      headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { payload: Buffer.from(await request.arrayBuffer()) }),
      // Rate limits and access-code attempts are counted per client.
      remoteAddress: ipAddress(request) ?? '0.0.0.0',
    });

    const out = new Headers();
    for (const [name, value] of Object.entries(res.headers)) {
      if (value === undefined || SKIP.has(name)) continue;
      for (const v of Array.isArray(value) ? value : [value]) out.append(name, String(v));
    }
    const empty = method === 'HEAD' || res.statusCode === 204 || res.statusCode === 304;
    return new Response(empty ? null : new Uint8Array(res.rawPayload), {
      status: res.statusCode,
      headers: out,
    });
  };
}

let app: Promise<BuiltApp> | null = null;

function getApp(): Promise<BuiltApp> {
  if (!app) {
    app = (async () => {
      const config = loadConfig(process.env, { production: true, root: process.cwd(), platform: 'vercel' });
      const built = await buildApp(config, { defer: waitUntil });
      await built.app.ready();
      return built;
    })();
    // A failed start (e.g. a configuration error) is retried on the next request.
    app.catch(() => {
      app = null;
    });
  }
  return app;
}

export default { fetch: createHandler(getApp) };

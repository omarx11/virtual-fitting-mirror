import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import react from '@vitejs/plugin-react';
import { type Connect, loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const tasksVisionVersion: string = JSON.parse(
  readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8'),
).version;

/**
 * Content-Security-Policy: only allow network connections to this origin. Together with the fetch
 * guard in src/tracking/networkGuard.ts this blocks MediaPipe's usage-metrics POST to
 * odml.pa.googleapis.com. Sent as a response header because the pose worker is governed by the CSP
 * of its own script response (the <meta> tag in index.html only covers the page). Applies to
 * `npm run dev` and `npm run preview`; the production server (server/app.ts) sends the same header.
 */
export const CONNECT_SRC = "connect-src 'self' ws: wss: blob: data:";
const securityHeaders: Record<string, string> = { 'Content-Security-Policy': CONNECT_SRC };

/** Header meaning "the local AI server is not running"; src/ai/client.ts checks for it. */
const BACKEND_OFFLINE_HEADER = 'x-ai-backend-offline';

/**
 * With only the web app running (e.g. `npm run dev:web`), proxying /api would fail with 502s that
 * the browser logs as console errors on every AI check. This answers /api requests itself while
 * the backend port is closed: 204 plus BACKEND_OFFLINE_HEADER, which the client reports as "the
 * AI server is not running". Registered before Vite's proxy; the port is re-probed every 2 s.
 */
function apiOfflineFallback(target: string): Plugin {
  const { hostname, port, protocol } = new URL(target);
  const probe = () =>
    new Promise<boolean>((resolve) => {
      const socket = connect({ host: hostname, port: Number(port) || (protocol === 'https:' ? 443 : 80) });
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(500, () => done(false));
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
    });
  let checkedAt = 0;
  let online = false;
  let pending: Promise<boolean> | null = null;
  const isOnline = (): Promise<boolean> => {
    if (Date.now() - checkedAt < 2000) return Promise.resolve(online);
    pending ??= probe().then((ok) => {
      online = ok;
      checkedAt = Date.now();
      pending = null;
      return ok;
    });
    return pending;
  };
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next();
    void isOnline().then((ok) => {
      if (ok) return next();
      res.statusCode = 204;
      res.setHeader(BACKEND_OFFLINE_HEADER, '1');
      res.setHeader('Cache-Control', 'no-store');
      res.end();
    });
  };
  return {
    name: 'api-offline-fallback',
    configureServer: (server) => {
      server.middlewares.use(middleware);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(middleware);
    },
  };
}

/**
 * Fills __SITE_ORIGIN__ in index.html's link-preview tags: link crawlers (WhatsApp, X, Slack…) need
 * an absolute og:image URL. SITE_URL wins; on Vercel the production domain is used automatically.
 * Without either (local builds) the URLs stay root-relative, which browsers still resolve.
 */
function socialPreview(env: Record<string, string | undefined>): Plugin {
  const production = env.VERCEL_PROJECT_PRODUCTION_URL;
  const origin = (env.SITE_URL || (production ? `https://${production}` : '')).replace(/\/+$/, '');
  return {
    name: 'social-preview',
    transformIndexHtml: (html) => html.replaceAll('__SITE_ORIGIN__', origin),
  };
}

export default defineConfig(({ mode }) => {
  // Only AI_PORT / AI_API_TARGET are read here (for the proxy). Secrets are never loaded into the
  // frontend: only VITE_-prefixed variables reach browser code, and none are used.
  const env = { ...loadEnv(mode, process.cwd(), 'AI_'), ...process.env };
  const apiTarget = env.AI_API_TARGET || `http://127.0.0.1:${env.AI_PORT || 3001}`;
  // The browser calls same-origin /api; Vite forwards it to the local backend (server/). The Host
  // header is kept (changeOrigin: false) so the backend's origin checks see the real page origin.
  const proxy = { '/api': { target: apiTarget, changeOrigin: false } };
  return {
    plugins: [react(), apiOfflineFallback(apiTarget), socialPreview(env)],
    server: { headers: securityHeaders, proxy },
    preview: { headers: securityHeaders, proxy },
    define: {
      __TASKS_VISION_VERSION__: JSON.stringify(tasksVisionVersion),
    },
    worker: {
      format: 'es',
    },
    build: {
      target: 'es2022',
      // The MediaPipe WASM binary is ~12 MB; it is loaded lazily by the worker.
      chunkSizeWarningLimit: 1500,
    },
    test: {
      include: ['tests/unit/**/*.test.ts', 'tests/server/**/*.test.ts'],
      environment: 'node',
    },
  };
});

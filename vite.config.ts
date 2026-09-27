import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
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

export default defineConfig(({ mode }) => {
  // Only AI_PORT / AI_API_TARGET are read here (for the proxy). Secrets are never loaded into the
  // frontend: only VITE_-prefixed variables reach browser code, and none are used.
  const env = { ...loadEnv(mode, process.cwd(), 'AI_'), ...process.env };
  const apiTarget = env.AI_API_TARGET || `http://127.0.0.1:${env.AI_PORT || 3001}`;
  // The browser calls same-origin /api; Vite forwards it to the local backend (server/). The Host
  // header is kept (changeOrigin: false) so the backend's origin checks see the real page origin.
  const proxy = { '/api': { target: apiTarget, changeOrigin: false } };
  return {
    plugins: [react()],
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

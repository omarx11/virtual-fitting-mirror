import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const tasksVisionVersion: string = JSON.parse(
  readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8'),
).version;

/**
 * Content-Security-Policy: only allow network connections to this origin. Together with the fetch
 * guard in src/tracking/networkGuard.ts this blocks MediaPipe's usage-metrics POST to
 * odml.pa.googleapis.com. Sent as a response header because the pose worker is governed by the CSP
 * of its own script response (the <meta> tag in index.html only covers the page). Applies to
 * `npm run dev` and `npm run preview`; other hosts should send the same header (see README).
 */
export const CONNECT_SRC = "connect-src 'self' ws: wss: blob: data:";
const securityHeaders: Record<string, string> = { 'Content-Security-Policy': CONNECT_SRC };

export default defineConfig({
  plugins: [react()],
  server: { headers: securityHeaders },
  preview: { headers: securityHeaders },
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
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});

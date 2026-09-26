import { defineConfig } from '@playwright/test';

/**
 * Production-build checks: `npm run test:e2e:preview` builds, then serves dist/ with `vite preview`
 * and reruns the tests that prove bundled asset paths (GLB, MediaPipe and Jolt WASM) and local-only
 * networking. Development-only features (inspection view, 2D WebGL fallback) are excluded.
 */
const gpuArgs = ['--enable-gpu', '--use-angle=default', '--autoplay-policy=no-user-gesture-required'];

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /(privacy|garment3d)\.spec\.ts/,
  grep: /runtime location|real footage|leaves? localhost|context loss|switching garments/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'preview', use: { browserName: 'chromium', launchOptions: { args: gpuArgs } } }],
  webServer: {
    command: 'npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

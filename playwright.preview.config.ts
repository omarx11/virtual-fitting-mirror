import { defineConfig } from '@playwright/test';
import { PLANTED_KEY } from './playwright.config';

/**
 * Production-build checks: `npm run test:e2e:preview` builds, then runs the PRODUCTION server
 * (dist-server/index.js serving dist/ and /api at one origin) and reruns the tests that prove bundled
 * asset paths (GLB, MediaPipe and Jolt WASM), local-only networking and the AI flow. The fake
 * provider is explicitly allowed here for testing only. Development-only features (inspection view,
 * 2D WebGL fallback) are excluded.
 */
const gpuArgs = ['--enable-gpu', '--use-angle=default', '--autoplay-policy=no-user-gesture-required'];

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /(privacy|garment3d|ai)\.spec\.ts/,
  grep: /runtime location|real footage|leaves? localhost|context loss|switching garments|@preview/,
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
    command: 'node dist-server/index.js',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      AI_ENV_FILE: 'none',
      AI_PROVIDER: 'fake',
      AI_ALLOW_FAKE_PROVIDER: 'true',
      AI_ENABLED: 'true',
      FASHN_API_KEY: PLANTED_KEY,
      AI_HOST: '127.0.0.1',
      AI_PORT: '4174',
      AI_LEDGER_PATH: 'memory',
      AI_MAX_DAILY_CREDITS: '1000',
      AI_FAKE_STEP_MS: '600',
      AI_POLL_INTERVAL_MS: '200',
      AI_LOG_LEVEL: 'warn',
    },
  },
});

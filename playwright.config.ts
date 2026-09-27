import { defineConfig } from '@playwright/test';

/**
 * Browser tests run against the Vite dev server (React Strict Mode on, so double-mount cleanup is
 * exercised) plus the local AI backend with the OFFLINE fake provider (no network, no key, no
 * spend; its results are stamped "TEST RESULT"). GPU flags let headless Chromium use the real GPU
 * via ANGLE where available; tests do not assert speed.
 */
const gpuArgs = ['--enable-gpu', '--use-angle=default', '--autoplay-policy=no-user-gesture-required'];

/** A dummy value: tests assert it never appears in anything the browser receives. */
export const PLANTED_KEY = 'vfm-planted-test-key-must-never-reach-the-browser';
const API_PORT = 3101;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'app',
      testIgnore: /camera-fake\.spec\.ts/,
      use: { browserName: 'chromium', launchOptions: { args: gpuArgs } },
    },
    {
      // Chromium's synthetic camera: exercises the camera code path, NOT a physical webcam.
      name: 'fake-camera',
      testMatch: /camera-fake\.spec\.ts/,
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [...gpuArgs, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'npx tsx server/index.ts',
      url: `http://127.0.0.1:${API_PORT}/api/ai/capabilities`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        AI_ENV_FILE: 'none',
        AI_PROVIDER: 'fake',
        AI_ENABLED: 'true',
        FASHN_API_KEY: PLANTED_KEY,
        AI_PORT: String(API_PORT),
        AI_ALLOWED_ORIGINS: 'http://localhost:5174',
        AI_LEDGER_PATH: 'memory',
        AI_MAX_DAILY_CREDITS: '1000',
        AI_FAKE_STEP_MS: '600',
        AI_POLL_INTERVAL_MS: '200',
        AI_LOG_LEVEL: 'warn',
      },
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 60_000,
      env: { AI_API_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});

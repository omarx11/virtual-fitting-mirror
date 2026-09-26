import { defineConfig } from '@playwright/test';

/**
 * Browser tests run against the Vite dev server (React Strict Mode on, so double-mount cleanup is
 * exercised). GPU flags let headless Chromium use the real GPU via ANGLE where available; tests do
 * not assert speed.
 */
const gpuArgs = ['--enable-gpu', '--use-angle=default', '--autoplay-policy=no-user-gesture-required'];

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
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

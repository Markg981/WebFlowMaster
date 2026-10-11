import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/matrix-certification.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  outputDir: '../e2e-artifacts/results',
  reporter: [['list'], ['html', { outputFolder: '../e2e-artifacts/report', open: 'never' }]],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      // In CI Firefox sometimes stops answering Playwright on the first navigation of a new
      // page: the server answers in milliseconds and the app renders (traces of the failing
      // runs), yet goto never sees the commit and no locator after it gets an answer. Zero to
      // three tests a run, a different set each time, Firefox only. Waiting longer in the test
      // does not help, and turning off site isolation (fission prefs, October 2026) did not
      // change the rate: the cause is still open. A retry runs in a new worker with a new
      // browser and passes; the report lists the test as flaky, and a failure that repeats
      // fails the run as before.
      retries: process.env.CI ? 1 : 0,
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5080',
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/start.mjs',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://127.0.0.1:5080/api/registration',
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});

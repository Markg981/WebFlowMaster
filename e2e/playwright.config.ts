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
      use: {
        ...devices['Desktop Firefox'],
        // In CI Firefox sometimes stops answering Playwright on the first navigation of a new
        // page: the server answers /auth in milliseconds and the app renders (trace of the
        // failing runs), yet goto never sees the commit and every locator after it gets no
        // answer at all. Only the first navigation of a page fails, the one that moves it from
        // about:blank to the application's origin and, with site isolation, into another content
        // process. Keeping one process per page avoids that switch. The product is not
        // affected: this is the test browser, and every assertion still runs in it.
        launchOptions: {
          firefoxUserPrefs: { 'fission.autostart': false, 'fission.webContentIsolationStrategy': 0 },
        },
      },
      // A retry runs in a new worker with a new browser, and the report still lists the test
      // as flaky. Any failure that repeats fails the run as before.
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

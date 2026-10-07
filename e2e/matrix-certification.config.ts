import { defineConfig, devices } from '@playwright/test';
import installation from './playwright.config';

export default defineConfig({
  ...installation,
  testMatch: 'matrix-certification.spec.ts',
  testIgnore: [],
  timeout: 420_000,
  projects: [{ name: 'real-matrix', use: { ...devices['Desktop Chrome'] } }],
  use: { ...installation.use, trace: 'off', video: 'off', screenshot: 'off' },
});

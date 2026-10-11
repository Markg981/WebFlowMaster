/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  // Vitest ignores vite.config.ts when a vitest.config.ts exists, so the path aliases have
  // to be repeated here — without them every test importing "@/…" or "@shared/…" fails to
  // resolve, which is what kept most of this suite red.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    css: false, // Optional: if you don't need to test CSS or have issues with CSS imports
    // npm run test:coverage, and CI. The thresholds sit a few points under what the suite
    // measured when they were set (October 2026): they stop a slide, not a single refactor.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/setupTests.ts', 'src/main.tsx', 'src/**/*.d.ts'],
      // Measured: lines 75.5, statements 72.0, functions 63.8, branches 65.9.
      thresholds: { lines: 72, statements: 69, functions: 60, branches: 62 },
    },
  },
});

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true, // To use describe, it, expect, etc. globally
    environment: 'node', // Crucial for backend testing
    include: ['server/**/*.test.ts'], // Pattern to find test files
    // The tests share a single file-backed PGlite database. PGlite is a single-writer
    // WASM instance, so running test files in parallel across workers corrupts it
    // (WASM "Aborted()"). Run everything in one process, sequentially.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    // setupFiles: ['./server/tests/setup.ts'], // Optional: for global test setup
    // reporters: ['default', 'html'], // Optional: for UI reporting via @vitest/ui
    // coverage: { // Optional: configure coverage
    //   provider: 'v8', // or 'istanbul'
    // reporters: ['default', 'html'], // Optional: for UI reporting via @vitest/ui
    // coverage: { // Optional: configure coverage
    //   provider: 'v8', // or 'istanbul'
    //   reporter: ['text', 'json', 'html'],
    // },
    setupFiles: ['./server/tests/setup.ts'], // Added setup file for migrations
    env: {
      DATABASE_URL: 'data/test.db',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['server/**/*.ts'],
      exclude: ['server/**/*.test.ts', 'server/tests/**'],
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
      // '@': path.resolve(__dirname, './client/src'),
    },
  },
});

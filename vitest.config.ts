import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true, // To use describe, it, expect, etc. globally
    environment: 'node', // Crucial for backend testing
    include: ['server/**/*.test.ts', 'scripts/**/*.test.ts'], // Pattern to find test files
    // Each test file gets its own in-memory PGlite database — see server/tests/setup.ts, which
    // assigns DATABASE_URL before server/db.ts is ever imported. That is what makes parallelism
    // safe: PGlite is a single-writer WASM instance, so sharing one database across workers
    // corrupts it, which is why this used to be singleFork + fileParallelism:false. Separate
    // instances in separate forks have nothing to contend over.
    pool: 'forks',
    // Every file's beforeAll applies the ten migrations to its own PGlite instance, which is
    // Postgres compiled to WASM — seconds of CPU, not milliseconds. With one fork per file
    // competing for cores (and some files driving a real browser), that setup regularly ran
    // past vitest's 10s default and vitest reported it as the *file* failing with every test
    // skipped, which reads like a broken suite rather than a loaded machine. The work is
    // legitimately slow; only the ceiling was wrong.
    hookTimeout: 60_000,
    // setupFiles: ['./server/tests/setup.ts'], // Optional: for global test setup
    // reporters: ['default', 'html'], // Optional: for UI reporting via @vitest/ui
    // coverage: { // Optional: configure coverage
    //   provider: 'v8', // or 'istanbul'
    // reporters: ['default', 'html'], // Optional: for UI reporting via @vitest/ui
    // coverage: { // Optional: configure coverage
    //   provider: 'v8', // or 'istanbul'
    //   reporter: ['text', 'json', 'html'],
    // },
    setupFiles: ['./server/tests/setup.ts'], // Per-file database + migrations
    env: {
      // Overridden per file by the setup file above (to memory://) unless it names a real
      // Postgres, which the RLS-under-a-non-superuser CI job does. Kept as the default so a
      // bare `npx vitest run` still has something valid.
      DATABASE_URL: 'memory://',
      // setupAuth requires these; provide test values so route-registering suites
      // don't throw. Sessions use an in-memory store under NODE_ENV=test.
      SESSION_SECRET: 'test-session-secret',
      ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
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

import { defineConfig } from 'vitest/config';
import path from 'path';
import { defaultMaxWorkers } from './scripts/test-workers';

export default defineConfig({
  test: {
    globals: true, // To use describe, it, expect, etc. globally
    environment: 'node', // Crucial for backend testing
    include: ['server/**/*.test.ts', 'scripts/**/*.test.ts'], // Pattern to find test files
    // Real child-process acceptance runs separately with its own deadline and no database setup.
    exclude: ['scripts/bdd-runtime.test.ts'],
    // Each test file gets its own in-memory PGlite database — see server/tests/setup.ts, which
    // assigns DATABASE_URL before server/platform/db.ts is ever imported. That is what makes parallelism
    // safe: PGlite is a single-writer WASM instance, so sharing one database across workers
    // corrupts it, which is why this used to be singleFork + fileParallelism:false. Separate
    // instances in separate forks have nothing to contend over.
    pool: 'forks',
    // One PGlite is ~0.5 GB resident, so the default worker count follows total memory (see
    // scripts/test-workers.ts). Override with VITEST_MAX_WORKERS or --maxWorkers=N.
    maxWorkers: defaultMaxWorkers(),
    // Every file's beforeAll applies the ten migrations to its own PGlite instance, which is
    // Postgres compiled to WASM — seconds of CPU, not milliseconds. With one fork per file
    // competing for cores (and some files driving a real browser), that setup regularly ran
    // past vitest's 10s default and vitest reported it as the *file* failing with every test
    // skipped, which reads like a broken suite rather than a loaded machine. The work is
    // legitimately slow; only the ceiling was wrong.
    hookTimeout: 60_000,
    // The same for the tests themselves. mobile-inspector and web-performance failed only in the
    // full run, each with "Test timed out in 5000ms" while doing its work slowly, and passed
    // alone. A test that hangs still fails, after 30s.
    testTimeout: 30_000,
    setupFiles: ['./server/tests/setup.ts'], // Per-file database + migrations
    env: {
      // Overridden per file by the setup file above (to memory://) unless it names a real
      // Postgres, which the RLS-under-a-non-superuser CI job does. Kept as the default so a
      // bare `npx vitest run` still has something valid.
      DATABASE_URL: process.env.DATABASE_URL ?? 'memory://',
      // setupAuth requires these; provide test values so route-registering suites
      // don't throw. Sessions use an in-memory store under NODE_ENV=test.
      SESSION_SECRET: 'test-session-secret',
      ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
      // Suites register many unrelated accounts, each with its own organization. The default,
      // invitation-only registration is tested on its own in server/identity/registration.test.ts.
      REGISTRATION: 'open',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['server/**/*.ts'],
      exclude: ['server/**/*.test.ts', 'server/tests/**'],
      // A few points under what the suite measured when they were set (October 2026: lines 83.4,
      // statements 79.8, functions 83.3, branches 71.3). They stop a slide, not a single refactor.
      thresholds: { lines: 80, statements: 77, functions: 80, branches: 68 },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
      // '@': path.resolve(__dirname, './client/src'),
    },
  },
});

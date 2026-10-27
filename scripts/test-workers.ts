import os from 'node:os';

/**
 * Rough resident memory of one server-test worker: every test file runs its own PGlite
 * (Postgres compiled to WASM) in its own fork. Measured October 2026 at ~480-510 MB RSS per
 * worker on auth, api-keys and collaboration-isolation; 1024 leaves room for heavier files,
 * the vitest main process and the OS.
 */
export const MB_PER_TEST_WORKER = 1024;

/**
 * Default `maxWorkers` for the server suite. `VITEST_MAX_WORKERS` wins (and the CLI flag
 * `--maxWorkers` wins over the config). Otherwise: `undefined` on CI (vitest's own default,
 * runners are sized for it), and elsewhere min(cores, totalMemory / MB_PER_TEST_WORKER), at least 1.
 */
export function defaultMaxWorkers(
  env: NodeJS.ProcessEnv = process.env,
  cores: number = os.availableParallelism(),
  totalMemBytes: number = os.totalmem(),
): number | undefined {
  const override = Number.parseInt(env.VITEST_MAX_WORKERS ?? '', 10);
  if (Number.isFinite(override) && override >= 1) return override;
  if (env.CI) return undefined;
  const byMemory = Math.floor(totalMemBytes / (MB_PER_TEST_WORKER * 1024 * 1024));
  return Math.max(1, Math.min(cores, byMemory));
}

import type { JobsOptions } from 'bullmq';
import { TracedQueue } from './observability/queue';
import { connection } from './redis';

export const TEST_EXECUTION_QUEUE_NAME = 'test-execution-queue';

export const TEST_EXECUTION_JOB_OPTIONS = {
  attempts: 1, // Usually tests shouldn't be retried automatically at this level, unless specified by the plan
  removeOnComplete: true,
  // Kept a week, and at most five thousand of them: long enough to read why a run never ran,
  // without a Redis that grows by every failure for ever, as `false` made it.
  removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
} satisfies JobsOptions;

export const testExecutionQueue = new TracedQueue(TEST_EXECUTION_QUEUE_NAME, {
  connection,
  defaultJobOptions: TEST_EXECUTION_JOB_OPTIONS,
});

/**
 * Load runs (server/load-runner.ts) on a queue of their own: a load run lasts up to an hour and
 * sends from the process that takes it, so operators scale the workers that take them
 * (LOAD_WORKER_CONCURRENCY) apart from the plan runners, and a nightly plan never holds one up.
 */
export const LOAD_QUEUE_NAME = 'load-queue';
export const LOAD_RUN_JOB = 'load-run';

export const LOAD_RUN_JOB_OPTIONS = {
  // A run interrupted half-way has already loaded the system under test: not repeated on its own.
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
} satisfies JobsOptions;

export const loadQueue = new TracedQueue(LOAD_QUEUE_NAME, {
  connection,
  defaultJobOptions: LOAD_RUN_JOB_OPTIONS,
});

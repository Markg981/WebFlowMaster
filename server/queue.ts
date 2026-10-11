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

import { Queue } from 'bullmq';
import { connection } from './redis';

export const TEST_EXECUTION_QUEUE_NAME = 'test-execution-queue';

export const testExecutionQueue = new Queue(TEST_EXECUTION_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 1, // Usually tests shouldn't be retried automatically at this level, unless specified by the plan
    removeOnComplete: true,
    removeOnFail: false,
  },
});

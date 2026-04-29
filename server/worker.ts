import { Worker } from 'bullmq';
import { connection } from './redis';
import { TEST_EXECUTION_QUEUE_NAME } from './queue';
import { processTestPlanJob } from './test-execution-service';
import loggerPromise from './logger';
import 'dotenv/config';

(async () => {
  const logger = await loggerPromise;

  const worker = new Worker(
    TEST_EXECUTION_QUEUE_NAME,
    async (job) => {
      logger.info(`Worker processing job ${job.id} of type ${job.name}`);
      
      if (job.name === 'execute-plan') {
        const { planId, testPlanRunId, userId } = job.data;
        try {
          await processTestPlanJob(planId, testPlanRunId, userId);
        } catch (error) {
          logger.error(`Job ${job.id} failed:`, error);
          throw error; // Let BullMQ handle the failure
        }
      }
    },
    { connection, concurrency: 1 } // concurrency: 1 for safety with Playwright initially
  );

  worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed with error:`, err);
  });

  logger.info(`Worker started and listening to queue: ${TEST_EXECUTION_QUEUE_NAME}`);
})();

import { Worker, type Job } from 'bullmq';
import { connection } from './redis';
import { TEST_EXECUTION_QUEUE_NAME } from './queue';
import { processTestPlanJob } from './test-execution-service';
import loggerPromise from './logger';
import { correlationStore } from './middleware/correlation';
import 'dotenv/config';

(async () => {
  const logger = await loggerPromise;

  const worker = new Worker(
    TEST_EXECUTION_QUEUE_NAME,
    async (job: Job) => {
      logger.info(`Worker processing job ${job.id} of type ${job.name}`);
      
      if (job.name === 'execute-plan') {
        const { planId, testPlanRunId, userId, correlationId } = job.data;

        // Restore the correlation context from the original HTTP request
        // so all logs emitted during job processing share the same trace ID.
        const cid = correlationId || `worker-${testPlanRunId.slice(0, 8)}`;

        await correlationStore.run({ correlationId: cid }, async () => {
          try {
            await processTestPlanJob(planId, testPlanRunId, userId);
          } catch (error: any) {
            logger.error(`Job ${job.id} failed:`, error);
            throw error; // Let BullMQ handle the failure
          }
        });
      }
    },
    { connection, concurrency: 1 } // concurrency: 1 for safety with Playwright initially
  );

  worker.on('completed', (job: Job) => {
    logger.info(`Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(`Job ${job?.id} failed with error:`, err);
  });

  logger.info(`Worker started and listening to queue: ${TEST_EXECUTION_QUEUE_NAME}`);
})();

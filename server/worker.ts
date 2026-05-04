import { Worker, type Job } from 'bullmq';
import { connection } from './redis';
import { TEST_EXECUTION_QUEUE_NAME, SCHEDULER_QUEUE_NAME } from './queue';
import { processTestPlanJob } from './test-execution-service';
import loggerPromise from './logger';
import { correlationStore } from './middleware/correlation';
import { db } from './db';
import { testPlanSchedules, testPlans } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { executeScheduledPlan } from './scheduler-service';
import 'dotenv/config';

(async () => {
  const logger = await loggerPromise;

  // Worker for general test execution
  const executionWorker = new Worker(
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

  executionWorker.on('completed', (job: Job) => {
    logger.info(`Execution job ${job.id} completed successfully`);
  });

  executionWorker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(`Execution job ${job?.id} failed with error:`, err);
  });

  logger.info(`Worker started and listening to queue: ${TEST_EXECUTION_QUEUE_NAME}`);

  // Worker for processing recurring scheduler events
  const schedulerWorker = new Worker(
    SCHEDULER_QUEUE_NAME,
    async (job: Job) => {
      logger.info(`Scheduler processing job ${job.id}`);
      if (job.name === 'execute-scheduled-plan') {
        const { scheduleId } = job.data;
        const schedules = await db.select().from(testPlanSchedules).where(eq(testPlanSchedules.id, scheduleId)).limit(1);
        if (schedules.length === 0 || !schedules[0].isActive) {
          logger.info(`Scheduler skip: schedule ${scheduleId} inactive or deleted.`);
          return;
        }

        const plans = await db.select().from(testPlans).where(eq(testPlans.id, schedules[0].testPlanId)).limit(1);
        if (plans.length > 0) {
           await executeScheduledPlan(schedules[0], plans[0]);
        }
      }
    },
    { connection, concurrency: 5 }
  );

  schedulerWorker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(`Scheduler job ${job?.id} failed:`, err);
  });

  logger.info(`Scheduler worker started and listening to queue: ${SCHEDULER_QUEUE_NAME}`);

})();

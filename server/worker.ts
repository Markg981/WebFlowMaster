import { Worker, type Job } from 'bullmq';
import { connection } from './redis';
import { TEST_EXECUTION_QUEUE_NAME } from './queue';
import { processTestPlanJob } from './test-execution-service';
import loggerPromise from './logger';
import { correlationStore } from './middleware/correlation';
import { closeDb, db } from './db';
import { TRIGGER_SCHEDULE_JOB, executeScheduledPlan } from './scheduler-service';
import { testPlanSchedules, testPlans } from '@shared/schema';
import { eq } from 'drizzle-orm';
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
      } else if (job.name === TRIGGER_SCHEDULE_JOB) {
        // Fired by a BullMQ job scheduler (SCHEDULER_BACKEND=bullmq). Load the latest
        // schedule + plan from the DB and run it via the shared execution logic.
        const { scheduleId } = job.data;
        const cid = `sched-${String(scheduleId).slice(0, 8)}`;
        await correlationStore.run({ correlationId: cid }, async () => {
          const [schedule] = await db.select().from(testPlanSchedules).where(eq(testPlanSchedules.id, scheduleId)).limit(1);
          if (!schedule) {
            logger.warn(`Scheduled trigger for unknown/removed schedule ${scheduleId}; skipping.`);
            return;
          }
          if (!schedule.isActive) {
            logger.info(`Scheduled trigger for inactive schedule ${scheduleId}; skipping.`);
            return;
          }
          const [plan] = await db.select().from(testPlans).where(eq(testPlans.id, schedule.testPlanId)).limit(1);
          if (!plan) {
            logger.warn(`Scheduled trigger for schedule ${scheduleId}: test plan ${schedule.testPlanId} not found; skipping.`);
            return;
          }
          await executeScheduledPlan(schedule, plan);
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

  // ─── Graceful shutdown ──────────────────────────────────────────────────────
  // worker.close() waits for the in-flight job to finish before resolving, so a
  // redeploy doesn't kill a running test execution mid-flight.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Worker received ${signal}, shutting down gracefully...`);
    const forceTimer = setTimeout(() => process.exit(1), 30000);
    forceTimer.unref();
    try {
      await worker.close(); // waits for the active job to complete
      await connection.quit();
      await closeDb();
      logger.info('Worker graceful shutdown complete.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during worker graceful shutdown', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
})();

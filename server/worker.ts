import { DelayedError, Worker, type Job } from 'bullmq';
import { connection } from './redis';
import { TEST_EXECUTION_QUEUE_NAME } from './queue';
import { processTestPlanJob } from './test-execution-service';
import loggerPromise from './logger';
import { correlationStore } from './middleware/correlation';
import { closeDb, privilegedDb } from './db';
import { TRIGGER_SCHEDULE_JOB, executeScheduledPlan, scheduledOccurrence } from './scheduler-service';
import { testPlanSchedules, testPlans } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { withJobIncidents } from './observability/taps/jobs';
import { artifactStore } from './artifact-store';
import { BROWSER_TASK_QUEUE_NAME, performBrowserTask, type BrowserTaskEnvelope } from './browser-tasks';
import { RunnerAgent, type PausableQueue } from './runner-registry';
import 'dotenv/config';

(async () => {
  const logger = await loggerPromise;
  // A misconfigured artifact store fails here, not on the first screenshot of the first run.
  logger.info(`Artifact store: ${artifactStore().kind}`);

  // Jobs in hand, on both queues, for the runner heartbeat: what a drained runner is waiting for.
  let activeJobs = 0;
  const activeJobCount = () => activeJobs;
  const counted = <A extends unknown[], R>(handler: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    activeJobs += 1;
    try {
      return await handler(...args);
    } finally {
      activeJobs -= 1;
    }
  };

  // Registered before either queue is listened to, so the first run this process takes already
  // names it.
  const planConcurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 1);
  const browserTaskConcurrency = Math.max(1, Number(process.env.BROWSER_TASK_CONCURRENCY) || 2);
  // The queues it pauses when drained, filled in as the workers are created below.
  const drainable: PausableQueue[] = [];
  const runner = new RunnerAgent({
    description: { concurrency: planConcurrency, browserTaskConcurrency },
    queues: drainable,
    activeJobs: activeJobCount,
    log: (message) => logger.info(message),
  });
  logger.info(`Registered as runner ${await runner.register()}`);

  const worker = new Worker(
    TEST_EXECUTION_QUEUE_NAME,
    withJobIncidents(counted(async (job: Job, token?: string) => {
      logger.info(`Worker processing job ${job.id} of type ${job.name}`);

      if (job.name === 'execute-plan') {
        // `executionId` from the orchestrator; `testPlanRunId` from jobs queued before it.
        const { planId, userId, correlationId, updateBaselines } = job.data;
        const testPlanRunId: string = job.data.executionId ?? job.data.testPlanRunId;

        // Restore the correlation context from the original HTTP request
        // so all logs emitted during job processing share the same trace ID.
        const cid = correlationId || `worker-${testPlanRunId.slice(0, 8)}`;

        const outcome = await correlationStore.run({ correlationId: cid }, async () => {
          try {
            return await processTestPlanJob(planId, testPlanRunId, userId, { updateBaselines: updateBaselines === true });
          } catch (error: any) {
            logger.error(`Job ${job.id} failed:`, error);
            throw error; // Let BullMQ handle the failure
          }
        });
        // Its organization is at its limit of runs at once: the run stays queued and the job goes
        // back for a while, so this worker can serve somebody else's run in the meantime.
        if (outcome?.deferred) {
          await job.moveToDelayed(Date.now() + (outcome.retryInMs ?? 10_000), token);
          throw new DelayedError();
        }
      } else if (job.name === TRIGGER_SCHEDULE_JOB) {
        // Fired by a BullMQ job scheduler (SCHEDULER_BACKEND=bullmq). Load the latest
        // schedule + plan from the DB and run it via the shared execution logic.
        const { scheduleId } = job.data;
        const cid = `sched-${String(scheduleId).slice(0, 8)}`;
        await correlationStore.run({ correlationId: cid }, async () => {
          const [schedule] = await privilegedDb.select().from(testPlanSchedules).where(eq(testPlanSchedules.id, scheduleId)).limit(1);
          if (!schedule) {
            logger.warn(`Scheduled trigger for unknown/removed schedule ${scheduleId}; skipping.`);
            return;
          }
          if (!schedule.isActive) {
            logger.info(`Scheduled trigger for inactive schedule ${scheduleId}; skipping.`);
            return;
          }
          const [plan] = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, schedule.testPlanId)).limit(1);
          if (!plan) {
            logger.warn(`Scheduled trigger for schedule ${scheduleId}: test plan ${schedule.testPlanId} not found; skipping.`);
            return;
          }
          await executeScheduledPlan(schedule, plan, scheduledOccurrence(job));
        });
      }
    })),
    // How many plan runs this worker executes at once — each is a browser, so a statement about
    // the machine. One by default, as before; the per-organization limits share out whatever it is.
    { connection, concurrency: planConcurrency }
  );

  /**
   * The browser work a person is waiting for — previews, single test runs, page surveys — on a
   * queue of its own. On the plan queue it would wait behind a forty-minute nightly run, and the
   * person who pressed Preview would wait with it.
   */
  const browserTaskWorker = new Worker(
    BROWSER_TASK_QUEUE_NAME,
    withJobIncidents(counted(async (job: Job) => {
      const envelope = job.data as BrowserTaskEnvelope;
      const cid = envelope.correlationId || `task-${String(job.id).slice(0, 8)}`;
      return correlationStore.run({ correlationId: cid }, () => performBrowserTask(envelope));
    })),
    { connection, concurrency: browserTaskConcurrency },
  );
  browserTaskWorker.on('failed', (job: Job | undefined, err: Error) => {
    logger.warn(`Browser task ${job?.id} (${job?.name}) failed: ${err.message}`);
  });
  logger.info(`Worker listening to queue: ${BROWSER_TASK_QUEUE_NAME} (concurrency ${browserTaskConcurrency})`);

  worker.on('completed', (job: Job) => {
    logger.info(`Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(`Job ${job?.id} failed with error:`, err);
  });

  logger.info(`Worker started and listening to queue: ${TEST_EXECUTION_QUEUE_NAME}`);

  // ─── The runner registry ────────────────────────────────────────────────────
  // Reports in on a timer with how many jobs it has, and hears back whether to take new ones.
  // Drained, it pauses both queues without stopping the jobs in hand (see RunnerAgent).
  drainable.push(worker, browserTaskWorker);
  runner.start();

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
      await browserTaskWorker.close();
      // Offline at once, rather than after three missed heartbeats.
      await runner.stop();
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

import { DelayedError, Worker, type Job } from 'bullmq';
import { configureEgressProxy } from './platform/egress-proxy';
import { connection } from './platform/redis';
import {
  LOAD_QUEUE_NAME,
  TEST_EXECUTION_QUEUE_NAME,
  loadQueue,
  testExecutionQueue,
} from './platform/queue';
import { processShardJob, processTestPlanJob } from './execution/test-execution-service';
import { SHARD_JOB, registerShardDispatcher } from './runtime/run-shards';
import { LoadRunJobSchema, loadLimits, processLoadRunJob } from './api-tests/load-runner';
import logger, { applyLogSettings } from './platform/logger';
import { installProcessErrorHandlers } from './platform/process-errors';
import { resolveWorkerShutdownGraceMs } from './platform/config';
import { correlationStore } from './platform/middleware/correlation';
import { closeDb, privilegedDb, assertTenancyPreconditions } from './platform/db';
import { assertSchemaMigrated } from './platform/schema-state';
import { assertOrganizationKeysReadable } from './platform/organization-keys';
import {
  TRIGGER_SCHEDULE_JOB,
  executeScheduledPlan,
  scheduledOccurrence,
} from './execution/scheduler-service';
import { testPlanSchedules, testPlans } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { withJobIncidents } from './platform/observability/taps/jobs';
import { artifactStore } from './tenancy/artifact-store';
import {
  BROWSER_TASK_QUEUE_NAME,
  performBrowserTask,
  type BrowserTaskEnvelope,
} from './web/browser-tasks';
import { RunnerAgent, type PausableQueue } from './runtime/runner-registry';
import { closeConsumers } from './runtime/worker-shutdown';
import { registerCommitStatus } from './integrations/commit-status';
import { registerRunPromotion } from './execution/run-promotion';
import { installWorkerLogEmitter } from './http/websocket';
import { publicBaseUrl } from './platform/report-links';
import 'dotenv/config';
import { startTracing } from '../shared/telemetry';
import {
  applicationMetrics,
  instrumentJob,
  linuxProc,
  sampleChildProcesses,
  startMetricsServer,
} from './platform/observability/metrics';
import { Queue } from 'bullmq';
import {
  ExecutePlanJobSchema,
  ShardJobSchema,
  TriggerScheduleJobSchema,
  readJob,
} from './platform/job-payloads';

const stopTracing = startTracing('worker');
configureEgressProxy();

(async () => {
  // Read first, so a malformed value is reported by name instead of at the first SIGTERM.
  const shutdownGraceMs = resolveWorkerShutdownGraceMs();
  // Likewise the load limits: a malformed LOAD_WORKER_CONCURRENCY stops the worker here, by name.
  const loadConcurrency = loadLimits().runsPerWorker;
  // The same database checks as the web process (server/index.ts): a worker deployed alone must
  // not run against a database that does not isolate tenants or whose migrations are behind.
  await assertTenancyPreconditions();
  await assertSchemaMigrated();
  // Every secret a run needs is under an organization key: refuse to start if one of them cannot
  // be opened with the configured master keys, rather than failing each run that reaches it.
  await assertOrganizationKeysReadable();
  // The log level and retention an administrator saved in the settings.
  await applyLogSettings();
  const { initializeQuotaDefaults } = await import('./tenancy/tenant-quotas');
  await initializeQuotaDefaults();
  // A misconfigured artifact store fails here, not on the first screenshot of the first run.
  logger.info(`Artifact store: ${artifactStore().kind}`);
  // A run this worker moves reports on the commit it tested, when a pipeline started it.
  registerCommitStatus();
  registerRunPromotion();
  // A plan with several shards asks for helpers on the same queue (server/runtime/run-shards.ts). The job id
  // makes asking twice for the same share harmless; first in the queue, since the run is under way.
  registerShardDispatcher(async ({ executionId, planId, userId, shard, updateBaselines }) => {
    await testExecutionQueue.add(
      SHARD_JOB,
      { executionId, planId, userId, shard, updateBaselines },
      { jobId: `${executionId}-shard-${shard}`, priority: 1 },
    );
  });
  // Every run executes here: its log lines are stored, and relayed to the web process's sockets.
  installWorkerLogEmitter();
  // Notifications, issues and commit statuses are sent from here, and link to the report only
  // when this process knows the installation's address.
  if (!publicBaseUrl()) {
    logger.warn(
      'WEBFLOW_PUBLIC_URL is not set on this worker: notifications and filed issues will carry the report path, not a link to it.',
    );
  }

  // Jobs in hand, on both queues, for the runner heartbeat: what a drained runner is waiting for.
  let activeJobs = 0;
  const activeJobCount = () => activeJobs;
  const counted =
    <A extends unknown[], R>(handler: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
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
  applicationMetrics.capacity.set({ queue: TEST_EXECUTION_QUEUE_NAME }, planConcurrency);
  applicationMetrics.capacity.set({ queue: BROWSER_TASK_QUEUE_NAME }, browserTaskConcurrency);
  applicationMetrics.capacity.set({ queue: LOAD_QUEUE_NAME }, loadConcurrency);
  // The browsers this process starts, in total: their memory and CPU size a worker, not its own heap.
  applicationMetrics.sampleChildren(() => sampleChildProcesses(process.pid, linuxProc));
  const browserMetricsQueue =
    process.env.WFM_METRICS_ENABLED === 'true'
      ? new Queue(BROWSER_TASK_QUEUE_NAME, { connection })
      : undefined;
  const metricsListener = await startMetricsServer('worker', applicationMetrics, [
    testExecutionQueue,
    loadQueue,
    ...(browserMetricsQueue ? [browserMetricsQueue] : []),
  ]);
  applicationMetrics.active.set({ queue: TEST_EXECUTION_QUEUE_NAME }, 0);
  applicationMetrics.active.set({ queue: BROWSER_TASK_QUEUE_NAME }, 0);
  applicationMetrics.active.set({ queue: LOAD_QUEUE_NAME }, 0);
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
    withJobIncidents(
      counted((job: Job, token?: string) =>
        instrumentJob(TEST_EXECUTION_QUEUE_NAME, job, async () => {
          logger.info(`Worker processing job ${job.id} of type ${job.name}`);

          if (job.name === 'execute-plan') {
            const data = readJob(ExecutePlanJobSchema, job);
            const { planId, userId, correlationId, updateBaselines } = data;
            const testPlanRunId = (data.executionId ?? data.testPlanRunId)!;

            // Restore the correlation context from the original HTTP request
            // so all logs emitted during job processing share the same trace ID.
            const cid = correlationId || `worker-${testPlanRunId.slice(0, 8)}`;

            const outcome = await correlationStore.run({ correlationId: cid }, async () => {
              try {
                return await processTestPlanJob(planId, testPlanRunId, userId, {
                  updateBaselines: updateBaselines === true,
                });
              } catch (error) {
                logger.error(`Job ${job.id} failed:`, error);
                throw error; // Let BullMQ handle the failure
              }
            });
            // Its organization is at its limit of runs at once: the run stays queued and the job goes
            // back for a while, so this worker can serve somebody else's run in the meantime.
            if (outcome?.deferred) {
              // Marked, so that a run of the organization ending promotes it at once (server/execution/run-promotion.ts).
              if (data.deferredForQuota !== true)
                await job.updateData({ ...data, deferredForQuota: true });
              await job.moveToDelayed(Date.now() + (outcome.retryInMs ?? 10_000), token);
              throw new DelayedError();
            }
          } else if (job.name === SHARD_JOB) {
            // A share of a run another worker took: tests from its work list until none are left.
            const { executionId, planId, userId, shard, updateBaselines } = readJob(
              ShardJobSchema,
              job,
            );
            await correlationStore.run(
              { correlationId: `shard-${executionId.slice(0, 8)}-${shard}` },
              () =>
                processShardJob(planId, executionId, userId, shard, {
                  updateBaselines: updateBaselines === true,
                }),
            );
          } else if (job.name === TRIGGER_SCHEDULE_JOB) {
            // Fired by a BullMQ job scheduler (the default SCHEDULER_BACKEND). Load the latest
            // schedule + plan from the DB and run it via the shared execution logic.
            const { scheduleId } = readJob(TriggerScheduleJobSchema, job);
            const cid = `sched-${scheduleId.slice(0, 8)}`;
            await correlationStore.run({ correlationId: cid }, async () => {
              const [schedule] = await privilegedDb
                .select()
                .from(testPlanSchedules)
                .where(eq(testPlanSchedules.id, scheduleId))
                .limit(1);
              if (!schedule) {
                logger.warn(
                  `Scheduled trigger for unknown/removed schedule ${scheduleId}; skipping.`,
                );
                return;
              }
              if (!schedule.isActive) {
                logger.info(`Scheduled trigger for inactive schedule ${scheduleId}; skipping.`);
                return;
              }
              const [plan] = await privilegedDb
                .select()
                .from(testPlans)
                .where(eq(testPlans.id, schedule.testPlanId))
                .limit(1);
              if (!plan) {
                logger.warn(
                  `Scheduled trigger for schedule ${scheduleId}: test plan ${schedule.testPlanId} not found; skipping.`,
                );
                return;
              }
              await executeScheduledPlan(schedule, plan, scheduledOccurrence(job));
            });
          }
        }),
      ),
    ),
    // How many plan runs this worker executes at once — each is a browser, so a statement about
    // the machine. One by default, as before; the per-organization limits share out whatever it is.
    { connection, concurrency: planConcurrency },
  );

  /**
   * The browser work a person is waiting for — previews, single test runs, page surveys — on a
   * queue of its own. On the plan queue it would wait behind a forty-minute nightly run, and the
   * person who pressed Preview would wait with it.
   */
  const browserTaskWorker = new Worker(
    BROWSER_TASK_QUEUE_NAME,
    withJobIncidents(
      counted((job: Job) =>
        instrumentJob(BROWSER_TASK_QUEUE_NAME, job, async () => {
          const envelope = job.data as BrowserTaskEnvelope;
          const cid = envelope.correlationId || `task-${String(job.id).slice(0, 8)}`;
          return correlationStore.run({ correlationId: cid }, () => performBrowserTask(envelope));
        }),
      ),
    ),
    { connection, concurrency: browserTaskConcurrency },
  );
  browserTaskWorker.on('failed', (job: Job | undefined, err: Error) => {
    logger.warn(`Browser task ${job?.id} (${job?.name}) failed: ${err.message}`);
  });
  logger.info(
    `Worker listening to queue: ${BROWSER_TASK_QUEUE_NAME} (concurrency ${browserTaskConcurrency})`,
  );

  /**
   * Load runs (server/api-tests/load-runner.ts), on their own queue: each one sends from this process for up
   * to an hour, so LOAD_WORKER_CONCURRENCY says how many this worker takes at once, and 0 says it
   * takes none — a worker kept for plans. The run is claimed and heart-beaten in
   * processLoadRunJob; an organization at its limit gets its run back on the queue for a while.
   */
  const loadWorker =
    loadConcurrency > 0
      ? new Worker(
          LOAD_QUEUE_NAME,
          withJobIncidents(
            counted((job: Job, token?: string) =>
              instrumentJob(LOAD_QUEUE_NAME, job, async () => {
                const data = readJob(LoadRunJobSchema, job);
                const outcome = await correlationStore.run(
                  { correlationId: `load-${data.runId.slice(0, 8)}` },
                  () => processLoadRunJob(data),
                );
                if (outcome.outcome === 'skipped')
                  logger.info(`Load run ${data.runId} not executed: ${outcome.reason}`);
                if (outcome.outcome === 'deferred') {
                  await job.moveToDelayed(Date.now() + outcome.retryInMs, token);
                  throw new DelayedError();
                }
              }),
            ),
          ),
          { connection, concurrency: loadConcurrency },
        )
      : null;
  if (loadWorker) {
    loadWorker.on('failed', (job: Job | undefined, err: Error) => {
      logger.error(`Load run job ${job?.id} failed with error:`, err);
    });
    logger.info(`Worker listening to queue: ${LOAD_QUEUE_NAME} (concurrency ${loadConcurrency})`);
  } else {
    logger.info(
      `Worker takes no load runs (LOAD_WORKER_CONCURRENCY=0): ${LOAD_QUEUE_NAME} not listened to`,
    );
  }

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
  drainable.push(worker, browserTaskWorker, ...(loadWorker ? [loadWorker] : []));
  runner.start();

  // ─── Graceful shutdown ──────────────────────────────────────────────────────
  // worker.close() waits for the in-flight job to finish before resolving, so a
  // redeploy doesn't kill a running test execution mid-flight — for as long as
  // WORKER_SHUTDOWN_GRACE_MS allows (server/platform/config.ts), since a run can last hours.
  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(
      `Worker received ${signal}, shutting down gracefully (up to ${shutdownGraceMs} ms)...`,
    );
    const forceTimer = setTimeout(() => {
      logger.error(
        `Worker shutdown exceeded WORKER_SHUTDOWN_GRACE_MS (${shutdownGraceMs} ms); forcing exit.`,
      );
      process.exit(1);
    }, shutdownGraceMs);
    forceTimer.unref();
    try {
      // All three stop taking jobs at once, then wait for the ones in hand (worker-shutdown.ts).
      await closeConsumers([worker, browserTaskWorker, ...(loadWorker ? [loadWorker] : [])]);
      // Offline at once, rather than after three missed heartbeats.
      await runner.stop();
      await metricsListener?.close();
      await browserMetricsQueue?.close();
      await stopTracing();
      await connection.quit();
      await closeDb();
      logger.info('Worker graceful shutdown complete.');
      process.exit(exitCode);
    } catch (err) {
      logger.error('Error during worker graceful shutdown', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  // What nothing caught: logged with its stack, and an exception takes the same way out as
  // SIGTERM, ending non-zero (server/platform/process-errors.ts).
  installProcessErrorHandlers(logger, shutdown);
})();

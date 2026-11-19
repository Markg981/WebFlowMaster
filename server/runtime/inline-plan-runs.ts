import { DelayedError, Worker, type Job } from 'bullmq';
import { connection } from '../platform/redis';
import { TEST_EXECUTION_QUEUE_NAME } from '../platform/queue';
import logger from '../platform/logger';
import { correlationStore } from '../platform/middleware/correlation';

/**
 * Plan runs inside the web process, for a single-process local setup.
 *
 * Plan runs are queued for the worker (server/worker.ts). On the local PGlite database (a folder
 * that one process holds) no second process can open it, so the worker cannot start next to the
 * web server and a queued run never ran. RUNS_INLINE=true starts a consumer of the same queue
 * here, like BROWSER_TASKS=inline does for browser tasks. Off by default: a deployment keeps its
 * separate workers, and the web process does not take runs unless asked.
 */
export function inlinePlanRunsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RUNS_INLINE === 'true';
}

export interface InlineJobDeps {
  processPlan: (
    planId: string,
    runId: string,
    userId: number | null,
    options: { updateBaselines: boolean },
  ) => Promise<{ deferred?: boolean; retryInMs?: number } | void | undefined>;
}

/** The `execute-plan` branch of server/worker.ts. Other job kinds need the worker process. */
export async function processInlineJob(
  job: Pick<Job, 'id' | 'name' | 'data' | 'updateData' | 'moveToDelayed'>,
  token: string | undefined,
  deps: InlineJobDeps,
): Promise<void> {
  if (job.name !== 'execute-plan') {
    throw new Error(
      `Job ${job.id} of type ${job.name} needs the worker process (npm run dev:worker); RUNS_INLINE=true only runs plans started by hand or by a pipeline.`,
    );
  }
  const data = job.data as {
    planId: string;
    userId: number | null;
    correlationId?: string;
    executionId?: string;
    testPlanRunId?: string;
    updateBaselines?: boolean;
    deferredForQuota?: boolean;
  };
  const runId = (data.executionId ?? data.testPlanRunId)!;
  const cid = data.correlationId || `inline-${runId.slice(0, 8)}`;
  const outcome = await correlationStore.run({ correlationId: cid }, async () => {
    try {
      return await deps.processPlan(data.planId, runId, data.userId, {
        updateBaselines: data.updateBaselines === true,
      });
    } catch (error) {
      logger.error(`Job ${job.id} failed:`, error);
      throw error;
    }
  });
  // The organization is at its limit of runs at once: the run stays queued, the job goes back.
  if (outcome && outcome.deferred) {
    if (data.deferredForQuota !== true) await job.updateData({ ...data, deferredForQuota: true });
    await job.moveToDelayed(Date.now() + (outcome.retryInMs ?? 10_000), token);
    throw new DelayedError();
  }
}

/**
 * Starts the consumer; returns the function that stops it (waits for the run in hand).
 * The plan processor comes from the caller: execution sits above runtime in
 * scripts/server-domains.mjs, so this module must not import it.
 */
export function startInlinePlanWorker(
  loadProcessPlan: () => Promise<InlineJobDeps['processPlan']>,
): () => Promise<void> {
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 1);
  const worker = new Worker(
    TEST_EXECUTION_QUEUE_NAME,
    async (job: Job, token?: string) => {
      const processPlan = await loadProcessPlan();
      logger.info(`Inline worker processing job ${job.id} of type ${job.name}`);
      await processInlineJob(job, token, { processPlan });
    },
    { connection, concurrency },
  );
  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(`Inline job ${job?.id} failed with error:`, err);
  });
  logger.info(
    `Plan runs execute in this process (RUNS_INLINE=true), queue ${TEST_EXECUTION_QUEUE_NAME}, concurrency ${concurrency}`,
  );
  return async () => {
    await worker.close();
  };
}

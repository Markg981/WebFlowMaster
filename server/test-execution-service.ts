/**
 * Starting a plan run, and the queue's entry points into one.
 *
 * What a run does, phase by phase, is server/plan-run/pipeline.ts; this file establishes the
 * tenant context a queue job runs in and hands it over.
 */
import type { TestPlanExecution, ExecutionTrigger } from '@shared/schema';
import logger from './logger';
import { privilegedDb } from './db';
import { runWithTenant } from './middleware/tenancy';
import { testPlanExecutions as testPlanExecutionsTable } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { quotaErrorBody, quotaErrorStatus } from './tenancy/tenant-quotas';
import { withExecutionUsage } from './tenancy/execution-usage';
import { ExecutionEnqueueError, executionOrchestrator } from './execution-orchestrator';
import { runPlanJob } from './plan-run/pipeline';
import type { PlanJobResult } from './plan-run/context';

export { runTest, type IndividualTestRunResult, type RunTestOptions } from './run-test';
export { RUN_DEFERRAL_MS } from './plan-run/pipeline';
export { RETRY_DELAY_MS } from './plan-run/after-run';

/**
 * What a caller can say about a run beyond which plan it is.
 *
 * Every run, whoever asks for it, is created by server/execution-orchestrator.ts; this is the
 * shape the routes and webhooks have always called, over it.
 */
export interface RunTestPlanOptions {
  environmentId?: number | null;
  /** Accept this run's screenshots as the new visual baselines. */
  updateBaselines?: boolean;
  /** Asking again with the same key returns the first run instead of starting another. */
  idempotencyKey?: string | null;
  /** Who asked for it, when that is not a person pressing Run. */
  trigger?: ExecutionTrigger;
}

export async function runTestPlan(
  planId: string,
  userId: number,
  environmentIdOrOptions?: number | RunTestPlanOptions,
): Promise<TestPlanExecution | { error: string; status?: number; testPlanRunId?: string }> {
  const options: RunTestPlanOptions =
    typeof environmentIdOrOptions === 'number'
      ? { environmentId: environmentIdOrOptions }
      : (environmentIdOrOptions ?? {});

  try {
    const execution = await executionOrchestrator.enqueue({
      planId,
      requestedByUserId: userId,
      trigger: options.trigger ?? 'manual',
      environmentId: options.environmentId ?? null,
      updateBaselines: options.updateBaselines,
      idempotencyKey: options.idempotencyKey,
    });
    logger.info({
      message: 'Test plan execution enqueued',
      planId,
      testPlanRunId: execution.id,
      userId,
    });
    return execution;
  } catch (error: any) {
    if (error instanceof ExecutionEnqueueError) {
      logger.warn({
        message: 'Test plan execution not enqueued',
        planId,
        code: error.code,
        error: error.message,
      });
      return { error: error.message, status: error.status, testPlanRunId: error.executionId };
    }
    const quota = quotaErrorBody(error);
    if (quota) return { error: String(quota.error), status: quotaErrorStatus(error) };
    // The detail stays in the log: a driver's or Redis's message names hosts, ports and
    // tables, and the route forwards this string to whoever pressed Run.
    logger.error({
      message: 'Failed to enqueue test plan run',
      planId,
      error: error.message,
      stack: error.stack,
    });
    return { error: 'The test plan run could not be started.', status: 500 };
  }
}

/** The one privileged read of a job: which organization its execution belongs to. Shared by both job kinds. */
async function organizationOfExecution(
  executionId: string,
): Promise<{ organizationId: number } | undefined> {
  const [execution] = await privilegedDb
    .select({ organizationId: testPlanExecutionsTable.organizationId })
    .from(testPlanExecutionsTable)
    .where(eq(testPlanExecutionsTable.id, executionId))
    .limit(1);
  return execution;
}

/**
 * Establishes the tenant context for a queue job, then runs it.
 *
 * A BullMQ worker has no Express request, so `tenancyMiddleware` never ran and there is no
 * ambient organization to inherit. Exactly one lookup therefore has to run privileged — the
 * one that answers "which organization is this job for?" — and everything after it runs under
 * that organization's RLS binding. This function is that boundary, and it is the only place in
 * the execution path that reaches an org-scoped table outside the tenant context.
 *
 * Deliberately NOT one long transaction around the whole job: a plan execution drives a real
 * browser for minutes, and holding a pooled connection open for its duration would starve the
 * pool. `runWithTenant` establishes the ambient organization; each query inside opens its own
 * short `withTenantTransaction`.
 */
export async function processTestPlanJob(
  planId: string,
  testPlanRunId: string,
  userId: number | null,
  jobOptions: { updateBaselines?: boolean } = {},
): Promise<any> {
  const execution = await organizationOfExecution(testPlanRunId);

  if (!execution) {
    logger.error({ message: 'Test plan execution record not found', testPlanRunId });
    return { error: `Test plan execution ${testPlanRunId} not found.`, status: 500, testPlanRunId };
  }

  return runWithTenant(execution.organizationId, () =>
    runTestPlanJobInTenant(planId, testPlanRunId, userId, jobOptions),
  );
}

/**
 * A helper's share of a run on several workers (server/runtime/run-shards.ts): the job the coordinator
 * queued as `execute-shard`. Same boundary as processTestPlanJob: one privileged lookup of the
 * organization, everything else under it.
 */
export async function processShardJob(
  planId: string,
  executionId: string,
  userId: number | null,
  shard: number,
  jobOptions: { updateBaselines?: boolean } = {},
): Promise<any> {
  const execution = await organizationOfExecution(executionId);
  if (!execution)
    return { skipped: true, reason: 'Execution not found.', testPlanRunId: executionId };
  return runWithTenant(execution.organizationId, () =>
    withExecutionUsage(
      'shard',
      () => runTestPlanJobInTenant(planId, executionId, userId, jobOptions, { shard }),
      `${executionId}-shard-${shard}`,
    ),
  );
}

async function runTestPlanJobInTenant(
  planId: string,
  executionId: string,
  userId: number | null,
  options: { updateBaselines?: boolean } = {},
  /** Set for a helper sharing a run another worker took (server/runtime/run-shards.ts). */
  helper?: { shard: number },
): Promise<PlanJobResult> {
  return runPlanJob({ planId, executionId, userId, options, helper });
}

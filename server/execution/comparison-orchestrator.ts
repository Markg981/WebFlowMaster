import { and, eq, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  comparisonRuns,
  environments,
  organizationMemberships,
  testPlanExecutions,
  testPlans,
  type ComparisonRun,
  type TestPlanExecution,
} from '@shared/schema';
import {
  ComparisonPolicySchema,
  isTerminalComparisonStatus,
  type ComparisonSummary,
  type ComparisonVerdict,
  type CreateComparisonInput,
} from '@shared/comparison';
import logger from '../platform/logger';
import { withTenantTransaction, type TenantTx } from '../platform/middleware/tenancy';
import { executionOrchestrator } from './execution-orchestrator';
import { isTerminalExecutionStatus, requestCancellation } from './execution-state';
import {
  reclaimStaleComparison,
  transitionComparison,
  updateRunningComparison,
} from './comparison-state';
import { notifyComparisonFinished } from '../integrations/comparison-notifications';

/**
 * The life of a comparison: one plan run on a baseline environment, replayed with the same frozen
 * inputs on a candidate environment, then compared (docs/superpowers/specs/2026-11-12-run-comparison-design.md).
 *
 * Nothing here waits for a run. `advance` looks at where the comparison and its runs are and takes
 * the one next step: start the baseline, start the candidate, or compare. The finalizer
 * (comparison-finalizer.ts) calls it when a side ends, and the sweep calls it for whatever the
 * finalizer missed, so a process that stops between two steps leaves a comparison the next call
 * picks up. Every step is safe to take twice: runs are created with idempotency keys and the
 * comparison moves only through conditional updates.
 */

export type ComparisonFailureCode =
  'plan_not_found' | 'requester_not_in_organization' | 'environment_not_found';

/** Why a comparison could not be created, with the HTTP status that says so. */
export class ComparisonError extends Error {
  constructor(
    readonly code: ComparisonFailureCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ComparisonError';
  }
}

/**
 * Compares the two ended runs and writes the per-test results in `tx`, the transaction that also
 * completes the comparison: a comparison is either completed with all its results or has none.
 */
export type ComparisonEngine = (
  tx: TenantTx,
  comparison: ComparisonRun,
) => Promise<{ verdict: ComparisonVerdict; summary: ComparisonSummary }>;

/** The part of the execution orchestrator a comparison uses; tests pass their own. */
type ExecutionStarter = Pick<typeof executionOrchestrator, 'enqueue' | 'replay'>;

export interface ComparisonOrchestratorOptions {
  executions?: ExecutionStarter;
  engine: ComparisonEngine;
  /** How long a `comparing` claim lasts before another process may take it over. */
  comparingLeaseMs?: number;
  /**
   * Announces a comparison that ended completed or in error, once: called only by the call whose
   * transition moved it. Must not throw; the default never does.
   */
  notify?: (comparison: ComparisonRun) => Promise<void>;
}

export interface CreateComparisonRequest {
  planId: string;
  requestedByUserId: number;
  input: CreateComparisonInput;
  idempotencyKey?: string | null;
  /** Runs in the transaction that creates the comparison, only when this call created it. */
  onCreated?: (tx: TenantTx, comparison: ComparisonRun) => Promise<void>;
}

export type ComparisonCancellation =
  | { outcome: 'cancelled'; comparison: ComparisonRun }
  | { outcome: 'already_ended'; status: string }
  | { outcome: 'not_found' };

/** A baseline that ended this way lets the candidate start, in sequential mode. */
const BASELINE_DONE = new Set(['completed', 'failed', 'timed_out']);

const MAX_FAILURE_MESSAGE = 2000;

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : 500;
}

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error).slice(0, MAX_FAILURE_MESSAGE);
}

function isUniqueViolation(error: unknown): boolean {
  const record = error as { code?: string; message?: string } | null;
  return (
    record?.code === '23505' ||
    String(record?.message ?? '')
      .toLowerCase()
      .includes('unique')
  );
}

export function createComparisonOrchestrator({
  executions = executionOrchestrator,
  engine,
  comparingLeaseMs = 10 * 60_000,
  notify = notifyComparisonFinished,
}: ComparisonOrchestratorOptions) {
  /** After the transaction that ended it, so a notification never describes a rolled-back end. */
  async function announce(ended: ComparisonRun | null): Promise<ComparisonRun | null> {
    if (!ended) return null;
    try {
      await notify(ended);
    } catch (error) {
      logger.warn({
        message: 'A comparison notification failed',
        comparisonId: ended.id,
        error: messageOf(error),
      });
    }
    return ended;
  }

  const read = (id: string) =>
    withTenantTransaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(comparisonRuns)
        .where(eq(comparisonRuns.id, id))
        .limit(1);
      return row ?? null;
    });

  const readExecution = (id: string) =>
    withTenantTransaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(testPlanExecutions)
        .where(eq(testPlanExecutions.id, id))
        .limit(1);
      return row ?? null;
    });

  const end = (
    id: string,
    to: 'error' | 'cancelled',
    failureCode: string | null = null,
    failureMessage: string | null = null,
  ) =>
    withTenantTransaction((tx) =>
      transitionComparison(tx, id, to, {
        failureCode,
        failureMessage: failureMessage?.slice(0, MAX_FAILURE_MESSAGE) ?? null,
      }),
    ).then((ended) => (to === 'error' ? announce(ended) : ended));

  /** Stops a run the comparison no longer wants. Its failure is logged, not raised. */
  async function stopRun(executionId: string, reason: string) {
    try {
      await requestCancellation(executionId, reason);
    } catch (error) {
      logger.warn({
        message: 'Could not cancel a run of a comparison',
        executionId,
        error: messageOf(error),
      });
    }
  }

  /**
   * A run was started but recording it on the comparison found nothing to record it on: when the
   * comparison has meanwhile ended without it, nobody is waiting for that run.
   */
  async function stopIfOrphaned(id: string, executionId: string) {
    const now = await read(id);
    if (!now || now.status === 'cancelled' || now.status === 'error')
      await stopRun(executionId, 'The comparison this run belonged to has ended.');
  }

  async function startBaseline(comparison: ComparisonRun, rethrowRefusal: boolean) {
    if (comparison.baselineEnvironmentId == null)
      return end(
        comparison.id,
        'error',
        'environment_missing',
        'The baseline environment was deleted.',
      );
    if (comparison.requestedByUserId == null)
      return end(comparison.id, 'error', 'requester_missing', 'The requester no longer exists.');
    let baseline: TestPlanExecution;
    try {
      baseline = await executions.enqueue({
        planId: comparison.testPlanId,
        requestedByUserId: comparison.requestedByUserId,
        trigger: 'manual',
        environmentId: comparison.baselineEnvironmentId,
        idempotencyKey: `cmp-${comparison.id}-baseline`,
        comparison: { id: comparison.id, role: 'baseline' },
      });
    } catch (error) {
      const status = statusOf(error);
      // A full queue or a server fault: the comparison waits for the next call.
      if (rethrowRefusal || status === 429 || status >= 500) throw error;
      return end(comparison.id, 'error', 'baseline_refused', messageOf(error));
    }
    const moved = await withTenantTransaction((tx) =>
      transitionComparison(tx, comparison.id, 'running', { baselineExecutionId: baseline.id }),
    );
    if (!moved) {
      await stopIfOrphaned(comparison.id, baseline.id);
      return read(comparison.id);
    }
    return moved;
  }

  async function startCandidate(comparison: ComparisonRun, baseline: TestPlanExecution) {
    if (comparison.candidateEnvironmentId == null)
      return end(
        comparison.id,
        'error',
        'environment_missing',
        'The candidate environment was deleted.',
      );
    if (comparison.requestedByUserId == null)
      return end(comparison.id, 'error', 'requester_missing', 'The requester no longer exists.');
    let candidate: TestPlanExecution;
    try {
      candidate = await executions.replay(
        baseline.id,
        comparison.requestedByUserId,
        `cmp-${comparison.id}-candidate`,
        {
          environmentId: comparison.candidateEnvironmentId,
          comparison: { id: comparison.id, role: 'candidate' },
        },
      );
    } catch (error) {
      const status = statusOf(error);
      if (status === 429)
        // The organization's queue is full: the sweep tries again, and the page says why it waits.
        return withTenantTransaction((tx) =>
          updateRunningComparison(tx, comparison.id, {
            failureCode: 'candidate_deferred',
            failureMessage: messageOf(error),
          }),
        );
      if (status < 500) return end(comparison.id, 'error', 'candidate_refused', messageOf(error));
      throw error;
    }
    const recorded = await withTenantTransaction((tx) =>
      updateRunningComparison(tx, comparison.id, {
        candidateExecutionId: candidate.id,
        failureCode: null,
        failureMessage: null,
      }),
    );
    if (!recorded) {
      await stopIfOrphaned(comparison.id, candidate.id);
      return read(comparison.id);
    }
    return recorded;
  }

  /** Runs the engine and completes, all in one transaction; a failure ends it in error. */
  async function compute(comparison: ComparisonRun) {
    try {
      const completed = await withTenantTransaction(async (tx) => {
        const { verdict, summary } = await engine(tx, comparison);
        return transitionComparison(tx, comparison.id, 'completed', {
          verdict,
          summary,
          failureCode: null,
          failureMessage: null,
        });
      });
      return await announce(completed);
    } catch (error) {
      logger.error({
        message: 'A comparison could not be computed',
        comparisonId: comparison.id,
        error: messageOf(error),
      });
      return end(comparison.id, 'error', 'compare_failed', messageOf(error));
    }
  }

  async function advanceRunning(comparison: ComparisonRun) {
    if (!comparison.baselineExecutionId)
      return end(comparison.id, 'error', 'baseline_missing', 'The baseline run was deleted.');
    const baseline = await readExecution(comparison.baselineExecutionId);
    if (!baseline)
      return end(comparison.id, 'error', 'baseline_missing', 'The baseline run was deleted.');

    if (!comparison.candidateExecutionId) {
      if (baseline.status === 'cancelled') return end(comparison.id, 'cancelled');
      if (baseline.status === 'error')
        return end(
          comparison.id,
          'error',
          'baseline_error',
          baseline.failureMessage ?? 'The baseline run ended in error.',
        );
      if (comparison.mode === 'parallel' || BASELINE_DONE.has(baseline.status))
        return startCandidate(comparison, baseline);
      return comparison; // Sequential: the candidate waits for the baseline to end.
    }

    const candidate = await readExecution(comparison.candidateExecutionId);
    if (!candidate)
      return end(comparison.id, 'error', 'candidate_missing', 'The candidate run was deleted.');
    if (!isTerminalExecutionStatus(baseline.status) || !isTerminalExecutionStatus(candidate.status))
      return comparison;
    if (baseline.status === 'cancelled' || candidate.status === 'cancelled')
      return end(comparison.id, 'cancelled');

    // Both have ended: whoever moves it to `comparing` is the one that computes it.
    const claimed = await withTenantTransaction((tx) =>
      transitionComparison(tx, comparison.id, 'comparing'),
    );
    return claimed ? compute(claimed) : read(comparison.id);
  }

  /**
   * Takes the next step of a comparison, in the ambient organization's context. Returns the
   * comparison as it now is, or null when it is not in this organization.
   *
   * `rethrowRefusal`: a baseline the execution orchestrator refuses throws instead of ending the
   * comparison in error — for `create`, which answers the request with that refusal.
   */
  async function advance(
    id: string,
    { rethrowRefusal = false }: { rethrowRefusal?: boolean } = {},
  ): Promise<ComparisonRun | null> {
    const comparison = await read(id);
    if (!comparison || isTerminalComparisonStatus(comparison.status)) return comparison;
    switch (comparison.status) {
      case 'queued': {
        const started = await startBaseline(comparison, rethrowRefusal);
        // In parallel mode the candidate starts right behind the baseline.
        return started?.status === 'running' && started.mode === 'parallel'
          ? advanceRunning(started)
          : started;
      }
      case 'running':
        return advanceRunning(comparison);
      case 'comparing': {
        const staleBefore = new Date(Date.now() - comparingLeaseMs);
        const reclaimed = await withTenantTransaction((tx) =>
          reclaimStaleComparison(tx, id, staleBefore),
        );
        return reclaimed ? compute(reclaimed) : comparison;
      }
      default:
        return comparison;
    }
  }

  /**
   * Creates a comparison of a plan and starts its baseline, under the requester's own visibility.
   * The same idempotency key returns the comparison it first created.
   */
  async function create({
    planId,
    requestedByUserId,
    input,
    idempotencyKey,
    onCreated,
  }: CreateComparisonRequest): Promise<{ comparison: ComparisonRun; created: boolean }> {
    const key = idempotencyKey?.trim() || null;
    const findByKey = () =>
      key
        ? withTenantTransaction(async (tx) => {
            const [row] = await tx
              .select()
              .from(comparisonRuns)
              .where(eq(comparisonRuns.idempotencyKey, key))
              .limit(1);
            return row ?? null;
          })
        : Promise.resolve(null);

    let outcome: { comparison: ComparisonRun; created: boolean };
    try {
      outcome = await withTenantTransaction(async (tx) => {
        const [plan] = await tx
          .select({ id: testPlans.id, organizationId: testPlans.organizationId })
          .from(testPlans)
          .where(eq(testPlans.id, planId))
          .limit(1);
        if (!plan) throw new ComparisonError('plan_not_found', 'Test plan not found', 404);
        const [member] = await tx
          .select({ id: organizationMemberships.userId })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.userId, requestedByUserId),
              eq(organizationMemberships.organizationId, plan.organizationId),
            ),
          )
          .limit(1);
        if (!member)
          throw new ComparisonError(
            'requester_not_in_organization',
            'The requester is not a member of this organization',
            403,
          );
        if (key) {
          const [existing] = await tx
            .select()
            .from(comparisonRuns)
            .where(eq(comparisonRuns.idempotencyKey, key))
            .limit(1);
          if (existing) return { comparison: existing, created: false };
        }
        const environmentName = async (environmentId: number) => {
          // Under RLS: another organization's environment is not found.
          const [row] = await tx
            .select({ name: environments.name })
            .from(environments)
            .where(eq(environments.id, environmentId))
            .limit(1);
          if (!row)
            throw new ComparisonError('environment_not_found', 'Environment not found', 404);
          return row.name;
        };
        const baselineEnvironmentName = await environmentName(input.baselineEnvironmentId);
        const candidateEnvironmentName = await environmentName(input.candidateEnvironmentId);
        const [comparison] = await tx
          .insert(comparisonRuns)
          .values({
            id: uuidv4(),
            organizationId: plan.organizationId,
            testPlanId: plan.id,
            name: input.name || null,
            baselineEnvironmentId: input.baselineEnvironmentId,
            candidateEnvironmentId: input.candidateEnvironmentId,
            baselineEnvironmentName,
            candidateEnvironmentName,
            mode: input.mode,
            policy: ComparisonPolicySchema.parse(input.policy ?? {}),
            status: 'queued',
            idempotencyKey: key,
            requestedByUserId,
          })
          .returning();
        await onCreated?.(tx, comparison);
        return { comparison, created: true };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await findByKey();
        if (existing) return { comparison: existing, created: false };
      }
      throw error;
    }

    try {
      const advanced = await advance(outcome.comparison.id, { rethrowRefusal: true });
      return { comparison: advanced ?? outcome.comparison, created: outcome.created };
    } catch (error) {
      if (statusOf(error) < 500) {
        // Refused before anything ran (a full queue, a suspended subscription): the comparison
        // never started, and the request says why. A fault leaves it queued for the sweep.
        await withTenantTransaction(async (tx) => {
          await tx
            .delete(comparisonRuns)
            .where(
              and(
                eq(comparisonRuns.id, outcome.comparison.id),
                eq(comparisonRuns.status, 'queued'),
                isNull(comparisonRuns.baselineExecutionId),
              ),
            );
        });
      }
      throw error;
    }
  }

  /** Stops a comparison and both its runs. */
  async function cancel(
    id: string,
    reason: string,
    onCancelled?: (tx: TenantTx, comparison: ComparisonRun) => Promise<void>,
  ): Promise<ComparisonCancellation> {
    const result = await withTenantTransaction(async (tx) => {
      const moved = await transitionComparison(tx, id, 'cancelled');
      if (moved) {
        await onCancelled?.(tx, moved);
        return { outcome: 'cancelled' as const, comparison: moved };
      }
      const [row] = await tx
        .select({ status: comparisonRuns.status })
        .from(comparisonRuns)
        .where(eq(comparisonRuns.id, id))
        .limit(1);
      return row
        ? { outcome: 'already_ended' as const, status: row.status }
        : { outcome: 'not_found' as const };
    });
    if (result.outcome === 'cancelled') {
      for (const runId of [
        result.comparison.baselineExecutionId,
        result.comparison.candidateExecutionId,
      ]) {
        if (runId) await stopRun(runId, reason);
      }
    }
    return result;
  }

  return { create, advance, cancel };
}

export type ComparisonOrchestrator = ReturnType<typeof createComparisonOrchestrator>;

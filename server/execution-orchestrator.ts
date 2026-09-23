import { and, asc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  environments,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  users,
  type ExecutionTrigger,
  type TestPlanExecution,
} from '@shared/schema';
import { privilegedDb } from './db';
import { getCorrelationId } from './middleware/correlation';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { transitionExecution } from './execution-state';
import { buildExecutionSnapshot, type SnapshotTestReference } from './execution-snapshot';
import { testExecutionQueue } from './queue';

/**
 * The one place a run comes into existence.
 *
 * It does three things, in order, and each one is there because of a way runs went wrong:
 *
 * 1. It writes down everything the run will use — see server/execution-snapshot.ts — so a plan
 *    edited while the run waits cannot change what it does.
 * 2. It honours an idempotency key: asking twice with the same key returns the first run. A
 *    pipeline step that retried its HTTP call, or a scheduler replica that fired the same minute
 *    as another, used to produce two runs of the same thing.
 * 3. It submits exactly one job, whose id is the run's id. BullMQ refuses a second job with an id
 *    it already holds, so even a duplicate that got past the key cannot run twice — and the
 *    worker's own guard (server/execution-state.ts) is the third layer under that.
 *
 * A submission that fails leaves the run in `error` with a reason, not `queued` forever with no
 * worker ever coming for it.
 */

export interface ExecutionQueuePort {
  add(name: string, data: Record<string, unknown>, options: { jobId: string }): Promise<unknown>;
}

export interface EnqueueExecutionInput {
  planId: string;
  requestedByUserId: number;
  trigger: ExecutionTrigger;
  environmentId?: number | null;
  /** Browsers named for this run, over the plan's own machine configuration. */
  browsers?: unknown;
  updateBaselines?: boolean;
  idempotencyKey?: string | null;
  scheduleId?: string | null;
}

export type EnqueueFailureCode =
  | 'plan_not_found'
  | 'requester_not_in_organization'
  | 'environment_not_found'
  | 'queue_submission_failed';

/** Why a run could not be created, with the HTTP status that says so. */
export class ExecutionEnqueueError extends Error {
  constructor(
    readonly code: EnqueueFailureCode,
    message: string,
    readonly status: number,
    readonly executionId?: string,
  ) {
    super(message);
    this.name = 'ExecutionEnqueueError';
  }
}

/** The failure code a run is left with when its job never reached the queue. */
export const QUEUE_SUBMISSION_FAILED = 'queue_submission_failed';

function isUniqueViolation(error: unknown): boolean {
  const record = error as { code?: string; message?: string } | null;
  return record?.code === '23505' || String(record?.message ?? '').toLowerCase().includes('unique');
}

/**
 * Takes back a run whose job never reached the queue, so the same request can try again.
 *
 * The one move out of a terminal state this system allows, and deliberately not one the state
 * machine offers: no worker has ever seen this run — the queue refused it — so there is no
 * result to protect and nothing that could arrive late. Without it, a caller that retries with
 * the same key after a Redis blip gets the failed run back forever, which turns the key that was
 * meant to make retrying safe into the thing that makes it impossible.
 */
async function reclaimUnsubmittedRun(executionId: string): Promise<TestPlanExecution | null> {
  const [reclaimed] = await withTenantTransaction((tx) =>
    tx
      .update(testPlanExecutions)
      .set({ status: 'queued', queuedAt: new Date(), completedAt: null, failureCode: null, failureMessage: null })
      .where(and(
        eq(testPlanExecutions.id, executionId),
        eq(testPlanExecutions.status, 'error'),
        eq(testPlanExecutions.failureCode, QUEUE_SUBMISSION_FAILED),
      ))
      .returning(),
  );
  return reclaimed ?? null;
}

export function createExecutionOrchestrator(queue: ExecutionQueuePort) {
  async function submit(execution: TestPlanExecution, input: EnqueueExecutionInput): Promise<TestPlanExecution> {
    try {
      await queue.add(
        'execute-plan',
        {
          executionId: execution.id,
          // The names the worker has always read, so a worker from before this keeps working
          // through a rolling deploy. The row, not these, is what the worker trusts.
          testPlanRunId: execution.id,
          planId: execution.testPlanId,
          userId: input.requestedByUserId,
          updateBaselines: input.updateBaselines === true,
          correlationId: getCorrelationId() ?? `job-${execution.id.slice(0, 8)}`,
        },
        { jobId: execution.id },
      );
      return execution;
    } catch (error: any) {
      await transitionExecution(execution.id, 'error', {
        failureCode: QUEUE_SUBMISSION_FAILED,
        // The queue's own words stay in the log; this is what a person reading the run sees.
        failureMessage: 'The run could not be handed to a worker. Asking again with the same idempotency key will retry it.',
      });
      throw new ExecutionEnqueueError(
        QUEUE_SUBMISSION_FAILED,
        `The run could not be queued: ${error?.message ?? 'the queue refused it'}`,
        503,
        execution.id,
      );
    }
  }

  async function enqueue(input: EnqueueExecutionInput): Promise<TestPlanExecution> {
    // The tenant-context boundary: the plan is what says which organization this run is for,
    // so this one read cannot happen inside that organization's context. Everything after it
    // does.
    const [bootstrap] = await privilegedDb
      .select({ organizationId: testPlans.organizationId })
      .from(testPlans)
      .where(eq(testPlans.id, input.planId))
      .limit(1);
    if (!bootstrap) throw new ExecutionEnqueueError('plan_not_found', 'Test plan not found', 404);

    const organizationId = bootstrap.organizationId;
    const key = input.idempotencyKey?.trim() || null;

    return runWithTenant(organizationId, async () => {
      const findByKey = async () => {
        if (!key) return null;
        const [existing] = await withTenantTransaction((tx) =>
          tx.select().from(testPlanExecutions).where(eq(testPlanExecutions.idempotencyKey, key)).limit(1),
        );
        return existing ?? null;
      };

      let outcome: { execution: TestPlanExecution; created: boolean };
      try {
        outcome = await withTenantTransaction(async (tx) => {
          // users is not org-scoped by policy, so the organization is named explicitly: a
          // requester from another tenant would otherwise be accepted and recorded as the
          // person who asked for this run.
          const [requester] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, input.requestedByUserId), eq(users.organizationId, organizationId)))
            .limit(1);
          if (!requester) {
            throw new ExecutionEnqueueError('requester_not_in_organization', 'The requester is not a member of this organization', 403);
          }

          if (key) {
            const [existing] = await tx
              .select()
              .from(testPlanExecutions)
              .where(eq(testPlanExecutions.idempotencyKey, key))
              .limit(1);
            if (existing) return { execution: existing, created: false };
          }

          const [plan] = await tx.select().from(testPlans).where(eq(testPlans.id, input.planId)).limit(1);
          if (!plan) throw new ExecutionEnqueueError('plan_not_found', 'Test plan not found', 404);

          if (input.environmentId != null) {
            // Under RLS: another organization's environment is not found, not borrowed.
            const [environment] = await tx
              .select({ id: environments.id })
              .from(environments)
              .where(eq(environments.id, input.environmentId))
              .limit(1);
            if (!environment) throw new ExecutionEnqueueError('environment_not_found', 'Environment not found', 404);
          }

          const selected = await tx
            .select({
              testType: testPlanSelectedTests.testType,
              testId: testPlanSelectedTests.testId,
              apiTestId: testPlanSelectedTests.apiTestId,
            })
            .from(testPlanSelectedTests)
            .where(eq(testPlanSelectedTests.testPlanId, plan.id))
            .orderBy(asc(testPlanSelectedTests.id));

          const snapshot = buildExecutionSnapshot(plan, selected as SnapshotTestReference[], {
            environmentId: input.environmentId ?? null,
            browsers: input.browsers,
            updateBaselines: input.updateBaselines,
          });

          const [inserted] = await tx
            .insert(testPlanExecutions)
            .values({
              id: uuidv4(),
              organizationId,
              testPlanId: plan.id,
              scheduleId: input.scheduleId ?? null,
              requestedByUserId: input.requestedByUserId,
              status: 'queued',
              triggeredBy: input.trigger,
              // Kept on their own columns as well, because the reports list reads them there.
              environment: input.environmentId != null ? String(input.environmentId) : null,
              browsers: input.browsers ?? null,
              configurationSnapshot: snapshot,
              idempotencyKey: key,
            })
            .returning();
          return { execution: inserted, created: true };
        });
      } catch (error) {
        // Two requests with the same key at the same instant: the index lets one in, and the
        // other reads back the run that won.
        if (key && isUniqueViolation(error)) {
          const winner = await findByKey();
          if (winner) return winner;
        }
        throw error;
      }

      if (outcome.created) return submit(outcome.execution, input);

      if (outcome.execution.status === 'error' && outcome.execution.failureCode === QUEUE_SUBMISSION_FAILED) {
        const reclaimed = await reclaimUnsubmittedRun(outcome.execution.id);
        if (reclaimed) return submit(reclaimed, input);
      }
      return outcome.execution;
    });
  }

  return { enqueue };
}

/** The orchestrator every caller uses; tests build their own over a queue they can inspect. */
export const executionOrchestrator = createExecutionOrchestrator(testExecutionQueue);

import { and, eq, inArray } from 'drizzle-orm';
import {
  testPlanExecutions,
  type ExecutionStatus,
  type InsertTestPlanExecution,
  type TestPlanExecution,
} from '@shared/schema';
import { withTenantTransaction } from './middleware/tenancy';

/**
 * Which way a run may move, and the only code allowed to move it.
 *
 * A run's status used to be a string any code path could overwrite. The worker set `running`
 * without looking at what the row said, and the final update set `completed` the same way. So a
 * job BullMQ delivered twice ran the whole plan twice, and a late write from a worker that had
 * already been given up on could turn a finished run back into a running one. No single write
 * was wrong — none of them looked at what came before.
 *
 * Here every move is one conditional UPDATE: "set it to X where it is currently one of the
 * states X may follow". Two workers racing for the same run both issue it and the database lets
 * exactly one of them through; the other gets nothing back and knows it lost. A terminal state
 * has no way out, so nothing that arrives late can reopen a finished run.
 */

/** For each state, the states it may be reached from. `queued` is only ever the first state. */
const ALLOWED_FROM: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  queued: [],
  running: ['queued'],
  completed: ['running'],
  failed: ['running'],
  // From `queued` too: a run can fail before any worker gets to it — a plan deleted while it
  // waited, a results directory that cannot be created.
  error: ['queued', 'running'],
  cancelling: ['queued', 'running'],
  cancelled: ['cancelling'],
  timed_out: ['running'],
};

const TERMINAL: readonly ExecutionStatus[] = ['completed', 'failed', 'error', 'cancelled', 'timed_out'];

/** Fields a transition may carry. The lifecycle columns are set here, never by the caller. */
export type ExecutionTransitionPatch = Omit<
  Partial<InsertTestPlanExecution>,
  | 'id'
  | 'organizationId'
  | 'testPlanId'
  | 'status'
  | 'queuedAt'
  | 'startedAt'
  | 'completedAt'
  | 'cancelRequestedAt'
  | 'heartbeatAt'
>;

export function canTransitionExecution(from: string, to: ExecutionStatus): boolean {
  return (ALLOWED_FROM[to] as readonly string[]).includes(from);
}

export function isTerminalExecutionStatus(status: string): boolean {
  return (TERMINAL as readonly string[]).includes(status);
}

/**
 * Moves a run to `to`, if it is currently somewhere `to` may follow.
 *
 * Returns the updated row, or null when the move was not allowed — the run was already taken,
 * already finished, or does not exist in this organization. The caller decides what that means;
 * what it must not do is carry on as if it had moved the run.
 *
 * The timestamps belong to the move, not to the caller: `running` stamps when it started and its
 * first heartbeat, a terminal state stamps when it ended, `cancelling` stamps when it was asked.
 *
 * Runs inside the caller's tenant context, so a run of another organization is simply not found.
 */
export async function transitionExecution(
  executionId: string,
  to: ExecutionStatus,
  patch: ExecutionTransitionPatch = {},
): Promise<TestPlanExecution | null> {
  const sources = ALLOWED_FROM[to];
  if (sources.length === 0) return null;

  const now = new Date();
  const lifecycleTimestamps = {
    ...(to === 'running' ? { startedAt: now, heartbeatAt: now } : {}),
    ...(to === 'cancelling' ? { cancelRequestedAt: now } : {}),
    ...(TERMINAL.includes(to) ? { completedAt: now } : {}),
  };

  const [moved] = await withTenantTransaction((tx) =>
    tx
      .update(testPlanExecutions)
      .set({ ...patch, ...lifecycleTimestamps, status: to })
      .where(and(eq(testPlanExecutions.id, executionId), inArray(testPlanExecutions.status, [...sources])))
      .returning(),
  );

  return moved ?? null;
}

export type CancellationOutcome =
  | { outcome: 'cancelled'; execution: TestPlanExecution }
  | { outcome: 'cancelling'; execution: TestPlanExecution }
  | { outcome: 'already_ended'; status: string }
  | { outcome: 'not_found' };

/**
 * Asks a run to stop.
 *
 * A run still waiting in the queue is cancelled on the spot: no worker has it, and none can take
 * it once it is not `queued`, so there is nobody to wait for. A running one becomes `cancelling`
 * and its worker, which hears it at its next heartbeat, finishes the test step it is on and ends
 * the run as `cancelled`. Which of the two happens is decided by the database, one conditional
 * update at a time, so a worker taking the run at the same moment cannot be cancelled "from the
 * queue" behind its back.
 */
export async function requestCancellation(executionId: string, reason: string): Promise<CancellationOutcome> {
  const now = new Date();
  const move = (from: ExecutionStatus) =>
    withTenantTransaction((tx) =>
      tx
        .update(testPlanExecutions)
        .set({ status: 'cancelling', cancelRequestedAt: now, failureMessage: reason })
        .where(and(eq(testPlanExecutions.id, executionId), eq(testPlanExecutions.status, from)))
        .returning(),
    );

  const [fromQueue] = await move('queued');
  if (fromQueue) {
    const cancelled = await transitionExecution(executionId, 'cancelled', { failureMessage: reason });
    if (cancelled) return { outcome: 'cancelled', execution: cancelled };
  }

  const [fromRunning] = await move('running');
  if (fromRunning) return { outcome: 'cancelling', execution: fromRunning };

  const [current] = await withTenantTransaction((tx) =>
    tx.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, executionId)).limit(1),
  );
  if (!current) return { outcome: 'not_found' };
  if (current.status === 'cancelling') return { outcome: 'cancelling', execution: current };
  return { outcome: 'already_ended', status: current.status };
}

/** The states a worker is still responsible for, and so the ones it keeps a heartbeat on. */
export const LIVE_EXECUTION_STATUSES = ['running', 'cancelling'] as const;

/**
 * Says the worker is still on this run, and hears back what the run is now.
 *
 * Returns the run's status — `cancelling` is how the worker learns somebody asked it to stop —
 * or null when the run is no longer live: it ended, or was given up on by the recovery sweep,
 * and whatever this worker does next is not recorded.
 */
export async function recordHeartbeat(executionId: string): Promise<'running' | 'cancelling' | null> {
  const [row] = await withTenantTransaction((tx) =>
    tx
      .update(testPlanExecutions)
      .set({ heartbeatAt: new Date() })
      .where(and(eq(testPlanExecutions.id, executionId), inArray(testPlanExecutions.status, [...LIVE_EXECUTION_STATUSES])))
      .returning(),
  );
  return row ? (row.status as 'running' | 'cancelling') : null;
}

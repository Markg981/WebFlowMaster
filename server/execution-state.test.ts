import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { testPlanExecutions, testPlans } from '@shared/schema';
import { isExecutionInFlight } from '@shared/execution-status';
import { privilegedDb } from './db';
import { runWithTenant } from './middleware/tenancy';
import { createTestOrganization, createTestUser } from './tests/factories';
import {
  canTransitionExecution,
  isTerminalExecutionStatus,
  recordHeartbeat,
  requestCancellation,
  transitionExecution,
} from './execution-state';

/**
 * Which way a run may move.
 *
 * A status used to be a string any code path could overwrite, so a job delivered twice ran the
 * plan twice, and a late write could reopen a finished run. What these hold is that the database
 * refuses both — not that the code remembers to check.
 */

let organizationId: number;
let otherOrganizationId: number;
let userId: number;
const testPlanId = 'execution-state-plan';
let counter = 0;

beforeAll(async () => {
  organizationId = await createTestOrganization('Execution state organization');
  otherOrganizationId = await createTestOrganization('Other execution state organization');
  userId = await createTestUser(organizationId, 'execution-state-user');
  await privilegedDb.insert(testPlans).values({ id: testPlanId, organizationId, userId, name: 'Execution state plan' });
});

async function queuedRun(): Promise<string> {
  const id = `execution-state-${++counter}`;
  await privilegedDb.insert(testPlanExecutions).values({
    id,
    testPlanId,
    organizationId,
    requestedByUserId: userId,
    status: 'queued',
  });
  return id;
}

const inTenant = <T>(work: () => Promise<T>) => runWithTenant(organizationId, work);

describe('canTransitionExecution', () => {
  it.each([
    ['queued', 'running'],
    ['queued', 'cancelling'],
    ['queued', 'error'],
    ['running', 'completed'],
    ['running', 'failed'],
    ['running', 'error'],
    ['running', 'timed_out'],
    ['running', 'cancelling'],
    ['cancelling', 'cancelled'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionExecution(from, to)).toBe(true);
  });

  it.each([
    ['completed', 'running'],
    ['failed', 'running'],
    ['cancelled', 'completed'],
    // A run nobody took cannot have a verdict: a verdict is what running produces.
    ['queued', 'completed'],
    // The word the server no longer writes is not a state anything may follow from.
    ['pending', 'running'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransitionExecution(from, to)).toBe(false);
  });

  it('knows which states are the end of a run', () => {
    expect(['completed', 'failed', 'error', 'cancelled', 'timed_out'].every(isTerminalExecutionStatus)).toBe(true);
    expect(['queued', 'running', 'cancelling'].some(isTerminalExecutionStatus)).toBe(false);
  });
});

describe('transitionExecution', () => {
  it('stamps when the run started, and its first heartbeat', async () => {
    const id = await queuedRun();

    const started = await inTenant(() => transitionExecution(id, 'running'));

    expect(started).toMatchObject({ status: 'running' });
    expect(started?.startedAt).toBeInstanceOf(Date);
    expect(started?.heartbeatAt).toBeInstanceOf(Date);
  });

  it('lets exactly one of two workers take the same run', async () => {
    // What BullMQ delivering one job twice looks like from here. Before this, both workers set
    // `running` and both ran the whole plan.
    const id = await queuedRun();

    const [first, second] = await Promise.all([
      inTenant(() => transitionExecution(id, 'running')),
      inTenant(() => transitionExecution(id, 'running')),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('does not let a late worker event reopen a finished run', async () => {
    const id = await queuedRun();
    await inTenant(() => transitionExecution(id, 'running'));
    await inTenant(() => transitionExecution(id, 'completed'));

    const late = await inTenant(() => transitionExecution(id, 'running'));
    const overwritten = await inTenant(() => transitionExecution(id, 'failed'));

    expect(late).toBeNull();
    expect(overwritten).toBeNull();
    const [stored] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id));
    expect(stored.status).toBe('completed');
    expect(stored.completedAt).toBeInstanceOf(Date);
  });

  it('records why a run ended in error', async () => {
    const id = await queuedRun();

    const failed = await inTenant(() =>
      transitionExecution(id, 'error', { failureCode: 'plan_missing', failureMessage: 'The plan was deleted.' }),
    );

    expect(failed).toMatchObject({ status: 'error', failureCode: 'plan_missing' });
  });

  it('stamps when a cancellation was asked for', async () => {
    const id = await queuedRun();

    const cancelling = await inTenant(() => transitionExecution(id, 'cancelling'));

    expect(cancelling?.cancelRequestedAt).toBeInstanceOf(Date);
  });

  it('cannot move another organization’s run', async () => {
    const id = await queuedRun();

    const moved = await runWithTenant(otherOrganizationId, () => transitionExecution(id, 'running'));

    expect(moved).toBeNull();
    const [stored] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id));
    expect(stored.status).toBe('queued');
  });
});

describe('the lifecycle columns', () => {
  it('starts a run as queued, with no start time until a worker takes it', async () => {
    // started_at used to be stamped at enqueue time, so a run that waited ten minutes in the
    // queue reported ten minutes it never ran for.
    const id = `execution-state-${++counter}`;
    await privilegedDb.insert(testPlanExecutions).values({ id, testPlanId, organizationId });

    const [stored] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id));

    expect(stored.status).toBe('queued');
    expect(stored.startedAt).toBeNull();
    expect(stored.queuedAt).toBeInstanceOf(Date);
  });

  it('keeps who asked for a run after they leave, as nobody', async () => {
    const leaver = await createTestUser(organizationId, 'execution-state-leaver');
    const id = `execution-state-${++counter}`;
    await privilegedDb.insert(testPlanExecutions).values({ id, testPlanId, organizationId, requestedByUserId: leaver });

    await privilegedDb.execute(sql`DELETE FROM users WHERE id = ${leaver}`);

    const [stored] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id));
    expect(stored).toBeDefined();
    expect(stored.requestedByUserId).toBeNull();
  });
});

describe('isExecutionInFlight', () => {
  it('keeps polling every state a run is still in, including the old word', () => {
    // `pending` stays: an API client written against the previous version, or a database that
    // has not migrated yet, still uses it, and calling it finished stops a pipeline too early.
    expect(['queued', 'running', 'cancelling', 'pending'].every(isExecutionInFlight)).toBe(true);
    expect(['completed', 'failed', 'error', 'cancelled', 'timed_out', undefined].some(isExecutionInFlight)).toBe(false);
  });
});

describe('requestCancellation', () => {
  it('cancels a run still in the queue on the spot, with who asked', async () => {
    const id = await queuedRun();

    const result = await inTenant(() => requestCancellation(id, 'Cancelled by ada.'));

    expect(result.outcome).toBe('cancelled');
    const [row] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id));
    expect(row).toMatchObject({ status: 'cancelled', failureMessage: 'Cancelled by ada.' });
    expect(row.cancelRequestedAt).not.toBeNull();
    expect(row.completedAt).not.toBeNull();
    // And no worker can take it afterwards.
    expect(await inTenant(() => transitionExecution(id, 'running'))).toBeNull();
  });

  it('asks a running run to stop, and leaves ending it to its worker', async () => {
    const id = await queuedRun();
    await inTenant(() => transitionExecution(id, 'running'));

    const result = await inTenant(() => requestCancellation(id, 'Cancelled by ada.'));

    expect(result.outcome).toBe('cancelling');
    const [row] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id));
    expect(row.status).toBe('cancelling');
    expect(row.completedAt).toBeNull();
    // Asking again is harmless.
    expect((await inTenant(() => requestCancellation(id, 'again'))).outcome).toBe('cancelling');
  });

  it("says a finished run has already ended, and does not find another organization's", async () => {
    const id = await queuedRun();
    await inTenant(() => transitionExecution(id, 'running'));
    await inTenant(() => transitionExecution(id, 'completed'));

    expect(await inTenant(() => requestCancellation(id, 'late'))).toEqual({ outcome: 'already_ended', status: 'completed' });

    const other = await queuedRun();
    expect(await runWithTenant(otherOrganizationId, () => requestCancellation(other, 'not mine'))).toEqual({ outcome: 'not_found' });
    const [untouched] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, other));
    expect(untouched.status).toBe('queued');
  });
});

describe('recordHeartbeat', () => {
  it('stamps a live run and says what it is now; says nothing for a run that has not started or has ended', async () => {
    const id = await queuedRun();
    expect(await inTenant(() => recordHeartbeat(id))).toBeNull();

    await inTenant(() => transitionExecution(id, 'running'));
    await privilegedDb.update(testPlanExecutions).set({ heartbeatAt: new Date(0) }).where(eq(testPlanExecutions.id, id));
    expect(await inTenant(() => recordHeartbeat(id))).toBe('running');
    const [row] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id));
    expect(Date.now() - row.heartbeatAt!.getTime()).toBeLessThan(5_000);

    await inTenant(() => requestCancellation(id, 'stop'));
    expect(await inTenant(() => recordHeartbeat(id))).toBe('cancelling');
  });
});

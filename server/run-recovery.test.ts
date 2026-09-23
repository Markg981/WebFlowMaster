import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { testPlanExecutions, testPlans, users } from '@shared/schema';
import { createTestOrganization } from './tests/factories';
import { recoverAbandonedRuns } from './run-recovery';

/**
 * Ending the runs whose worker went away.
 *
 * A worker killed mid-run used to leave its run `running` for ever. The sweep tells a slow run
 * from a dead one by the heartbeat the worker now keeps, and ends only the dead ones.
 */

const now = new Date('2026-09-24T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

let organizationId: number;
let otherOrganizationId: number;
let planId: string;
let otherPlanId: string;

async function run(columns: Record<string, unknown>, plan = planId, org = organizationId) {
  const id = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({ id, organizationId: org, testPlanId: plan, triggeredBy: 'scheduled', ...columns } as any);
  return id;
}

async function statusOf(id: string) {
  const [row] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id));
  return row;
}

beforeEach(async () => {
  await privilegedDb.delete(testPlanExecutions);
  organizationId = await createTestOrganization('Recovery Org');
  otherOrganizationId = await createTestOrganization('Other Recovery Org');
  for (const [org, setPlan] of [
    [organizationId, (id: string) => (planId = id)],
    [otherOrganizationId, (id: string) => (otherPlanId = id)],
  ] as const) {
    const [user] = await privilegedDb.insert(users).values({ username: `rec-${uuidv4().slice(0, 8)}`, password: 'x', organizationId: org }).returning();
    const id = uuidv4();
    await privilegedDb.insert(testPlans).values({ id, name: 'Recovery', userId: user.id, organizationId: org } as any);
    setPlan(id);
  }
});

const options = { now, staleAfterMs: 2 * 60_000, maxDurationMs: 60 * 60_000, graceMs: 5 * 60_000 };

describe('recoverAbandonedRuns', () => {
  it('ends a run whose worker went quiet as an error that says so, in every organization', async () => {
    const dead = await run({ status: 'running', startedAt: minutesAgo(10), heartbeatAt: minutesAgo(5) });
    const deadElsewhere = await run({ status: 'running', startedAt: minutesAgo(10), heartbeatAt: minutesAgo(5) }, otherPlanId, otherOrganizationId);

    const report = await recoverAbandonedRuns(options);

    expect(report.lost.sort()).toEqual([dead, deadElsewhere].sort());
    const ended = await statusOf(dead);
    expect(ended).toMatchObject({ status: 'error', failureCode: 'worker_lost' });
    expect(ended.failureMessage).toMatch(/stopped answering.*2026-09-24T11:55:00/);
    expect(ended.completedAt).not.toBeNull();
  });

  it('leaves a run alone while its worker keeps beating, however long it has been going', async () => {
    const slow = await run({ status: 'running', startedAt: minutesAgo(50), heartbeatAt: minutesAgo(0.5) });
    const waiting = await run({ status: 'queued' });

    const report = await recoverAbandonedRuns(options);

    expect(report).toEqual({ lost: [], cancelled: [], timedOut: [] });
    expect((await statusOf(slow)).status).toBe('running');
    expect((await statusOf(waiting)).status).toBe('queued');
  });

  it('finishes cancelling a run whose worker went away before it could', async () => {
    const id = await run({ status: 'cancelling', startedAt: minutesAgo(10), heartbeatAt: minutesAgo(5), failureMessage: 'Cancelled by ada.' });

    const report = await recoverAbandonedRuns(options);

    expect(report.cancelled).toEqual([id]);
    expect(await statusOf(id)).toMatchObject({ status: 'cancelled', failureMessage: 'Cancelled by ada.' });
  });

  it('times out a run past its limit even while its heartbeat goes on', async () => {
    const stuck = await run({ status: 'running', startedAt: minutesAgo(70), heartbeatAt: minutesAgo(0.5) });

    const report = await recoverAbandonedRuns(options);

    expect(report.timedOut).toEqual([stuck]);
    expect(await statusOf(stuck)).toMatchObject({ status: 'timed_out', failureCode: 'run_timed_out' });
  });

  it('reads a run from before heartbeats by when it started', async () => {
    const old = await run({ status: 'running', startedAt: minutesAgo(30), heartbeatAt: null });

    expect((await recoverAbandonedRuns(options)).lost).toEqual([old]);
  });

  it('hands each run it ended to the retry, so a scheduled run with attempts left tries again', async () => {
    const dead = await run({ status: 'running', startedAt: minutesAgo(10), heartbeatAt: minutesAgo(5), attempt: 1, maxAttempts: 2 });
    const retry = vi.fn(async () => null);

    await recoverAbandonedRuns({ ...options, retry });

    expect(retry).toHaveBeenCalledWith(expect.objectContaining({ id: dead, status: 'error', attempt: 1, maxAttempts: 2 }));
  });

  it('ends each run once, however many servers sweep at the same moment', async () => {
    await run({ status: 'running', startedAt: minutesAgo(10), heartbeatAt: minutesAgo(5) });

    const [a, b] = await Promise.all([recoverAbandonedRuns(options), recoverAbandonedRuns(options)]);

    expect(a.lost.length + b.lost.length).toBe(1);
  });
});

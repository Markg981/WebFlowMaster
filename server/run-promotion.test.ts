import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from './db';
import { testPlanExecutions, testPlans, users } from '@shared/schema';
import { createTestOrganization, createTestUser } from './tests/factories';
import { announceExecution } from './execution-state';
import { promoteWaitingRuns, registerRunPromotion, type PromotableQueue } from './run-promotion';

/**
 * A run ending lets its organization's waiting runs start at once, as many as it has slots free,
 * oldest first — and only runs waiting for the limit, never a retry waiting out its backoff.
 * The database is the real one; the queue is a map of jobs that remembers what was promoted.
 */

let organizationId: number;
let planId: string;

function fakeQueue(jobs: Record<string, { state: string; deferredForQuota?: boolean }>) {
  const promoted: string[] = [];
  const queue: PromotableQueue = {
    getJob: async (id) => {
      const job = jobs[id];
      if (!job) return undefined;
      return {
        data: job.deferredForQuota ? { deferredForQuota: true } : {},
        getState: async () => job.state,
        promote: async () => { promoted.push(id); job.state = 'waiting'; },
      };
    },
  };
  return { queue, promoted };
}

async function run(status: string, minutesAgo: number) {
  const id = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({
    id,
    organizationId,
    testPlanId: planId,
    status,
    triggeredBy: 'manual',
    queuedAt: new Date(Date.now() - minutesAgo * 60_000),
  } as any);
  return id;
}

beforeEach(async () => {
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(users);
  organizationId = await createTestOrganization('Promotion Org');
  const userId = await createTestUser(organizationId);
  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Plan', userId, organizationId } as any);
});

describe('promoting waiting runs', () => {
  it('promotes the oldest runs waiting for the limit, as many as there are slots free', async () => {
    // The default limit is 2: one running, so one slot.
    await run('running', 10);
    const oldest = await run('queued', 9);
    const next = await run('queued', 8);
    const { queue, promoted } = fakeQueue({ [oldest]: { state: 'delayed', deferredForQuota: true }, [next]: { state: 'delayed', deferredForQuota: true } });
    expect(await promoteWaitingRuns(organizationId, queue)).toBe(1);
    expect(promoted).toEqual([oldest]);
  });

  it('promotes nothing while the organization is at its limit', async () => {
    await run('running', 10);
    await run('cancelling', 10);
    const waiting = await run('queued', 5);
    const { queue, promoted } = fakeQueue({ [waiting]: { state: 'delayed', deferredForQuota: true } });
    expect(await promoteWaitingRuns(organizationId, queue)).toBe(0);
    expect(promoted).toEqual([]);
  });

  it('leaves a retry in its backoff, and a job already ready, alone', async () => {
    const retry = await run('queued', 9);
    const ready = await run('queued', 8);
    const { queue, promoted } = fakeQueue({ [retry]: { state: 'delayed' }, [ready]: { state: 'waiting', deferredForQuota: true } });
    expect(await promoteWaitingRuns(organizationId, queue)).toBe(0);
    expect(promoted).toEqual([]);
  });

  it('happens when a run of the organization ends', async () => {
    const waiting = await run('queued', 5);
    const { queue, promoted } = fakeQueue({ [waiting]: { state: 'delayed', deferredForQuota: true } });
    const off = registerRunPromotion(queue);
    try {
      const [ended] = await privilegedDb.insert(testPlanExecutions).values({ id: uuidv4(), organizationId, testPlanId: planId, status: 'completed', triggeredBy: 'manual' } as any).returning();
      announceExecution({ ...ended, status: 'running' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(promoted).toEqual([]);
      announceExecution(ended);
      await expect.poll(() => promoted).toEqual([waiting]);
    } finally {
      off();
    }
  });
});

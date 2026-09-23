import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

/**
 * One organization's share of the execution plane.
 *
 * What these hold: a run past its organization's limit waits rather than runs, another
 * organization is not affected, the queue refuses a flood, and an organization's first run goes
 * ahead of another's fiftieth.
 */

vi.mock('./playwright-service', () => ({ playwrightService: { executeTestSequence: vi.fn() } }));

const { privilegedDb } = await import('./db');
const { organizations, testPlanExecutions, testPlans, users } = await import('@shared/schema');
const { createTestOrganization } = await import('./tests/factories');
const { runWithTenant, withTenantTransaction } = await import('./middleware/tenancy');
const { defaultQuotas, fairPriority, liveRunCounts, quotasFor } = await import('./tenant-quotas');
const { takeExecution, transitionExecution } = await import('./execution-state');
const { createExecutionOrchestrator, ExecutionEnqueueError } = await import('./execution-orchestrator');
const { processTestPlanJob } = await import('./test-execution-service');

let orgA: number;
let orgB: number;
let userA: number;
let userB: number;
let planA: string;
let planB: string;

async function seedOrg(name: string, limits: { maxConcurrentRuns?: number; maxQueuedRuns?: number } = {}) {
  const org = await createTestOrganization(name);
  if (limits.maxConcurrentRuns || limits.maxQueuedRuns) {
    await privilegedDb.update(organizations).set(limits).where(eq(organizations.id, org));
  }
  const [user] = await privilegedDb.insert(users).values({ username: `q-${uuidv4().slice(0, 8)}`, password: 'x', organizationId: org }).returning();
  const plan = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: plan, name: `${name} plan`, userId: user.id, organizationId: org } as any);
  return { org, user: user.id, plan };
}

async function queuedRun(org: number, plan: string) {
  const id = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({ id, organizationId: org, testPlanId: plan, status: 'queued', triggeredBy: 'manual' } as any);
  return id;
}

const statusOf = async (id: string) => (await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id)))[0].status;
const asOrg = <T>(org: number, work: () => Promise<T>) => runWithTenant(org, work);

function capturingQueue() {
  const jobs: Array<{ options: { jobId: string; priority?: number } }> = [];
  return { jobs, async add(_name: string, _data: unknown, options: { jobId: string; priority?: number }) { jobs.push({ options }); } };
}

beforeEach(async () => {
  await privilegedDb.delete(testPlanExecutions);
  ({ org: orgA, user: userA, plan: planA } = await seedOrg('Busy Org', { maxConcurrentRuns: 1, maxQueuedRuns: 3 }));
  ({ org: orgB, user: userB, plan: planB } = await seedOrg('Quiet Org'));
});

describe('the limits', () => {
  it('default from the environment, and an organization can have its own', async () => {
    expect(defaultQuotas({} as NodeJS.ProcessEnv)).toEqual({ maxConcurrentRuns: 2, maxQueuedRuns: 100 });
    expect(defaultQuotas({ ORG_MAX_CONCURRENT_RUNS: '5', ORG_MAX_QUEUED_RUNS: 'lots' } as NodeJS.ProcessEnv)).toEqual({ maxConcurrentRuns: 5, maxQueuedRuns: 100 });

    expect(await asOrg(orgA, () => withTenantTransaction((tx) => quotasFor(tx, orgA)))).toEqual({ maxConcurrentRuns: 1, maxQueuedRuns: 3 });
    expect(await asOrg(orgB, () => withTenantTransaction((tx) => quotasFor(tx, orgB)))).toEqual(defaultQuotas());
  });

  it('put an organization with runs in flight behind one with none', () => {
    expect(fairPriority({ running: 0, queued: 0 })).toBe(1);
    expect(fairPriority({ running: 2, queued: 47 })).toBe(50);
  });
});

describe('taking a run', () => {
  it('leaves a run queued while its organization is at its limit, and takes it once there is room', async () => {
    const first = await queuedRun(orgA, planA);
    const second = await queuedRun(orgA, planA);

    expect((await asOrg(orgA, () => takeExecution(first))).outcome).toBe('taken');
    expect(await asOrg(orgA, () => takeExecution(second))).toEqual({ outcome: 'over_quota', running: 1, maxConcurrentRuns: 1 });
    expect(await statusOf(second)).toBe('queued');

    await asOrg(orgA, () => transitionExecution(first, 'completed'));
    expect((await asOrg(orgA, () => takeExecution(second))).outcome).toBe('taken');
  });

  it('does not hold another organization back', async () => {
    const ours = await queuedRun(orgA, planA);
    await asOrg(orgA, () => takeExecution(ours));
    const theirs = await queuedRun(orgB, planB);

    expect((await asOrg(orgB, () => takeExecution(theirs))).outcome).toBe('taken');
  });

  it('counts a run that is being cancelled as still holding its slot', async () => {
    const first = await queuedRun(orgA, planA);
    await asOrg(orgA, () => takeExecution(first));
    await privilegedDb.update(testPlanExecutions).set({ status: 'cancelling' }).where(eq(testPlanExecutions.id, first));

    const next = await queuedRun(orgA, planA);
    expect((await asOrg(orgA, () => takeExecution(next))).outcome).toBe('over_quota');
  });

  it('lets exactly one of two workers taking at the same moment through', async () => {
    const one = await queuedRun(orgA, planA);
    const two = await queuedRun(orgA, planA);

    const outcomes = await Promise.all([asOrg(orgA, () => takeExecution(one)), asOrg(orgA, () => takeExecution(two))]);

    expect(outcomes.map((o) => o.outcome).sort()).toEqual(['over_quota', 'taken']);
  });

  it('is what the worker does, and a run it cannot take yet comes back deferred, not failed', async () => {
    const running = await queuedRun(orgA, planA);
    await asOrg(orgA, () => takeExecution(running));
    const waiting = await queuedRun(orgA, planA);

    const result = await processTestPlanJob(planA, waiting, userA);

    expect(result).toMatchObject({ deferred: true, testPlanRunId: waiting });
    expect(await statusOf(waiting)).toBe('queued');
  });
});

describe('queueing a run', () => {
  it('refuses a run past the limit of runs waiting, with 429, and records nothing', async () => {
    const orchestrator = createExecutionOrchestrator(capturingQueue());
    for (let i = 0; i < 3; i++) await orchestrator.enqueue({ planId: planA, requestedByUserId: userA, trigger: 'api' });

    const refused = await orchestrator.enqueue({ planId: planA, requestedByUserId: userA, trigger: 'api' }).catch((e) => e);

    expect(refused).toBeInstanceOf(ExecutionEnqueueError);
    expect(refused).toMatchObject({ code: 'queue_quota_exceeded', status: 429 });
    const counts = await asOrg(orgA, () => withTenantTransaction((tx) => liveRunCounts(tx, orgA)));
    expect(counts).toEqual({ running: 0, queued: 3 });
  });

  it("puts an organization's first run ahead of another's many", async () => {
    const queue = capturingQueue();
    const orchestrator = createExecutionOrchestrator(queue);
    for (let i = 0; i < 3; i++) await orchestrator.enqueue({ planId: planA, requestedByUserId: userA, trigger: 'api' });

    await orchestrator.enqueue({ planId: planB, requestedByUserId: userB, trigger: 'api' });

    expect(queue.jobs.map((job) => job.options.priority)).toEqual([1, 2, 3, 1]);
  });
});

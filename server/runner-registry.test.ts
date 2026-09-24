import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * The runners, from both ends: the worker that reports in, and the owner who looks at them.
 *
 * What these hold: a runner says where it runs and what it has; it is offline when it stops or
 * goes quiet; draining pauses its queues without stopping what it has in hand, and resuming
 * undoes it; a runner whose row vanished registers again; the run it takes names it; and only an
 * owner sees them or drains one, which is recorded.
 */

vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

const { privilegedDb } = await import('./db');
const { auditLog, runners, testPlanExecutions, testPlans, users } = await import('@shared/schema');
const { createTestOrganization } = await import('./tests/factories');
const { runWithTenant, tenancyMiddleware } = await import('./middleware/tenancy');
const registry = await import('./runner-registry');
const { takeExecution } = await import('./execution-state');
const { default: runnersRoutes } = await import('./routes/runners.routes');
const { default: organizationRoutes } = await import('./routes/organization.routes');

const description = { concurrency: 2, browserTaskConcurrency: 3, version: '9.9.9', browsers: ['chromium'] };

function fakeQueue() {
  return { paused: false, pause: vi.fn(async function (this: any) { this.paused = true; }), resume: vi.fn(function (this: any) { this.paused = false; }) };
}

beforeEach(async () => {
  await privilegedDb.delete(runners);
  registry.resetCurrentRunner();
});

describe('a runner reporting in', () => {
  it('registers where it runs and what it has', async () => {
    const id = await registry.registerRunner(description);

    const [row] = await privilegedDb.select().from(runners).where(eq(runners.id, id));
    expect(row).toMatchObject({ pid: process.pid, version: '9.9.9', concurrency: 2, browserTaskConcurrency: 3, browsers: ['chromium'], desiredState: 'active' });
    expect(id.startsWith(`${row.hostname}:${process.pid}:`)).toBe(true);
    expect(registry.currentRunnerId()).toBe(id);
  });

  it('is offline once stopped, or once quiet for too long, and draining when asked', () => {
    const now = Date.now();
    const fresh = { lastSeenAt: new Date(now), stoppedAt: null, desiredState: 'active' as const };
    expect(registry.statusOf(fresh, now)).toBe('online');
    expect(registry.statusOf({ ...fresh, desiredState: 'drain' }, now)).toBe('draining');
    expect(registry.statusOf({ ...fresh, stoppedAt: new Date(now) }, now)).toBe('offline');
    expect(registry.statusOf({ ...fresh, lastSeenAt: new Date(now - registry.RUNNER_OFFLINE_AFTER_MS - 1) }, now)).toBe('offline');
  });

  it('drains: pauses its queues without waiting, reports its jobs, and resumes when asked', async () => {
    const plans = fakeQueue();
    const tasks = fakeQueue();
    let jobs = 2;
    const agent = new registry.RunnerAgent({ description, queues: [plans, tasks], activeJobs: () => jobs });
    const id = await agent.register();

    await agent.tick();
    expect(plans.pause).not.toHaveBeenCalled();

    await registry.setRunnerDesiredState(id, 'drain');
    await agent.tick();
    expect(plans.pause).toHaveBeenCalledWith(true);
    expect(tasks.pause).toHaveBeenCalledWith(true);
    expect(agent.isDraining).toBe(true);
    const [listed] = await registry.listRunners();
    expect(listed).toMatchObject({ status: 'draining', activeJobs: 2 });

    jobs = 0;
    await agent.tick();
    expect(plans.pause).toHaveBeenCalledTimes(1);
    expect((await registry.listRunners())[0].activeJobs).toBe(0);

    await registry.setRunnerDesiredState(id, 'active');
    await agent.tick();
    expect(plans.resume).toHaveBeenCalled();
    expect(tasks.resume).toHaveBeenCalled();
    expect(agent.isDraining).toBe(false);
  });

  it('registers again when its row is gone, and goes offline at once when stopped', async () => {
    const agent = new registry.RunnerAgent({ description, queues: [], activeJobs: () => 0 });
    const first = await agent.register();
    await privilegedDb.delete(runners);

    await agent.tick();
    expect(agent.runnerId).not.toBe(first);
    expect(await privilegedDb.select().from(runners)).toHaveLength(1);

    await agent.stop();
    expect((await registry.listRunners())[0].status).toBe('offline');
  });

  it('forgets a runner gone for a week, and counts only the ones that can take work', async () => {
    const id = await registry.registerRunner(description);
    await registry.registerRunner(description);
    await privilegedDb.update(runners).set({ lastSeenAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }).where(eq(runners.id, id));

    expect(await registry.listRunners()).toHaveLength(1);
    expect(await registry.availableRunnerCount()).toBe(1);
  });
});

describe('a run', () => {
  it('names the runner that took it', async () => {
    const org = await createTestOrganization('Runner Org');
    const [user] = await privilegedDb.insert(users).values({ username: `r-${uuidv4()}`, password: 'x', organizationId: org }).returning();
    const planId = uuidv4();
    await privilegedDb.insert(testPlans).values({ id: planId, name: 'P', userId: user.id, organizationId: org } as any);
    const runId = uuidv4();
    await privilegedDb.insert(testPlanExecutions).values({ id: runId, organizationId: org, testPlanId: planId, status: 'queued' } as any);
    const runnerId = await registry.registerRunner(description);

    const taken = await runWithTenant(org, () => takeExecution(runId));

    expect(taken.outcome).toBe('taken');
    const [row] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, runId));
    expect(row.runnerId).toBe(runnerId);
  });
});

describe('the runners, as an owner sees them', () => {
  let app: express.Express;
  let current: { id: number; username: string; organizationId: number; role: string };
  let org: number;

  beforeAll(async () => {
    org = await createTestOrganization('Ops Org');
    const [owner] = await privilegedDb.insert(users).values({ username: `ops-${uuidv4()}`, password: 'x', organizationId: org, role: 'owner' }).returning();
    current = { id: owner.id, username: owner.username, organizationId: org, role: 'owner' };
    // The test database holds many organizations, so draining is for the named administrators.
    process.env.INSTALLATION_ADMINS = owner.username;
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = current;
      (req as any).isAuthenticated = () => true;
      next();
    });
    app.use(tenancyMiddleware);
    app.use(runnersRoutes);
    app.use(organizationRoutes);
  });

  afterAll(() => {
    delete process.env.INSTALLATION_ADMINS;
  });

  it('lists them, and drains and resumes one, on the record', async () => {
    const id = await registry.registerRunner(description);

    const listed = await request(app).get('/api/runners').expect(200);
    expect(listed.body).toEqual([expect.objectContaining({ id, status: 'online', browsers: ['chromium'] })]);

    const drained = await request(app).post(`/api/runners/${encodeURIComponent(id)}/drain`).expect(200);
    expect(drained.body.status).toBe('draining');
    await request(app).post(`/api/runners/${encodeURIComponent(id)}/resume`).expect(200);
    await request(app).post('/api/runners/nowhere/drain').expect(404);

    const entries = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, org));
    expect(entries.map((e) => e.action).sort()).toEqual(['runner.drained', 'runner.resumed']);
  });

  it('are for owners only', async () => {
    const saved = current;
    current = { ...current, role: 'editor' };
    try {
      await request(app).get('/api/runners').expect(403);
      await request(app).post('/api/runners/x/drain').expect(403);
    } finally {
      current = saved;
    }
  });

  it('are listed to any owner, but drained only by an installation administrator', async () => {
    const id = await registry.registerRunner(description);
    const saved = current;
    current = { ...current, username: 'another-owner' };
    try {
      await request(app).get('/api/runners').expect(200);
      const refused = await request(app).post(`/api/runners/${encodeURIComponent(id)}/drain`).expect(403);
      expect(refused.body.code).toBe('installation_admin_required');
    } finally {
      current = saved;
    }
  });

  it('tells an organization when no runner can take its runs', async () => {
    expect((await request(app).get('/api/organization/usage').expect(200)).body.runnersOnline).toBe(0);
    await registry.registerRunner(description);
    expect((await request(app).get('/api/organization/usage').expect(200)).body.runnersOnline).toBe(1);
  });
});

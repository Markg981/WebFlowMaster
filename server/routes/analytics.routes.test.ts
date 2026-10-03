import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { mobileTests, reportTestCaseResults, testPlanExecutions, testPlans, testQuarantines, projects, tests, testPlanSelectedTests, testPlanSchedules } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * The figures behind the dashboard.
 *
 * `getDashboardMetrics` was written, exported, and never called: no route mounted it. The
 * client's GET fell through to the catch-all that serves index.html, `res.json()` threw on
 * the HTML, and the query failed — so every account saw a success rate of 0%, empty charts
 * and no recent reports, whatever it had actually run. Nothing said so, because a failed
 * query and an account with no executions render identically.
 *
 * These tests hold the route in place and pin the two things that were wrong in the payload
 * it returns: a trend window filled with real days, and slices identified by a stable status
 * rather than by a hex colour and an English label.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let otherUserId: number;
let currentUser: { id: number; organizationId: number; role: string };

beforeAll(async () => {
  organizationId = await createTestOrganization('Analytics Org');
  userId = await createTestUser(organizationId, `analytics-user-${organizationId}`);
  otherUserId = await createTestUser(organizationId, `analytics-other-user-${organizationId}`);

  const { default: analyticsRoutes } = await import('./analytics.routes');

  app = express();
  app.use(express.json());
  const { runWithTenant } = await import('../middleware/tenancy');

  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => Boolean(currentUser);
    // The same binding tenancyMiddleware establishes in production. The dashboard route does
    // not need it; the flaky analysis queries org-scoped tables under RLS and does.
    if (!currentUser) return next();
    runWithTenant(currentUser.organizationId, () => next(), { userId: currentUser.id, role: currentUser.role });
  });
  app.use(analyticsRoutes);
});

beforeEach(async () => {
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlans);
  currentUser = { id: userId, organizationId, role: 'owner' };
});

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${organizationId}_${++idCounter}`;

async function createPlan(ownerId: number, name: string): Promise<string> {
  const id = nextId('plan');
  await privilegedDb.execute(
    sql`INSERT INTO test_plans (id, name, user_id, organization_id)
        VALUES (${id}, ${name}, ${ownerId}, ${organizationId})`,
  );
  return id;
}

async function createExecution(planId: string, status: string, durationMs: number) {
  await privilegedDb.execute(
    sql`INSERT INTO test_plan_executions
          (id, test_plan_id, organization_id, status, started_at, execution_duration_ms)
        VALUES (${nextId('exec')}, ${planId}, ${organizationId}, ${status}, ${new Date()}, ${durationMs})`,
  );
}

describe('GET /api/analytics/dashboard', () => {
  it('is mounted at the path the dashboard asks for', async () => {
    // The whole defect in one assertion: without a router here this returned index.html,
    // which the client could not parse and reported as no data at all.
    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('refuses an unauthenticated request', async () => {
    currentUser = undefined as any;

    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.status).toBe(401);
  });

  it('counts all accessible organization executions across authors', async () => {
    const mine = await createPlan(userId, 'Mine');
    const theirs = await createPlan(otherUserId, 'Theirs');
    await createExecution(mine, 'completed', 1000);
    await createExecution(mine, 'failed', 3000);
    await createExecution(theirs, 'completed', 5000);

    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.body.kpis.totalRuns).toBe(3);
    expect(res.body.kpis.successRate).toBe(67);
  });

  it('reports zero runs without inventing a success rate', async () => {
    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.body.kpis.totalRuns).toBe(0);
    expect(res.body.kpis.lastRun).toBeNull();
  });

  it('identifies each slice by status, not by colour or an English label', async () => {
    const plan = await createPlan(userId, 'Slices');
    await createExecution(plan, 'completed', 1000);

    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.body.distribution.map((slice: any) => slice.status)).toEqual([
      'passed',
      'failed',
      'pending',
    ]);
    // Colour is the interface's decision, so that it can follow the theme; the label is the
    // interface's decision, so that it can be translated.
    for (const slice of res.body.distribution) {
      expect(slice).not.toHaveProperty('fill');
      expect(slice).not.toHaveProperty('name');
    }
  });

  it('fills the trend with every day of the window', async () => {
    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.body.trend).toHaveLength(30);
    // Which is why the chart cannot take a non-empty array to mean that something ran.
    expect(res.body.trend.every((day: any) => day.passed === 0 && day.failed === 0)).toBe(true);
  });

  it('returns the most recent executions for the reports panel', async () => {
    const plan = await createPlan(userId, 'Recent');
    await createExecution(plan, 'completed', 1000);
    await createExecution(plan, 'failed', 2000);

    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.body.recent).toHaveLength(2);
    expect(res.body.recent[0]).toMatchObject({ planName: 'Recent' });
  });
});

/**
 * Which tests disagree with themselves.
 *
 * Every run was readable on its own and nothing ever looked across them, so an unreliable test
 * was investigated fresh each time it failed — and eventually believed less than it should be.
 */
describe('GET /api/analytics/flaky', () => {
  async function recordResult(
    planId: string,
    input: { testName: string; status: string; browser?: string | null; daysAgo: number; testVersion?: number | null },
  ) {
    const executionId = nextId('exec');
    const startedAt = new Date(Date.now() - input.daysAgo * 86_400_000);
    await privilegedDb.execute(
      sql`INSERT INTO test_plan_executions
            (id, test_plan_id, organization_id, status, started_at)
          VALUES (${executionId}, ${planId}, ${organizationId}, 'completed', ${startedAt})`,
    );
    await privilegedDb.execute(
      sql`INSERT INTO report_test_case_results
            (id, test_plan_execution_id, organization_id, test_type, test_name, browser, status, started_at, test_version)
          VALUES (${nextId('rep')}, ${executionId}, ${organizationId}, 'ui', ${input.testName},
                  ${input.browser ?? null}, ${input.status}, ${startedAt}, ${input.testVersion ?? null})`,
    );
  }

  it('names the test that keeps changing its mind, and says how often', async () => {
    const plan = await createPlan(userId, 'Nightly');
    await recordResult(plan, { testName: 'Login', status: 'Passed', daysAgo: 4 });
    await recordResult(plan, { testName: 'Login', status: 'Failed', daysAgo: 3 });
    await recordResult(plan, { testName: 'Login', status: 'Passed', daysAgo: 2 });
    await recordResult(plan, { testName: 'Steady', status: 'Passed', daysAgo: 4 });
    await recordResult(plan, { testName: 'Steady', status: 'Passed', daysAgo: 3 });
    await recordResult(plan, { testName: 'Steady', status: 'Passed', daysAgo: 2 });

    const res = await request(app).get('/api/analytics/flaky').expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ testName: 'Login', flips: 2, runs: 3 });
    expect(res.body.window.days).toBe(30);
  });

  it('names a mobile test that keeps changing its mind on a device, and whether it is in quarantine', async () => {
    const plan = await createPlan(userId, 'Devices');
    const [{ id: mobileTestId }] = await privilegedDb
      .insert(mobileTests)
      .values({ organizationId, name: 'Checkout on Android', platform: 'android', app: 'bs://a', deviceName: 'Pixel 8', steps: [] } as any)
      .returning();
    for (const [status, daysAgo] of [['Passed', 4], ['Failed', 3], ['Passed', 2]] as const) {
      const executionId = nextId('exec');
      const startedAt = new Date(Date.now() - daysAgo * 86_400_000);
      await privilegedDb.insert(testPlanExecutions).values({ id: executionId, testPlanId: plan, organizationId, status: 'completed', startedAt } as any);
      await privilegedDb.insert(reportTestCaseResults).values({
        id: nextId('rep'), testPlanExecutionId: executionId, organizationId, testType: 'mobile', mobileTestId,
        testName: 'Checkout on Android', browser: 'Pixel 8 · 14.0', status, startedAt,
      } as any);
    }

    const before = await request(app).get('/api/analytics/flaky').expect(200);
    expect(before.body.items).toEqual([
      expect.objectContaining({ testName: 'Checkout on Android', browser: 'Pixel 8 · 14.0', flips: 2, test: { type: 'mobile', id: mobileTestId }, quarantine: null }),
    ]);

    await privilegedDb.insert(testQuarantines).values({ organizationId, testType: 'mobile', mobileTestId, reason: 'Device farm drops the session' });
    const after = await request(app).get('/api/analytics/flaky').expect(200);
    expect(after.body.items[0].quarantine).toMatchObject({ reason: 'Device farm drops the session' });
  });

  it('looks only as far back as it says it does', async () => {
    const plan = await createPlan(userId, 'Nightly');
    await recordResult(plan, { testName: 'Login', status: 'Passed', daysAgo: 40 });
    await recordResult(plan, { testName: 'Login', status: 'Failed', daysAgo: 39 });
    await recordResult(plan, { testName: 'Login', status: 'Passed', daysAgo: 38 });

    const recent = await request(app).get('/api/analytics/flaky?days=7').expect(200);
    const wider = await request(app).get('/api/analytics/flaky?days=60').expect(200);

    expect(recent.body.items).toEqual([]);
    expect(wider.body.items).toHaveLength(1);
  });

  it('can be narrowed to one plan', async () => {
    const nightly = await createPlan(userId, 'Nightly');
    const smoke = await createPlan(userId, 'Smoke');
    await recordResult(nightly, { testName: 'Login', status: 'Passed', daysAgo: 4 });
    await recordResult(nightly, { testName: 'Login', status: 'Failed', daysAgo: 3 });
    await recordResult(nightly, { testName: 'Login', status: 'Passed', daysAgo: 2 });

    const theirs = await request(app).get(`/api/analytics/flaky?planId=${smoke}`).expect(200);
    const ours = await request(app).get(`/api/analytics/flaky?planId=${nightly}`).expect(200);

    expect(theirs.body.items).toEqual([]);
    expect(ours.body.items).toHaveLength(1);
  });

  it('refuses nonsense thresholds rather than trusting them', async () => {
    const res = await request(app).get('/api/analytics/flaky?days=abc&minRuns=-5&limit=99999').expect(200);

    expect(res.body.window.days).toBe(30);
    expect(res.body.thresholds.minimumRuns).toBe(2);
  });

  it('does not call a test flaky when its own edits explain the change', async () => {
    // The whole reason results carry a version: a test rewritten on Monday night and failing
    // ever since is a changed test, not an unreliable one, and a list that cannot tell them
    // apart is one people stop reading.
    const plan = await createPlan(userId, 'Nightly');
    await recordResult(plan, { testName: 'Checkout', status: 'Passed', daysAgo: 5, testVersion: 1 });
    await recordResult(plan, { testName: 'Checkout', status: 'Passed', daysAgo: 4, testVersion: 1 });
    await recordResult(plan, { testName: 'Checkout', status: 'Failed', daysAgo: 3, testVersion: 2 });
    await recordResult(plan, { testName: 'Checkout', status: 'Failed', daysAgo: 2, testVersion: 2 });

    const res = await request(app).get('/api/analytics/flaky').expect(200);

    expect(res.body.items).toEqual([]);
  });

  it('reports the changes of verdict an edit does not account for, and says it was edited', async () => {
    const plan = await createPlan(userId, 'Nightly');
    await recordResult(plan, { testName: 'Checkout', status: 'Passed', daysAgo: 5, testVersion: 1 });
    await recordResult(plan, { testName: 'Checkout', status: 'Failed', daysAgo: 4, testVersion: 1 });
    await recordResult(plan, { testName: 'Checkout', status: 'Passed', daysAgo: 3, testVersion: 2 });
    await recordResult(plan, { testName: 'Checkout', status: 'Failed', daysAgo: 2, testVersion: 2 });

    const res = await request(app).get('/api/analytics/flaky').expect(200);

    expect(res.body.items[0]).toMatchObject({
      testName: 'Checkout',
      flips: 3,
      unexplainedFlips: 2,
      versions: [1, 2],
      changedDuringWindow: true,
    });
  });

  it('counts a history with no versions exactly as it always did', async () => {
    const plan = await createPlan(userId, 'Nightly');
    await recordResult(plan, { testName: 'Login', status: 'Passed', daysAgo: 4 });
    await recordResult(plan, { testName: 'Login', status: 'Failed', daysAgo: 3 });
    await recordResult(plan, { testName: 'Login', status: 'Passed', daysAgo: 2 });

    const res = await request(app).get('/api/analytics/flaky').expect(200);

    expect(res.body.items[0]).toMatchObject({ unexplainedFlips: 2, changedDuringWindow: false, versions: [] });
  });

  it('says nothing, successfully, when nothing has run', async () => {
    const res = await request(app).get('/api/analytics/flaky').expect(200);

    expect(res.body.items).toEqual([]);
    expect(res.body.window.resultsExamined).toBe(0);
  });
});

describe('dashboard widget filters and project isolation', () => {
  async function projectFixture(restricted: boolean) {
    const [project] = await privilegedDb.insert(projects).values({ name: restricted ? 'Confidential app' : 'Open app', userId, organizationId, restricted }).returning();
    const [test] = await privilegedDb.insert(tests).values({ name: 'Project test', userId, organizationId, projectId: project.id, url: 'https://example.com', sequence: [], elements: [] }).returning();
    return { project, test };
  }
  const widget = (config = {}, type = 'kpis') => ({ id: 'instance', type, visible: true, width: 'full', config });
  it('filters all metrics and trend by period and bounds query inputs', async () => {
    const plan = await createPlan(otherUserId, 'Period'); await createExecution(plan, 'completed', 1000);
    await privilegedDb.insert(testPlanExecutions).values({ id: nextId('old'), organizationId, testPlanId: plan, status: 'failed', startedAt: new Date(Date.now() - 10 * 86400000), queuedAt: new Date(Date.now() - 10 * 86400000) });
    const oneDay = await request(app).post('/api/analytics/dashboard/widget').send(widget({ days: 1 }));
    expect(oneDay.status).toBe(200); expect(oneDay.body.kpis.totalRuns).toBe(1); expect(oneDay.body.trend).toHaveLength(1);
    const month = await request(app).get('/api/analytics/dashboard?days=30'); expect(month.body.kpis.totalRuns).toBe(2);
    for (const filters of ['days=366', 'days=0', 'limit=51', 'projectId=-1', 'unknown=value']) expect((await request(app).get(`/api/analytics/dashboard?${filters}`)).status).toBe(400);
  });
  it('returns unavailable without project names or counts for a restricted project', async () => {
    const { project } = await projectFixture(true); currentUser.role = 'viewer';
    const response = await request(app).post('/api/analytics/dashboard/widget').send(widget({ projectId: project.id }));
    expect(response.status).toBe(200); expect(response.body).toEqual({ unavailable: true });
  });
  it('excludes hidden and mixed-project executions and schedules across all widget requests', async () => {
    const open = await projectFixture(false), hidden = await projectFixture(true);
    const visible = await createPlan(otherUserId, 'Visible plan'), secret = await createPlan(otherUserId, 'Confidential plan'), mixed = await createPlan(otherUserId, 'Mixed plan');
    await privilegedDb.insert(testPlanSelectedTests).values([
      { organizationId, testPlanId: visible, testId: open.test.id, testType: 'ui' },
      { organizationId, testPlanId: secret, testId: hidden.test.id, testType: 'ui' },
      { organizationId, testPlanId: mixed, testId: open.test.id, testType: 'ui' },
      { organizationId, testPlanId: mixed, testId: hidden.test.id, testType: 'ui' },
    ]);
    for (const plan of [visible, secret, mixed]) { await createExecution(plan, 'completed', 1000); await privilegedDb.insert(testPlanSchedules).values({ id: nextId('schedule'), organizationId, testPlanId: plan, scheduleName: plan, frequency: 'daily', nextRunAt: new Date(), environment: 'prod' }); }
    currentUser.role = 'viewer';
    const metrics = await request(app).post('/api/analytics/dashboard/widget').send(widget());
    expect(metrics.body.kpis.totalRuns).toBe(1); expect(metrics.body.recent.map((r: any) => r.planName)).toEqual(['Visible plan']);
    const schedules = await request(app).post('/api/analytics/dashboard/widget').send(widget({ projectId: open.project.id, environment: 'prod', limit: 50 }, 'schedules'));
    expect(schedules.body.schedules.map((r: any) => r.testPlanName)).toEqual(['Visible plan']);
    const staging = await request(app).post('/api/analytics/dashboard/widget').send(widget({ environment: 'staging' }, 'schedules')); expect(staging.body.schedules).toEqual([]);
  });
  it('checks historical result references even when a plan no longer selects the restricted test', async () => {
    const hidden = await projectFixture(true); const plan = await createPlan(otherUserId, 'Past confidential result'); await createExecution(plan, 'completed', 1000);
    const [execution] = await privilegedDb.select().from(testPlanExecutions);
    await privilegedDb.insert(reportTestCaseResults).values({ id: nextId('result'), organizationId, testPlanExecutionId: execution.id, uiTestId: hidden.test.id, testType: 'ui', testName: hidden.test.name, status: 'passed', startedAt: new Date() });
    currentUser.role = 'viewer'; const response = await request(app).get('/api/analytics/dashboard'); expect(response.body.kpis.totalRuns).toBe(0); expect(response.body.recent).toEqual([]);
  });
  it('checks frozen queued-run references after the current plan changes its selected tests', async () => {
    const hidden = await projectFixture(true), open = await projectFixture(false);
    const plan = await createPlan(otherUserId, 'Changed plan');
    await privilegedDb.insert(testPlanExecutions).values([
      { id: nextId('frozen-hidden'), organizationId, testPlanId: plan, configurationSnapshot: { selectedTests: [{ testId: hidden.test.id, apiTestId: null, testType: 'ui' }] } },
      { id: nextId('frozen-open'), organizationId, testPlanId: plan, configurationSnapshot: { selectedTests: [{ testId: open.test.id, apiTestId: null, testType: 'ui' }] } },
    ]);
    currentUser.role = 'viewer';
    const response = await request(app).get(`/api/analytics/dashboard?projectId=${open.project.id}`);
    expect(response.status).toBe(200); expect(response.body.kpis.totalRuns).toBe(1);
    const all = await request(app).get('/api/analytics/dashboard'); expect(all.body.kpis.totalRuns).toBe(1);
  });
  it('uses a queued run’s frozen project instead of the current plan’s replacement project', async () => {
    const original = await projectFixture(false), replacement = await projectFixture(false);
    const plan = await createPlan(otherUserId, 'Reassigned plan');
    await privilegedDb.insert(testPlanExecutions).values({
      id: nextId('frozen-original'), organizationId, testPlanId: plan,
      configurationSnapshot: { selectedTests: [{ testId: original.test.id, apiTestId: null, testType: 'ui' }] },
    });
    await privilegedDb.insert(testPlanSelectedTests).values({ organizationId, testPlanId: plan, testId: replacement.test.id, testType: 'ui' });
    currentUser.role = 'viewer';
    const replacementMetrics = await request(app).get(`/api/analytics/dashboard?projectId=${replacement.project.id}`);
    expect(replacementMetrics.status).toBe(200); expect(replacementMetrics.body.kpis.totalRuns).toBe(0);
    const originalMetrics = await request(app).get(`/api/analytics/dashboard?projectId=${original.project.id}`);
    expect(originalMetrics.status).toBe(200); expect(originalMetrics.body.kpis.totalRuns).toBe(1);
  });
});

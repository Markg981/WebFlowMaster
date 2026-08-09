import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { privilegedDb } from './db';
import {
  users,
  organizations,
  projects,
  tests,
  testPlans,
  testPlanSchedules,
  testPlanSelectedTests,
  testPlanExecutions,
  reportTestCaseResults,
  executionLogs,
  excelSequencesMap,
  type User,
} from '../shared/schema';
import { eq } from 'drizzle-orm';
import { createTestOrganization } from './tests/factories';
import { runTestPlan } from './test-execution-service';

/**
 * `organizationId` is the tenancy boundary the Row-Level Security policies key off, so it
 * must never be reachable from the wire. These tests mount the REAL handlers registered by
 * `registerRoutes` — including its router mount order, which decides which of two
 * competing `/api/test-plans` handlers actually runs — and assert on the persisted row
 * rather than the response body alone.
 *
 * Every case here corresponds to a defect that shipped because no test exercised the
 * production handler: a body-trusted organizationId, a join-table insert missing the
 * column, and a mapping row that stamped the caller's organization onto another tenant's
 * test.
 */

// The schedule route calls updateScheduleJob for real otherwise. Today that registers
// nothing only because 'daily@02:00' is an unparseable frequency — change the fixture to
// 'daily' and it puts a node-cron task into activeCronJobs that nothing stops, keeping the
// event loop alive. server/test-plan-schedules.test.ts mocks it for the same reason.
vi.mock('./scheduler-service', () => ({
  default: {
    addScheduleJob: vi.fn(),
    updateScheduleJob: vi.fn(),
    removeScheduleJob: vi.fn(),
    initializeScheduler: vi.fn(),
  },
}));

// C3 (POST /api/run-test-plan/:id): the ownership gate must reject a foreign plan before
// this is ever reached. runTestPlan itself enqueues onto testExecutionQueue (BullMQ/Redis),
// which has no place in a unit test, so it is mocked and its call count is the observable.
vi.mock('./test-execution-service', () => ({
  runTestPlan: vi.fn().mockResolvedValue({ id: 'mock-execution', status: 'pending' }),
}));

vi.mock('./playwright-service', () => ({
  playwrightService: {
    loadWebsite: vi.fn(),
    detectElements: vi.fn(),
    executeAdhocSequence: vi.fn(),
    executeTest: vi.fn(),
    startRecordingSession: vi.fn(),
    stopRecordingSession: vi.fn(),
    getRecordedActions: vi.fn(),
  },
  PlaywrightService: class {},
}));

let app: Application;
let currentUser: User;

let sessionOrganizationId: number;
let foreignOrganizationId: number;
let sessionUser: User;
let foreignUser: User;

beforeAll(async () => {
  const tempApp = express();
  tempApp.use(express.json());
  tempApp.use((req: Request, res: Response, next: NextFunction) => {
    req.user = currentUser;
    req.isAuthenticated = () => true;
    next();
  });
  const { registerRoutes } = await import('./routes');
  await registerRoutes(tempApp);
  app = tempApp;
});

/**
 * Every suite here shares one file-backed PGlite database and they run sequentially, so
 * rows left behind become the next suite's problem: several of them start with a bare
 * `privilegedDb.delete(users)`, which a leftover FK reference turns into a failure in a file that
 * never touched this data. Same reason scripts/netcontent/importer.test.ts cleans up.
 */
async function clearAll() {
  await privilegedDb.delete(executionLogs);
  await privilegedDb.delete(reportTestCaseResults);
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(excelSequencesMap);
  await privilegedDb.delete(testPlanSelectedTests);
  await privilegedDb.delete(testPlanSchedules);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(tests);
  await privilegedDb.delete(projects);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
}

afterAll(clearAll);

beforeEach(async () => {
  await clearAll();

  sessionOrganizationId = await createTestOrganization('Session Organization');
  foreignOrganizationId = await createTestOrganization('Foreign Organization');

  [sessionUser] = await privilegedDb
    .insert(users)
    .values({ username: 'session_user', password: 'hashed', organizationId: sessionOrganizationId })
    .returning();
  [foreignUser] = await privilegedDb
    .insert(users)
    .values({ username: 'foreign_user', password: 'hashed', organizationId: foreignOrganizationId })
    .returning();

  currentUser = sessionUser;
});

/** A `tests` row, owned by whichever user/organization is named. */
async function seedTest(owner: User, name: string) {
  const [row] = await privilegedDb
    .insert(tests)
    .values({
      userId: owner.id,
      organizationId: owner.organizationId,
      name,
      url: 'https://app.test',
      sequence: [],
      elements: [],
    })
    .returning();
  return row;
}

describe('POST /api/test-plans', () => {
  it('links the selected tests it was sent', async () => {
    // CreateTestPlanWizard always sends selectedTests. The live handler used to destructure
    // it out and insert only the plan, so every plan created from the UI had zero linked
    // tests — while a second, complete implementation of this endpoint sat in routes.ts,
    // shadowed by mount order and never executing.
    const uiTest = await seedTest(sessionUser, 'Linked at creation');

    const response = await request(app)
      .post('/api/test-plans')
      .send({ name: 'Plan created with tests', selectedTests: [{ id: uiTest.id, type: 'ui' }] })
      .expect(201);

    const links = await privilegedDb
      .select()
      .from(testPlanSelectedTests)
      .where(eq(testPlanSelectedTests.testPlanId, response.body.id));

    expect(links).toHaveLength(1);
    expect(links[0].testId).toBe(uiTest.id);
    expect(links[0].testType).toBe('ui');
    // From the parent plan, not the session — the same rule the PUT handler follows.
    expect(links[0].organizationId).toBe(sessionOrganizationId);
  });

  it('refuses to link another organization’s test at creation', async () => {
    const foreignTest = await seedTest(foreignUser, 'Foreign test');

    await request(app)
      .post('/api/test-plans')
      .send({ name: 'Plan with a stolen test', selectedTests: [{ id: foreignTest.id, type: 'ui' }] })
      .expect(400);

    const links = await privilegedDb
      .select()
      .from(testPlanSelectedTests)
      .where(eq(testPlanSelectedTests.testId, foreignTest.id));
    expect(links).toHaveLength(0);
  });

  it('ignores userId and organizationId in the request body and persists the row under the session', async () => {
    const response = await request(app)
      .post('/api/test-plans')
      .send({
        name: 'Regression Plan',
        description: 'created by the session user',
        userId: foreignUser.id,
        organizationId: foreignOrganizationId,
      })
      .expect(201);

    expect(response.body.organizationId).toBe(sessionOrganizationId);
    expect(response.body.userId).toBe(sessionUser.id);

    const [stored] = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, response.body.id));
    expect(stored.organizationId).toBe(sessionOrganizationId);
    expect(stored.userId).toBe(sessionUser.id);

    // Nothing at all landed in the other tenant.
    const foreignPlans = await privilegedDb
      .select()
      .from(testPlans)
      .where(eq(testPlans.organizationId, foreignOrganizationId));
    expect(foreignPlans).toHaveLength(0);
  });
});

describe('PUT /api/test-plans/:id', () => {
  it('stamps the session organization on the testPlanSelectedTests rows it writes', async () => {
    const uiTest = await seedTest(sessionUser, 'Linked UI test');

    const created = await request(app)
      .post('/api/test-plans')
      .send({ name: 'Plan with selections' })
      .expect(201);

    // Before the fix this returned 500: the join-table insert omitted the NOT NULL
    // organizationId, and the `tx: any` annotation kept the compiler from noticing.
    await request(app)
      .put(`/api/test-plans/${created.body.id}`)
      .send({ selectedTests: [{ id: uiTest.id, type: 'ui' }] })
      .expect(200);

    const links = await privilegedDb
      .select()
      .from(testPlanSelectedTests)
      .where(eq(testPlanSelectedTests.testPlanId, created.body.id));

    expect(links).toHaveLength(1);
    expect(links[0].testId).toBe(uiTest.id);
    expect(links[0].organizationId).toBe(sessionOrganizationId);
  });

  it('cannot reach another organization’s plan', async () => {
    const [foreignPlan] = await privilegedDb
      .insert(testPlans)
      .values({
        id: 'foreign-plan',
        name: 'Foreign plan',
        userId: foreignUser.id,
        organizationId: foreignOrganizationId,
      })
      .returning();
    const ownTest = await seedTest(sessionUser, 'Own linked test');

    // Not 403: whether a plan id exists is itself another tenant's business.
    await request(app)
      .put(`/api/test-plans/${foreignPlan.id}`)
      .send({ name: 'Hijacked', selectedTests: [{ id: ownTest.id, type: 'ui' }] })
      .expect(404);

    const [stored] = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, foreignPlan.id));
    expect(stored.name).toBe('Foreign plan');

    // The row this used to write was internally cross-tenant: stamped with the foreign
    // plan's organization while naming a test from the caller's.
    const links = await privilegedDb
      .select()
      .from(testPlanSelectedTests)
      .where(eq(testPlanSelectedTests.testPlanId, foreignPlan.id));
    expect(links).toHaveLength(0);
  });

  it('refuses to link another organization’s test into a plan of your own', async () => {
    const foreignTest = await seedTest(foreignUser, 'Foreign test');
    const created = await request(app)
      .post('/api/test-plans')
      .send({ name: 'Plan of my own' })
      .expect(201);

    // Nothing downstream re-checks these ids: test-execution-service loads them with
    // inArray and no organization filter, so an accepted foreign id means the runner
    // executes another tenant's test.
    await request(app)
      .put(`/api/test-plans/${created.body.id}`)
      .send({ selectedTests: [{ id: foreignTest.id, type: 'ui' }] })
      .expect(400);

    const links = await privilegedDb
      .select()
      .from(testPlanSelectedTests)
      .where(eq(testPlanSelectedTests.testPlanId, created.body.id));
    expect(links).toHaveLength(0);
  });

  it('updates a plain plan field without failing on updatedAt', async () => {
    const created = await request(app)
      .post('/api/test-plans')
      .send({ name: 'Original name' })
      .expect(201);

    // This branch used to 500: updatedAt was set to unix seconds on a `timestamp` column,
    // and drizzle calls .toISOString() on whatever it is handed. Only the
    // selectedTests-only branch was covered, so the failure was invisible.
    const response = await request(app)
      .put(`/api/test-plans/${created.body.id}`)
      .send({ name: 'Renamed' })
      .expect(200);

    expect(response.body.name).toBe('Renamed');
  });
});

describe('POST /api/excel-mappings', () => {
  it('stamps the parent test’s organization on the mapping', async () => {
    const ownTest = await seedTest(sessionUser, 'Own test');

    await request(app)
      .post('/api/excel-mappings')
      .send({ excelTestCaseId: 'TC-100', testId: ownTest.id })
      .expect(200);

    const [mapping] = await privilegedDb
      .select()
      .from(excelSequencesMap)
      .where(eq(excelSequencesMap.testId, ownTest.id));
    expect(mapping.organizationId).toBe(sessionOrganizationId);
  });

  it('refuses to map another organization’s test, and says no more than "not found"', async () => {
    const foreignTest = await seedTest(foreignUser, 'Foreign test');

    // The same 404 an unknown id gets: a distinct 403 would answer "does test N exist?"
    // for every id in the table, across tenants.
    await request(app)
      .post('/api/excel-mappings')
      .send({ excelTestCaseId: 'TC-200', testId: foreignTest.id })
      .expect(404);

    // The decisive assertion: no mapping row exists at all. Before the fix one was
    // written, stamped with the caller's organization while pointing at a foreign test —
    // which under RLS would have been readable by the wrong tenant.
    const mappings = await privilegedDb
      .select()
      .from(excelSequencesMap)
      .where(eq(excelSequencesMap.testId, foreignTest.id));
    expect(mappings).toHaveLength(0);
  });

  it('404s on a testId that does not exist', async () => {
    await request(app)
      .post('/api/excel-mappings')
      .send({ excelTestCaseId: 'TC-300', testId: 999999 })
      .expect(404);
  });

  it('400s on a non-numeric testId instead of letting it reach the query', async () => {
    await request(app)
      .post('/api/excel-mappings')
      .send({ excelTestCaseId: 'TC-400', testId: 'not-a-number' })
      .expect(400);
  });
});

describe('PUT /api/test-plan-schedules/:id', () => {
  it('ignores a userId in the request body', async () => {
    const [plan] = await privilegedDb
      .insert(testPlans)
      .values({
        id: 'plan-for-schedule',
        name: 'Scheduled plan',
        userId: sessionUser.id,
        organizationId: sessionOrganizationId,
      })
      .returning();

    const [schedule] = await privilegedDb
      .insert(testPlanSchedules)
      .values({
        id: 'schedule-for-userid-test',
        testPlanId: plan.id,
        userId: sessionUser.id,
        organizationId: sessionOrganizationId,
        scheduleName: 'Nightly',
        frequency: 'daily@02:00',
        nextRunAt: new Date(),
      })
      .returning();

    await request(app)
      .put(`/api/test-plan-schedules/${schedule.id}`)
      .send({ scheduleName: 'Renamed', userId: foreignUser.id })
      .expect(200);

    // The owner decides who the scheduler runs the plan as, so it must not be wire-writable.
    const [stored] = await privilegedDb
      .select()
      .from(testPlanSchedules)
      .where(eq(testPlanSchedules.id, schedule.id));
    expect(stored.userId).toBe(sessionUser.id);
    expect(stored.scheduleName).toBe('Renamed');
  });
});

/**
 * C1-C4 from the final security review: legacy inline handlers in server/routes.ts that
 * queried with privilegedDb and no organization filter. Every one of these shipped because
 * no test exercised the production handler cross-tenant — RLS is silently inert under a
 * superuser, so the bug is invisible unless something actually asks "can org A reach org
 * B's row?" and checks the row afterwards, not just the status code.
 */

/** A minimal foreign test plan, owned by `foreignUser`/`foreignOrganizationId`. */
async function seedForeignPlan(id: string, name = 'Foreign plan') {
  const [plan] = await privilegedDb
    .insert(testPlans)
    .values({ id, name, userId: foreignUser.id, organizationId: foreignOrganizationId })
    .returning();
  return plan;
}

describe('GET /api/test-plan-schedules/plan/:planId (C1)', () => {
  it("does not return another organization's schedules for its plan", async () => {
    const foreignPlan = await seedForeignPlan('c1-foreign-plan');
    const [foreignSchedule] = await privilegedDb
      .insert(testPlanSchedules)
      .values({
        id: 'c1-foreign-schedule',
        testPlanId: foreignPlan.id,
        userId: foreignUser.id,
        organizationId: foreignOrganizationId,
        scheduleName: 'Foreign nightly run',
        frequency: 'daily@02:00',
        nextRunAt: new Date(),
      })
      .returning();

    // Not 404/403: this is a list endpoint. RLS makes the foreign schedule simply absent.
    const response = await request(app)
      .get(`/api/test-plan-schedules/plan/${foreignPlan.id}`)
      .expect(200);
    expect(response.body).toHaveLength(0);

    // Unchanged: the foreign row was never touched, only invisible to this session.
    const [stored] = await privilegedDb
      .select()
      .from(testPlanSchedules)
      .where(eq(testPlanSchedules.id, foreignSchedule.id));
    expect(stored.scheduleName).toBe('Foreign nightly run');
  });
});

describe('DELETE /api/test-plans/:id (C2)', () => {
  it("cannot delete another organization's plan", async () => {
    const foreignPlan = await seedForeignPlan('c2-foreign-plan');

    await request(app).delete(`/api/test-plans/${foreignPlan.id}`).expect(404);

    const [stored] = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, foreignPlan.id));
    expect(stored).toBeDefined();
    expect(stored.name).toBe('Foreign plan');
  });

  it('deletes a plan owned by the session organization', async () => {
    const [ownPlan] = await privilegedDb
      .insert(testPlans)
      .values({ id: 'c2-own-plan', name: 'Own plan', userId: sessionUser.id, organizationId: sessionOrganizationId })
      .returning();

    await request(app).delete(`/api/test-plans/${ownPlan.id}`).expect(204);

    const stored = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, ownPlan.id));
    expect(stored).toHaveLength(0);
  });
});

describe('POST /api/run-test-plan/:id (C3)', () => {
  it("cannot execute another organization's plan", async () => {
    const foreignPlan = await seedForeignPlan('c3-foreign-plan');

    await request(app).post(`/api/run-test-plan/${foreignPlan.id}`).expect(404);

    // The decisive assertion: the runner was never reached. Before the fix, runTestPlan
    // (and everything it kicks off downstream, all unfiltered privilegedDb queries) ran
    // against the foreign plan and stamped a new execution row with its organizationId.
    expect(runTestPlan).not.toHaveBeenCalled();
  });

  it('executes a plan owned by the session organization', async () => {
    const [ownPlan] = await privilegedDb
      .insert(testPlans)
      .values({ id: 'c3-own-plan', name: 'Own plan', userId: sessionUser.id, organizationId: sessionOrganizationId })
      .returning();

    await request(app).post(`/api/run-test-plan/${ownPlan.id}`).expect(200);

    expect(runTestPlan).toHaveBeenCalledWith(ownPlan.id, sessionUser.id);
  });
});

describe('GET /api/test-plan-executions/:executionId/logs (C4)', () => {
  it("does not return another organization's execution logs", async () => {
    const foreignPlan = await seedForeignPlan('c4-logs-foreign-plan');
    const [foreignExecution] = await privilegedDb
      .insert(testPlanExecutions)
      .values({ id: 'c4-foreign-execution', testPlanId: foreignPlan.id, organizationId: foreignOrganizationId })
      .returning();
    const [foreignLog] = await privilegedDb
      .insert(executionLogs)
      .values({
        testPlanExecutionId: foreignExecution.id,
        organizationId: foreignOrganizationId,
        level: 'info',
        source: 'system',
        message: 'substituted secret value for foreign org',
      })
      .returning();

    const response = await request(app)
      .get(`/api/test-plan-executions/${foreignExecution.id}/logs`)
      .expect(200);
    expect(response.body).toHaveLength(0);

    const [stored] = await privilegedDb.select().from(executionLogs).where(eq(executionLogs.id, foreignLog.id));
    expect(stored.message).toBe('substituted secret value for foreign org');
  });
});

describe('GET /api/test-plan-executions/:executionId/report (C4)', () => {
  it("404s on another organization's execution report and leaks nothing from it", async () => {
    const foreignPlan = await seedForeignPlan('c4-report-foreign-plan');
    const [foreignExecution] = await privilegedDb
      .insert(testPlanExecutions)
      .values({ id: 'c4-foreign-report-execution', testPlanId: foreignPlan.id, organizationId: foreignOrganizationId })
      .returning();
    const [foreignResult] = await privilegedDb
      .insert(reportTestCaseResults)
      .values({
        id: 'c4-foreign-result',
        testPlanExecutionId: foreignExecution.id,
        organizationId: foreignOrganizationId,
        testType: 'ui',
        testName: 'Foreign confidential test case',
        status: 'Passed',
        startedAt: new Date(),
      })
      .returning();

    const response = await request(app)
      .get(`/api/test-plan-executions/${foreignExecution.id}/report`)
      .expect(404);
    expect(response.body.error).toMatch(/not found/i);
    // The response body must not carry the foreign test name anywhere.
    expect(JSON.stringify(response.body)).not.toContain('Foreign confidential test case');

    const [stored] = await privilegedDb
      .select()
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.id, foreignResult.id));
    expect(stored.testName).toBe('Foreign confidential test case');
  });
});

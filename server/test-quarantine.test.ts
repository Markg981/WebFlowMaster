import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * Quarantine, as people set it and see it.
 *
 * What these hold: a quarantine needs a reason, and a test is in quarantine at most once at a
 * time; each change is audited; the list says what the test has done since, which is the evidence
 * for releasing it; releasing closes the period and keeps its history; a restricted project's
 * rules apply to its tests' quarantines; and no row can point at another organization's test.
 */

vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

const { privilegedDb } = await import('./db');
const schema = await import('@shared/schema');
const { apiTests, auditLog, projectMembers, projects, reportTestCaseResults, testPlanExecutions, testPlans, testQuarantines, tests, users } = schema;
const { createTestOrganization } = await import('./tests/factories');
const { tenancyMiddleware } = await import('./middleware/tenancy');
const { default: quarantineRoutes } = await import('./routes/quarantine.routes');
const { evidenceFrom, failuresOf } = await import('./test-quarantine');

type Person = { id: number; username: string; organizationId: number; role: string };
let app: express.Express;
let current: Person;
let org: number;
let editor: Person;

async function person(name: string, role: string, organizationId = org): Promise<Person> {
  const [row] = await privilegedDb.insert(users).values({ username: `${name}-${uuidv4().slice(0, 8)}`, password: 'x', organizationId, role }).returning();
  return { id: row.id, username: row.username, organizationId, role };
}

async function uiTest(name: string, organizationId = org, projectId: number | null = null) {
  const [row] = await privilegedDb
    .insert(tests)
    .values({ name, url: 'https://x.test', sequence: [], elements: [], userId: editor.id, organizationId, projectId } as any)
    .returning();
  return row.id;
}

const as = (who: Person) => {
  current = who;
  return request(app);
};

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = current;
    (req as any).isAuthenticated = () => true;
    next();
  });
  app.use(tenancyMiddleware);
  app.use(quarantineRoutes);
});

beforeEach(async () => {
  org = await createTestOrganization('Quarantine Org');
  editor = await person('editor', 'editor');
});

describe('the rules', () => {
  it('a run is decided by the failures of tests not in quarantine', () => {
    expect(
      failuresOf([
        { status: 'Passed' },
        { status: 'Failed', quarantined: true },
        { status: 'Error', quarantined: true },
        { status: 'Skipped', quarantined: true },
      ]),
    ).toEqual({ holding: 0, quarantined: 2 });
    expect(failuresOf([{ status: 'Failed', quarantined: true }, { status: 'Error' }])).toEqual({ holding: 1, quarantined: 1 });
  });

  it('the evidence counts back from the latest result, and a skip says nothing', () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 8, 23, 10, minute));
    expect(
      evidenceFrom([
        { status: 'Passed', startedAt: at(4) },
        { status: 'Failed', startedAt: at(1) },
        { status: 'Skipped', startedAt: at(5) },
        { status: 'Passed', startedAt: at(3) },
        { status: 'Passed', startedAt: at(2) },
      ]),
    ).toEqual({ runs: 4, passed: 3, failed: 1, passingStreak: 3, lastRunAt: at(4).toISOString(), lastStatus: 'Passed' });
    expect(evidenceFrom([])).toMatchObject({ runs: 0, passingStreak: 0, lastRunAt: null });
  });
});

describe('quarantining a test', () => {
  it('needs a reason, happens once at a time, and is audited', async () => {
    const testId = await uiTest('Checkout');
    await as(editor).post('/api/quarantine').send({ testType: 'ui', testId, reason: '  ' }).expect(400);

    const created = await as(editor).post('/api/quarantine').send({ testType: 'ui', testId, reason: 'Times out on the payment iframe' }).expect(201);
    expect(created.body).toMatchObject({ testId, reason: 'Times out on the payment iframe', releasedAt: null });

    const again = await as(editor).post('/api/quarantine').send({ testType: 'ui', testId, reason: 'Again' }).expect(409);
    expect(again.body.code).toBe('already_quarantined');

    const [entry] = await privilegedDb.select().from(auditLog).where(and(eq(auditLog.organizationId, org), eq(auditLog.action, 'test.quarantined')));
    expect(entry).toMatchObject({ targetType: 'test', targetId: String(testId), actorUserId: editor.id });
    expect(entry.metadata).toMatchObject({ name: 'Checkout', reason: 'Times out on the payment iframe' });
  });

  it('works for an API test too, and not for a test that does not exist', async () => {
    const [api] = await privilegedDb.insert(apiTests).values({ name: 'Orders', method: 'GET', url: 'https://x.test', userId: editor.id, organizationId: org } as any).returning();
    await as(editor).post('/api/quarantine').send({ testType: 'api', testId: api.id, reason: 'Rate limited' }).expect(201);
    await as(editor).post('/api/quarantine').send({ testType: 'ui', testId: 999_999, reason: 'x' }).expect(404);
  });

  it('is not for a viewer', async () => {
    const testId = await uiTest('Login');
    await as(await person('viewer', 'viewer')).post('/api/quarantine').send({ testType: 'ui', testId, reason: 'x' }).expect(403);
  });
});

describe('the quarantine list', () => {
  it('says what each test has done since it was set aside', async () => {
    const testId = await uiTest('Search');
    const created = await as(editor).post('/api/quarantine').send({ testType: 'ui', testId, reason: 'Flaky' }).expect(201);
    const since = new Date(created.body.quarantinedAt).getTime();

    const planId = uuidv4();
    await privilegedDb.insert(testPlans).values({ id: planId, name: 'Nightly', userId: editor.id, organizationId: org } as any);
    const executionId = uuidv4();
    await privilegedDb.insert(testPlanExecutions).values({ id: executionId, organizationId: org, testPlanId: planId, status: 'completed' } as any);
    const result = (status: string, offset: number) => ({
      id: uuidv4(), organizationId: org, testPlanExecutionId: executionId, uiTestId: testId, testType: 'ui', testName: 'Search',
      status, quarantined: true, startedAt: new Date(since + offset),
    });
    await privilegedDb.insert(reportTestCaseResults).values([
      // Before the quarantine: not evidence about it.
      { ...result('Failed', -60_000), quarantined: false },
      result('Failed', 1_000),
      result('Passed', 2_000),
      result('Passed', 3_000),
    ] as any);

    const list = await as(editor).get('/api/quarantine').expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        id: created.body.id,
        testType: 'ui',
        testId,
        testName: 'Search',
        reason: 'Flaky',
        quarantinedBy: editor.username,
        evidence: expect.objectContaining({ runs: 3, passed: 2, failed: 1, passingStreak: 2, lastStatus: 'Passed' }),
      }),
    ]);
  });
});

describe('releasing a test', () => {
  it('closes the period, keeps its history, and lets the test be quarantined again later', async () => {
    const testId = await uiTest('Cart');
    const first = await as(editor).post('/api/quarantine').send({ testType: 'ui', testId, reason: 'Race on add-to-cart' }).expect(201);

    const released = await as(editor).post(`/api/quarantine/${first.body.id}/release`).send({ note: 'Fixed the wait' }).expect(200);
    expect(released.body).toMatchObject({ releasedBy: editor.id, releaseNote: 'Fixed the wait' });
    expect(released.body.releasedAt).not.toBeNull();
    await as(editor).post(`/api/quarantine/${first.body.id}/release`).send({}).expect(409);
    expect((await as(editor).get('/api/quarantine').expect(200)).body).toEqual([]);

    await as(editor).post('/api/quarantine').send({ testType: 'ui', testId, reason: 'Back again' }).expect(201);
    const periods = await privilegedDb.select().from(testQuarantines).where(eq(testQuarantines.testId, testId));
    expect(periods).toHaveLength(2);

    const [entry] = await privilegedDb.select().from(auditLog).where(and(eq(auditLog.organizationId, org), eq(auditLog.action, 'test.quarantine_released')));
    expect(entry.metadata).toMatchObject({ quarantineId: first.body.id, reason: 'Race on add-to-cart', note: 'Fixed the wait' });
  });
});

describe('in a restricted project', () => {
  it("follows the test's project: a viewer sees it but cannot change it, an outsider does not see it", async () => {
    const [secret] = await privilegedDb.insert(projects).values({ name: 'Secret', userId: editor.id, organizationId: org, restricted: true }).returning();
    const testId = await uiTest('Payroll', org, secret.id);
    const member = await person('member', 'editor');
    const projectViewer = await person('project-viewer', 'editor');
    const outsider = await person('outsider', 'editor');
    await privilegedDb.insert(projectMembers).values([
      { projectId: secret.id, userId: member.id, organizationId: org, role: 'editor' },
      { projectId: secret.id, userId: projectViewer.id, organizationId: org, role: 'viewer' },
    ]);

    const refused = await as(projectViewer).post('/api/quarantine').send({ testType: 'ui', testId, reason: 'x' }).expect(403);
    expect(refused.body.code).toBe('project_read_only');
    await as(outsider).post('/api/quarantine').send({ testType: 'ui', testId, reason: 'x' }).expect(404);

    const created = await as(member).post('/api/quarantine').send({ testType: 'ui', testId, reason: 'Flaky' }).expect(201);
    expect((await as(projectViewer).get('/api/quarantine').expect(200)).body).toHaveLength(1);
    expect((await as(outsider).get('/api/quarantine').expect(200)).body).toEqual([]);
    await as(projectViewer).post(`/api/quarantine/${created.body.id}/release`).send({}).expect(403);
    await as(outsider).post(`/api/quarantine/${created.body.id}/release`).send({}).expect(404);
  });
});

describe('across organizations', () => {
  it('a quarantine cannot point at another organization\'s test, even written by privileged code', async () => {
    const otherOrg = await createTestOrganization('Other Org');
    const theirs = await uiTest('Theirs', otherOrg);
    await expect(
      privilegedDb.insert(testQuarantines).values({ organizationId: org, testType: 'ui', testId: theirs, reason: 'x' }),
    ).rejects.toThrow(/foreign key/i);
  });
});

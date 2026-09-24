import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * Suites, and the database refusing rows that point across organizations.
 *
 * What these hold: a static suite runs its tests in order and a dynamic one whatever carries its
 * tags when the run is created; a plan's run is its own tests then its suites', each test once;
 * that list is the same whoever presses Run; suites are checked, named uniquely and recorded; and
 * no code — not even the privileged handle — can link a row to another organization's.
 */

vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));
vi.mock('./queue', () => ({ TEST_EXECUTION_QUEUE_NAME: 'q', testExecutionQueue: { add: vi.fn() } }));

const { privilegedDb } = await import('./db');
const schema = await import('@shared/schema');
const { auditLog, environments, projectMembers, projects, secrets, tags, testPlanSelectedTests, testPlans, testTags, tests, users } = schema;
const { createTestOrganization } = await import('./tests/factories');
const { tenancyMiddleware } = await import('./middleware/tenancy');
const { default: suitesRoutes } = await import('./routes/suites.routes');
const { createExecutionOrchestrator } = await import('./execution-orchestrator');
const { readExecutionSnapshot } = await import('./execution-snapshot');

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
    .values({ name: `${name}-${uuidv4().slice(0, 6)}`, url: 'https://x.test', sequence: [], elements: [], userId: editor.id, organizationId, projectId } as any)
    .returning();
  return row.id;
}

async function tag(name: string) {
  const id = uuidv4();
  await privilegedDb.insert(tags).values({ id, organizationId: org, name });
  return id;
}

const tagTest = (tagId: string, testId: number) =>
  privilegedDb.insert(testTags).values({ organizationId: org, tagId, testId, testType: 'ui' });

const as = (who: Person) => {
  current = who;
  return request(app);
};

async function plan(direct: number[] = []) {
  const id = uuidv4();
  await privilegedDb.insert(testPlans).values({ id, name: `Plan ${id.slice(0, 4)}`, userId: editor.id, organizationId: org } as any);
  for (const testId of direct) {
    await privilegedDb.insert(testPlanSelectedTests).values({ testPlanId: id, testType: 'ui', testId, organizationId: org } as any);
  }
  return id;
}

async function runOf(planId: string, requester: Person) {
  const orchestrator = createExecutionOrchestrator({ add: async () => undefined });
  const execution = await orchestrator.enqueue({ planId, requestedByUserId: requester.id, trigger: 'api' });
  return readExecutionSnapshot(execution.configurationSnapshot)!.selectedTests.map((t: { testId: number | null }) => t.testId);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = current;
    (req as any).isAuthenticated = () => true;
    next();
  });
  app.use(tenancyMiddleware);
  app.use(suitesRoutes);
});

beforeEach(async () => {
  org = await createTestOrganization('Suites Org');
  editor = await person('editor', 'editor');
});

describe('a suite', () => {
  it('static: runs its tests in the order given, and says which plans include it', async () => {
    const [a, b] = [await uiTest('A'), await uiTest('B')];
    const created = await as(editor)
      .post('/api/suites')
      .send({ name: 'Checkout', kind: 'static', items: [{ type: 'ui', id: b }, { type: 'ui', id: a }, { type: 'ui', id: b }] })
      .expect(201);

    expect(created.body.tests.map((t: { id: number }) => t.id)).toEqual([b, a]);
    const planId = await plan();
    await as(editor).put(`/api/test-plans/${planId}/suites`).send({ suiteIds: [created.body.id] }).expect(200);
    const again = await as(editor).get(`/api/suites/${created.body.id}`).expect(200);
    expect(again.body.plans).toEqual([expect.objectContaining({ id: planId })]);
  });

  it('dynamic: whatever carries all its tags when it is read, and nothing without a rule', async () => {
    const [smoke, eu] = [await tag('smoke'), await tag('eu')];
    const both = await uiTest('Both');
    const onlySmoke = await uiTest('OnlySmoke');
    await tagTest(smoke, both);
    await tagTest(eu, both);
    await tagTest(smoke, onlySmoke);

    const created = await as(editor).post('/api/suites').send({ name: 'EU smoke', kind: 'dynamic', tagIds: [smoke, eu] }).expect(201);
    expect(created.body.tests.map((t: { id: number }) => t.id)).toEqual([both]);

    await tagTest(eu, onlySmoke);
    const later = await as(editor).get(`/api/suites/${created.body.id}`).expect(200);
    expect(later.body.tests).toHaveLength(2);

    await as(editor).post('/api/suites').send({ name: 'Empty rule', kind: 'dynamic', tagIds: [] }).expect(400);
  });

  it('is refused another organization\'s test or tag, a taken name, and a viewer', async () => {
    const elsewhere = await createTestOrganization('Elsewhere');
    const foreign = await uiTest('Foreign', elsewhere);
    await as(editor).post('/api/suites').send({ name: 'Sneaky', kind: 'static', items: [{ type: 'ui', id: foreign }] }).expect(400);
    await as(editor).post('/api/suites').send({ name: 'Sneaky', kind: 'dynamic', tagIds: ['no-such-tag'] }).expect(400);

    await as(editor).post('/api/suites').send({ name: 'Nightly', kind: 'static', items: [] }).expect(201);
    await as(editor).post('/api/suites').send({ name: 'nightly', kind: 'static', items: [] }).expect(409);

    const viewer = await person('viewer', 'viewer');
    await as(viewer).post('/api/suites').send({ name: 'Nope', kind: 'static', items: [] }).expect(403);
  });

  it('is recorded when created, changed and deleted, and leaves the plans that included it', async () => {
    const created = await as(editor).post('/api/suites').send({ name: 'Login', kind: 'static', items: [] }).expect(201);
    const planId = await plan();
    await as(editor).put(`/api/test-plans/${planId}/suites`).send({ suiteIds: [created.body.id] }).expect(200);
    await as(editor).put(`/api/suites/${created.body.id}`).send({ name: 'Sign-in', kind: 'static', items: [] }).expect(200);
    await as(editor).delete(`/api/suites/${created.body.id}`).expect(204);

    expect((await as(editor).get(`/api/test-plans/${planId}/suites`).expect(200)).body).toEqual([]);
    const actions = (await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, org))).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['suite.created', 'plan.suites_changed', 'suite.updated', 'suite.deleted']));
  });
});

describe('a run of a plan with suites', () => {
  it("is the plan's own tests, then each suite's, each test once", async () => {
    const [a, b, c] = [await uiTest('A'), await uiTest('B'), await uiTest('C')];
    const first = await as(editor).post('/api/suites').send({ name: 'First', kind: 'static', items: [{ type: 'ui', id: b }, { type: 'ui', id: c }] }).expect(201);
    const second = await as(editor).post('/api/suites').send({ name: 'Second', kind: 'static', items: [{ type: 'ui', id: a }, { type: 'ui', id: c }] }).expect(201);
    const planId = await plan([c]);
    await as(editor).put(`/api/test-plans/${planId}/suites`).send({ suiteIds: [second.body.id, first.body.id] }).expect(200);

    expect(await runOf(planId, editor)).toEqual([c, a, b]);
  });

  it('is the same whoever presses Run, restricted projects or not', async () => {
    const [{ id: secret }] = await privilegedDb.insert(projects).values({ name: 'Secret', userId: editor.id, organizationId: org, restricted: true }).returning();
    const hidden = await uiTest('Hidden', org, secret);
    const open = await uiTest('Open');
    const smoke = await tag('smoke');
    await tagTest(smoke, hidden);
    await tagTest(smoke, open);
    const suite = await as(editor).post('/api/suites').send({ name: 'Smoke', kind: 'dynamic', tagIds: [smoke] }).expect(201);
    const planId = await plan();
    await as(editor).put(`/api/test-plans/${planId}/suites`).send({ suiteIds: [suite.body.id] }).expect(200);

    // Through the tenancy middleware, as a request would: the editor is not on the project.
    let fromRequest: unknown[] = [];
    const runApp = express();
    runApp.use((req, _res, next) => {
      (req as any).user = editor;
      next();
    });
    runApp.use(tenancyMiddleware);
    runApp.get('/run', async (_req, res) => {
      fromRequest = await runOf(planId, editor);
      res.end();
    });
    await request(runApp).get('/run').expect(200);

    expect([...fromRequest].sort()).toEqual([hidden, open].sort());
  });
});

describe('rows that point across organizations', () => {
  it('cannot be written, even on the privileged handle', async () => {
    const elsewhere = await createTestOrganization('Elsewhere');
    const stranger = await person('stranger', 'editor', elsewhere);
    const theirTest = await uiTest('Theirs', elsewhere);
    const ourPlan = await plan();

    // A plan of ours selecting their test.
    await expect(
      privilegedDb.insert(testPlanSelectedTests).values({ testPlanId: ourPlan, testType: 'ui', testId: theirTest, organizationId: org } as any),
    ).rejects.toThrow(/foreign key/i);

    // A secret of ours in their environment.
    const [theirEnvironment] = await privilegedDb.insert(environments).values({ name: `env-${uuidv4()}`, userId: stranger.id, organizationId: elsewhere }).returning();
    await expect(
      privilegedDb.insert(secrets).values({ environmentId: theirEnvironment.id, keyName: 'K', encryptedValue: 'x', iv: 'x', authTag: 'x', userId: editor.id, organizationId: org } as any),
    ).rejects.toThrow(/foreign key/i);

    // One of their people on one of our projects.
    const [ours] = await privilegedDb.insert(projects).values({ name: 'Ours', userId: editor.id, organizationId: org }).returning();
    await expect(
      privilegedDb.insert(projectMembers).values({ projectId: ours.id, userId: stranger.id, organizationId: org, role: 'viewer' }),
    ).rejects.toThrow(/foreign key/i);

    // Nor can an existing link be moved across.
    const ourTest = await uiTest('Ours');
    const [link] = await privilegedDb.insert(testPlanSelectedTests).values({ testPlanId: ourPlan, testType: 'ui', testId: ourTest, organizationId: org } as any).returning();
    await expect(
      privilegedDb.update(testPlanSelectedTests).set({ testId: theirTest }).where(eq(testPlanSelectedTests.id, link.id)),
    ).rejects.toThrow(/foreign key/i);
  });

  it('still lets a parent be deleted, cascading or setting null as before', async () => {
    const [project] = await privilegedDb.insert(projects).values({ name: 'Doomed', userId: editor.id, organizationId: org }).returning();
    const testId = await uiTest('InProject', org, project.id);
    await privilegedDb.delete(projects).where(eq(projects.id, project.id));

    const [row] = await privilegedDb.select().from(tests).where(eq(tests.id, testId));
    expect(row.projectId).toBeNull();
  });

  it('are guarded on every link between two rows of an organization, and every guard is validated', async () => {
    const result = await privilegedDb.execute(sql`
      SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE '%_same_org_fk'
    `);
    const rows = result.rows as Array<{ conname: string; convalidated: boolean }>;
    // 42 from migration 0034, and the two a quarantine's test carries (0035).
    expect(rows.length).toBe(44);
    expect(rows.filter((r) => !r.convalidated)).toEqual([]);
  });

  it('covers a table added later only if somebody adds it: the known links are listed', async () => {
    // A drift check: every column referencing another organization-scoped table has its guard.
    const result = await privilegedDb.execute(sql`
      SELECT c.conrelid::regclass::text AS child, a.attname AS col, c.confrelid::regclass::text AS parent
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
        AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid AND x.attname = 'organization_id' AND NOT x.attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute y WHERE y.attrelid = c.confrelid AND y.attname = 'organization_id' AND NOT y.attisdropped)
        AND c.confrelid::regclass::text <> 'organizations'
    `);
    const guarded = new Set(
      ((await privilegedDb.execute(sql`SELECT conname FROM pg_constraint WHERE conname LIKE '%_same_org_fk'`)).rows as Array<{ conname: string }>).map((r) => r.conname),
    );
    // Links to users that are authorship, not ownership: a removed author does not make a row
    // cross-tenant. Named here so a new one is a decision, not an accident.
    const authorship = new Set([
      'projects.user_id', 'tests.user_id', 'api_test_history.user_id', 'api_tests.user_id', 'test_plans.user_id',
      'test_plan_schedules.user_id', 'environments.user_id', 'secrets.user_id', 'invitations.invited_by_user_id',
      'audit_log.actor_user_id', 'step_groups.user_id', 'test_versions.created_by', 'test_publications.published_by',
      'test_reviews.requested_by', 'test_reviews.decided_by', 'issue_trackers.created_by', 'test_suites.created_by',
      'test_quarantines.quarantined_by', 'test_quarantines.released_by', 'agents.created_by',
    ]);
    const unguarded = (result.rows as Array<{ child: string; col: string; parent: string }>)
      .map((r) => `${r.child}.${r.col}`)
      .filter((link) => !authorship.has(link) && !guarded.has(`${link.replace('.', '_')}_same_org_fk`));
    expect(unguarded).toEqual([]);
  });
});

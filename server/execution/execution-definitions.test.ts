import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * Same published version, same executable definition, same bundle (C04).
 *
 * A reviewed version keeps the step groups, shared elements and custom actions its review saw:
 * an edit to a group after the review — or after the run was queued — changes nothing the
 * version runs, and adopting the edit takes a new version. A queued run whose recorded inputs
 * are corrupt or in a format this server does not know is refused, never run from the live plan
 * or with live dependencies.
 */

vi.mock('../platform/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  },
  updateLogLevel: vi.fn(),
}));
vi.mock('../web/browser-tasks', () => ({
  browserTasks: {},
  BrowserTaskError: class extends Error {},
}));
vi.mock('../platform/queue', () => ({
  TEST_EXECUTION_QUEUE_NAME: 'q',
  testExecutionQueue: { add: vi.fn(async () => ({ id: 'job' })) },
}));
const executeTestSequence = vi.fn();
vi.mock('../web/playwright-service', () => ({
  playwrightService: { executeTestSequence: (...args: any[]) => executeTestSequence(...args) },
}));

const { privilegedDb } = await import('../platform/db');
const {
  customActions,
  stepGroups,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  testVersions,
  tests,
  users,
} = await import('@shared/schema');
const { createTestOrganization } = await import('../tests/factories');
const { tenancyMiddleware } = await import('../platform/middleware/tenancy');
const { default: testsRoutes } = await import('../http/routes/tests.routes');
const { default: publishingRoutes } = await import('../http/routes/test-publishing.routes');
const { processTestPlanJob } = await import('./test-execution-service');
const { createExecutionOrchestrator } = await import('./execution-orchestrator');
const { prepareSequence } = await import('../authoring/executable-definition');
const { reproducibilitySummary } = await import('./execution-provenance');

type Person = { id: number; username: string; organizationId: number; role: string };
let app: express.Express;
let current: Person;
let org: number;
let owner: Person;
let author: Person;
let reviewer: Person;

async function person(name: string, role: string): Promise<Person> {
  const [row] = await privilegedDb
    .insert(users)
    .values({
      username: `${name}-${uuidv4().slice(0, 8)}`,
      password: 'x',
      organizationId: org,
      role,
    })
    .returning();
  return { id: row.id, username: row.username, organizationId: org, role };
}
const as = (who: Person) => {
  current = who;
  return request(app);
};

const call = (groupId: string) => ({
  id: 'c1',
  action: { id: 'callGroup', name: 'Login' },
  value: groupId,
});
const click = (selector: string) => ({
  id: 'k',
  action: { id: 'click', name: 'Click' },
  targetElement: { selector },
});

async function newGroup(selector: string) {
  const id = uuidv4();
  await privilegedDb.insert(stepGroups).values({
    id,
    organizationId: org,
    userId: author.id,
    name: 'Login',
    sequence: [click(selector)],
  });
  return id;
}
const editGroup = (id: string, selector: string) =>
  privilegedDb
    .update(stepGroups)
    .set({ sequence: [click(selector)] })
    .where(eq(stepGroups.id, id));

async function newTest(sequence: unknown[]) {
  const created = await as(author)
    .post('/api/tests')
    .send({
      name: `Checkout ${uuidv4().slice(0, 6)}`,
      url: 'https://shop.test',
      sequence,
      elements: [],
    })
    .expect(201);
  return created.body.id as number;
}

async function planOf(testId: number) {
  const planId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'Nightly', userId: owner.id, organizationId: org } as any);
  await privilegedDb
    .insert(testPlanSelectedTests)
    .values({ testPlanId: planId, testType: 'ui', testId, organizationId: org } as any);
  return planId;
}
const enqueue = (planId: string) =>
  createExecutionOrchestrator({
    add: async (_n: string, _d: unknown, o: { jobId: string }) => ({ id: o.jobId }),
  } as any).enqueue({
    planId,
    requestedByUserId: owner.id,
    trigger: 'manual',
  });

/** The selectors the runner would execute, from what it was handed — no live read in between. */
async function executedSelectors(): Promise<string[]> {
  expect(executeTestSequence).toHaveBeenCalled();
  const [test, , , , , , options] = executeTestSequence.mock.calls.at(-1)!;
  expect(options.dependencies).toBeDefined();
  const prepared = await prepareSequence(test.sequence, options.dependencies);
  expect(prepared.errors).toEqual([]);
  return prepared.steps.map((step) => (step.targetElement as { selector: string }).selector);
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
  app.use(testsRoutes);
  app.use(publishingRoutes);
});

beforeEach(async () => {
  org = await createTestOrganization('Frozen Definitions Org');
  owner = await person('owner', 'owner');
  author = await person('author', 'editor');
  reviewer = await person('reviewer', 'editor');
  executeTestSequence.mockReset();
  executeTestSequence.mockResolvedValue({ success: true, steps: [], duration: 5 });
});

describe('a reviewed version', () => {
  it('runs the dependencies its review saw: save v1, request review, edit the group, approve, run', async () => {
    const login = await newGroup('#v1-login');
    const testId = await newTest([call(login)]);
    await as(owner)
      .put('/api/organization/test-review-policy')
      .send({ required: true })
      .expect(200);
    const review = await as(author).post(`/api/tests/${testId}/reviews`).send({}).expect(201);

    await editGroup(login, '#edited-after-review');
    await as(reviewer).post(`/api/test-reviews/${review.body.id}/approve`).send({}).expect(200);

    const execution = await enqueue(await planOf(testId));
    await editGroup(login, '#edited-after-enqueue');
    await processTestPlanJob(execution.planId ?? execution.testPlanId, execution.id, owner.id);

    expect(await executedSelectors()).toEqual(['#v1-login']);
    const provenance = reproducibilitySummary(execution.configurationSnapshot).provenance!;
    expect(provenance.definitions[0]).toMatchObject({
      version: 1,
      source: 'published',
      dependencies: { origin: 'version', groups: 1 },
    });
  });

  it('adopts a dependency update only through a new version', async () => {
    const login = await newGroup('#v1-login');
    const testId = await newTest([call(login)]);
    await as(author).post(`/api/tests/${testId}/publish`).send({}).expect(200);
    await editGroup(login, '#v2-login');

    // Re-saving the unchanged test records the group change as version 2.
    await as(author)
      .put(`/api/tests/${testId}`)
      .send({ sequence: [call(login)] })
      .expect(200);
    const versions = await privilegedDb
      .select()
      .from(testVersions)
      .where(eq(testVersions.testId, testId));
    expect(versions.map((v) => [v.version, v.summary])).toEqual([
      [1, 'Created with 1 step.'],
      [2, 'Step group "Login" changed.'],
    ]);

    const planId = await planOf(testId);
    await processTestPlanJob(planId, (await enqueue(planId)).id, owner.id);
    expect(await executedSelectors()).toEqual(['#v1-login']);

    await as(author).post(`/api/tests/${testId}/publish`).send({ version: 2 }).expect(200);
    await processTestPlanJob(planId, (await enqueue(planId)).id, owner.id);
    expect(await executedSelectors()).toEqual(['#v2-login']);
  });

  it('with an unsupported or corrupt bundle fails explicitly, never as the working copy', async () => {
    const login = await newGroup('#v1-login');
    const testId = await newTest([call(login)]);
    await as(author).post(`/api/tests/${testId}/publish`).send({}).expect(200);
    const planId = await planOf(testId);

    for (const [snapshot, expected] of [
      [{ executable: { protocol: 7, dependencies: {} } }, /format 7/],
      [{ executable: { protocol: 1, dependencies: { protocol: 1 } } }, /unreadable/],
    ] as const) {
      // app_user may not rewrite a history; the database owner may, which is what this simulates.
      await privilegedDb
        .update(testVersions)
        .set({ snapshot })
        .where(eq(testVersions.testId, testId));
      executeTestSequence.mockClear();
      await processTestPlanJob(planId, (await enqueue(planId)).id, owner.id);
      const [, , , , , , options] = executeTestSequence.mock.calls.at(-1)!;
      const prepared = await prepareSequence([call(login)], options.dependencies);
      expect(prepared.steps).toEqual([]);
      expect(prepared.errors[0]).toMatch(expected);
    }
  });
});

describe('a working copy', () => {
  it('runs the dependencies captured at enqueue, after live edits and deletions', async () => {
    const login = await newGroup('#queued');
    const seed = uuidv4();
    await privilegedDb.insert(customActions).values({
      id: seed,
      organizationId: org,
      userId: author.id,
      name: 'Seed',
      script: 'return 1',
    });
    const testId = await newTest([
      call(login),
      { id: 's', action: { id: `customAction:${seed}`, name: 'Seed' }, value: '' },
    ]);
    const planId = await planOf(testId);
    const execution = await enqueue(planId);

    await privilegedDb.delete(stepGroups).where(eq(stepGroups.id, login));
    await privilegedDb.delete(customActions).where(eq(customActions.id, seed));
    await processTestPlanJob(planId, execution.id, owner.id);

    const [test, , , , , , options] = executeTestSequence.mock.calls.at(-1)!;
    const prepared = await prepareSequence(test.sequence, options.dependencies);
    expect(prepared.errors).toEqual([]);
    expect(prepared.steps.map((s) => s.action?.id)).toEqual(['click', 'executeScript']);
    expect(options.dependencies.origin).toBe('enqueue');
  });
});

describe('a queued run the worker cannot read', () => {
  async function queuedWith(configurationSnapshot: unknown) {
    const testId = await newTest([click('#x')]);
    const planId = await planOf(testId);
    const execution = await enqueue(planId);
    await privilegedDb
      .update(testPlanExecutions)
      .set({ configurationSnapshot })
      .where(eq(testPlanExecutions.id, execution.id));
    await processTestPlanJob(planId, execution.id, owner.id);
    const [row] = await privilegedDb
      .select()
      .from(testPlanExecutions)
      .where(eq(testPlanExecutions.id, execution.id));
    return { row, execution };
  }

  it('is refused for an unsupported configuration version, not run from the live plan', async () => {
    const { row } = await queuedWith({ version: 2, selectedTests: [], plan: {} });
    expect(executeTestSequence).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'error', failureCode: 'unsupported_snapshot' });
  });

  it('is refused for a corrupt configuration', async () => {
    const { row } = await queuedWith({ version: 1 });
    expect(executeTestSequence).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'error', failureCode: 'corrupt_snapshot' });
  });

  it('is refused for an unknown definitions format or an altered bundle', async () => {
    const testId = await newTest([call(await newGroup('#queued'))]);
    const planId = await planOf(testId);
    for (const alter of [
      (s: any) => (s.definitions.version = 3),
      (s: any) => (s.definitions.ui[0].dependencies.bundle.groups[0].sequence = [click('#evil')]),
    ]) {
      const execution = await enqueue(planId);
      const snapshot = structuredClone(execution.configurationSnapshot) as any;
      alter(snapshot);
      await privilegedDb
        .update(testPlanExecutions)
        .set({ configurationSnapshot: snapshot })
        .where(eq(testPlanExecutions.id, execution.id));
      await processTestPlanJob(planId, execution.id, owner.id);
      const [row] = await privilegedDb
        .select()
        .from(testPlanExecutions)
        .where(eq(testPlanExecutions.id, execution.id));
      expect(row).toMatchObject({ status: 'error', failureCode: 'unusable_snapshot' });
    }
    expect(executeTestSequence).not.toHaveBeenCalled();
  });

  it('still runs a legacy run with no snapshot from the plan, as before', async () => {
    const { row } = await queuedWith({});
    expect(executeTestSequence).toHaveBeenCalledTimes(1);
    expect(row.failureCode).toBeNull();
    const [, , , , , , options] = executeTestSequence.mock.calls[0];
    expect(options.dependencies).toBeUndefined();
  });
});

// Keep the tests table referenced for readers: rows here are real tests saved through the API.
void tests;

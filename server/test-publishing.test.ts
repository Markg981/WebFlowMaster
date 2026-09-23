import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { asc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * A saved test is a working copy; plans run what was published.
 *
 * What these hold: publishing, rolling back and unpublishing move the version plans run, and
 * each leaves a line in the publication history; saving cannot set it; under the review policy
 * nobody publishes their own change, a rejection says why, and a test never published is
 * skipped by a plan instead of run unreviewed; and a plan run executes the published steps even
 * while the working copy has moved on.
 */

vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));
vi.mock('./browser-tasks', () => ({ browserTasks: {}, BrowserTaskError: class extends Error {} }));
vi.mock('./queue', () => ({ TEST_EXECUTION_QUEUE_NAME: 'q', testExecutionQueue: { add: vi.fn() } }));
const executeTestSequence = vi.fn();
vi.mock('./playwright-service', () => ({
  playwrightService: { executeTestSequence: (...args: any[]) => executeTestSequence(...args) },
}));

const { privilegedDb } = await import('./db');
const { auditLog, reportTestCaseResults, testPlanExecutions, testPlanSelectedTests, testPlans, testPublications, tests, users } = await import('@shared/schema');
const { createTestOrganization } = await import('./tests/factories');
const { tenancyMiddleware } = await import('./middleware/tenancy');
const { default: testsRoutes } = await import('./routes/tests.routes');
const { default: publishingRoutes } = await import('./routes/test-publishing.routes');
const { processTestPlanJob } = await import('./test-execution-service');

type Person = { id: number; username: string; organizationId: number; role: string };
let app: express.Express;
let current: Person;
let org: number;
let owner: Person;
let author: Person;
let reviewer: Person;

async function person(name: string, role: string): Promise<Person> {
  const [row] = await privilegedDb.insert(users).values({ username: `${name}-${uuidv4().slice(0, 8)}`, password: 'x', organizationId: org, role }).returning();
  return { id: row.id, username: row.username, organizationId: org, role };
}

const as = (who: Person) => {
  current = who;
  return request(app);
};

/** A test at version 1, saved by the author. */
async function newTest(steps = [{ id: 's1', action: 'click' }]) {
  const created = await as(author)
    .post('/api/tests')
    .send({ name: `Checkout ${uuidv4().slice(0, 6)}`, url: 'https://shop.test', sequence: steps, elements: [] })
    .expect(201);
  return created.body.id as number;
}

const edit = (testId: number, steps: unknown[]) => as(author).put(`/api/tests/${testId}`).send({ sequence: steps }).expect(200);
const state = async (testId: number) => (await as(author).get(`/api/tests/${testId}/publishing`).expect(200)).body;
const requireReview = (required: boolean) => as(owner).put('/api/organization/test-review-policy').send({ required }).expect(200);

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
  org = await createTestOrganization('Publishing Org');
  owner = await person('owner', 'owner');
  author = await person('author', 'editor');
  reviewer = await person('reviewer', 'editor');
  executeTestSequence.mockReset();
  executeTestSequence.mockResolvedValue({ success: true, steps: [{ name: 'Click', type: 'click', status: 'passed' }], duration: 5 });
});

describe('publishing', () => {
  it('points plans at a version, and leaves the working copy free to move on', async () => {
    const testId = await newTest();
    expect(await state(testId)).toMatchObject({ publishedVersion: null, latestVersion: 1, runs: 'working_copy' });

    await as(author).post(`/api/tests/${testId}/publish`).send({}).expect(200);
    await edit(testId, [{ id: 's1', action: 'click' }, { id: 's2', action: 'type' }]);

    expect(await state(testId)).toMatchObject({ publishedVersion: 1, latestVersion: 2, runs: 'published', hasUnpublishedChanges: true });
  });

  it('cannot be done by saving the test', async () => {
    const testId = await newTest();
    await as(author).put(`/api/tests/${testId}`).send({ publishedVersion: 1, name: 'Renamed' }).expect(200);

    const [row] = await privilegedDb.select().from(tests).where(eq(tests.id, testId));
    expect(row.publishedVersion).toBeNull();
  });

  it('rolls back only to a version that was live before, and keeps the whole history', async () => {
    const testId = await newTest();
    await as(author).post(`/api/tests/${testId}/publish`).send({}).expect(200);
    await edit(testId, [{ id: 's1', action: 'click' }, { id: 'v2', action: 'type' }]);

    const never = await as(author).post(`/api/tests/${testId}/rollback`).send({ version: 2 }).expect(409);
    expect(never.body.code).toBe('never_published');

    await as(author).post(`/api/tests/${testId}/publish`).send({ version: 2 }).expect(200);
    const back = await as(author).post(`/api/tests/${testId}/rollback`).send({ version: 1 }).expect(200);
    expect(back.body).toMatchObject({ publishedVersion: 1, rollbackTargets: [2] });

    await as(author).post(`/api/tests/${testId}/unpublish`).expect(200);
    const history = await privilegedDb.select().from(testPublications).where(eq(testPublications.testId, testId)).orderBy(asc(testPublications.id));
    expect(history.map((p) => [p.kind, p.version])).toEqual([['publish', 1], ['publish', 2], ['rollback', 1], ['unpublish', null]]);

    const trail = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, org));
    expect(trail.map((e) => e.action)).toEqual(expect.arrayContaining(['test.published', 'test.rolled_back', 'test.unpublished']));
  });
});

describe('under the review policy', () => {
  it('refuses a direct publication, and publishes on another member\'s approval', async () => {
    const testId = await newTest();
    await requireReview(true);

    const direct = await as(author).post(`/api/tests/${testId}/publish`).send({}).expect(409);
    expect(direct.body.code).toBe('review_required');

    const review = await as(author).post(`/api/tests/${testId}/reviews`).send({ note: 'New checkout flow' }).expect(201);
    await as(author).post(`/api/tests/${testId}/reviews`).send({}).expect(409);

    const queue = await as(reviewer).get('/api/test-reviews').expect(200);
    expect(queue.body).toEqual([expect.objectContaining({ id: review.body.id, testId, version: 1, note: 'New checkout flow', canDecide: true })]);
    const own = await as(author).get('/api/test-reviews').expect(200);
    expect(own.body[0].canDecide).toBe(false);

    const selfApproval = await as(author).post(`/api/test-reviews/${review.body.id}/approve`).send({}).expect(403);
    expect(selfApproval.body.code).toBe('own_change');

    await as(reviewer).post(`/api/test-reviews/${review.body.id}/approve`).send({ comment: 'Looks right' }).expect(200);
    expect(await state(testId)).toMatchObject({ publishedVersion: 1, pendingReview: null });
    await as(reviewer).post(`/api/test-reviews/${review.body.id}/approve`).send({}).expect(409);
  });

  it('wants a reason to reject, and lets only the asker withdraw', async () => {
    const testId = await newTest();
    await requireReview(true);
    const review = await as(author).post(`/api/tests/${testId}/reviews`).send({}).expect(201);

    await as(reviewer).post(`/api/test-reviews/${review.body.id}/reject`).send({}).expect(400);
    await as(reviewer).post(`/api/test-reviews/${review.body.id}/withdraw`).expect(403);
    await as(reviewer).post(`/api/test-reviews/${review.body.id}/reject`).send({ comment: 'Step 3 clicks the wrong button' }).expect(200);

    const again = await as(author).post(`/api/tests/${testId}/reviews`).send({}).expect(201);
    await as(author).post(`/api/test-reviews/${again.body.id}/withdraw`).expect(200);
    expect(await state(testId)).toMatchObject({ publishedVersion: null, runs: 'nothing' });
  });

  it('still allows a rollback, and refuses to unpublish', async () => {
    const testId = await newTest();
    await as(author).post(`/api/tests/${testId}/publish`).send({}).expect(200);
    await edit(testId, [{ id: 's1', action: 'click' }, { id: 'v2', action: 'type' }]);
    await as(author).post(`/api/tests/${testId}/publish`).send({}).expect(200);
    await requireReview(true);

    await as(author).post(`/api/tests/${testId}/rollback`).send({ version: 1 }).expect(200);
    const refused = await as(author).post(`/api/tests/${testId}/unpublish`).expect(409);
    expect(refused.body.code).toBe('review_required');
  });

  it('is changed by owners only, and recorded', async () => {
    await as(author).put('/api/organization/test-review-policy').send({ required: true }).expect(403);
    await requireReview(true);
    const [entry] = await privilegedDb.select().from(auditLog).where(eq(auditLog.action, 'test_review.policy_changed'));
    expect(entry).toBeTruthy();
  });
});

describe('a plan run', () => {
  async function runPlanOf(testIds: number[]) {
    const planId = uuidv4();
    await privilegedDb.insert(testPlans).values({ id: planId, name: 'Nightly', userId: owner.id, organizationId: org } as any);
    for (const testId of testIds) {
      await privilegedDb.insert(testPlanSelectedTests).values({ testPlanId: planId, testType: 'ui', testId, organizationId: org } as any);
    }
    const executionId = uuidv4();
    await privilegedDb.insert(testPlanExecutions).values({ id: executionId, organizationId: org, testPlanId: planId, status: 'queued', triggeredBy: 'manual' } as any);
    await processTestPlanJob(planId, executionId, owner.id);
    return privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
  }

  it('executes the published steps while the working copy has moved on, and says which version', async () => {
    const testId = await newTest([{ id: 'published-step', action: 'click' }]);
    await as(author).post(`/api/tests/${testId}/publish`).send({}).expect(200);
    await edit(testId, [{ id: 'half-finished', action: 'click' }]);

    const [result] = await runPlanOf([testId]);

    expect(executeTestSequence).toHaveBeenCalledTimes(1);
    expect(executeTestSequence.mock.calls[0][0].sequence).toEqual([{ id: 'published-step', action: 'click' }]);
    expect(result.testVersion).toBe(1);
  });

  it('runs the working copy of a test never published, as before', async () => {
    const testId = await newTest([{ id: 'working', action: 'click' }]);
    await runPlanOf([testId]);
    expect(executeTestSequence.mock.calls[0][0].sequence).toEqual([{ id: 'working', action: 'click' }]);
  });

  it('skips a test never published where review is required, and says why', async () => {
    const published = await newTest([{ id: 'ok' }]);
    await as(author).post(`/api/tests/${published}/publish`).send({}).expect(200);
    const unreviewed = await newTest([{ id: 'unreviewed' }]);
    await requireReview(true);

    const results = await runPlanOf([published, unreviewed]);

    expect(executeTestSequence).toHaveBeenCalledTimes(1);
    const skipped = results.find((r) => r.uiTestId === unreviewed)!;
    expect(skipped.status).toBe('Skipped');
    expect(skipped.reasonForFailure).toMatch(/Not published/);
  });
});

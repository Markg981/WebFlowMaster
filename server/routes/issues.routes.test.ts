import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from '../db';
import { issueLinks, issueTrackers, reportTestCaseResults } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { encryptSecret } from '../crypto';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

const createIssue = vi.fn();
const addComment = vi.fn();
const checkConnection = vi.fn();

vi.mock('../issue-providers', () => ({
  createIssue: (...args: any[]) => createIssue(...args),
  addComment: (...args: any[]) => addComment(...args),
  checkConnection: (...args: any[]) => checkConnection(...args),
  normaliseBaseUrl: (url: string) => url,
}));

/**
 * Where a failure goes once somebody has to do something about it.
 *
 * Two properties carry the feature. The token never comes back out of the server — not even
 * masked — and the same failure filed twice is a comment rather than a second issue. The rest
 * is about being honest when the other system says no: a refusal from Jira is not this
 * application's error to report as its own.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };
let trackerId: string;
let failedResultId: string;
let passedResultId: string;

const PLAN_ID = 'plan-issues';
const EXECUTION_ID = 'exec-issues';

async function seedTracker(name = 'Jira', org = organizationId) {
  const encrypted = encryptSecret('token-123');
  const [row] = await privilegedDb
    .insert(issueTrackers)
    .values({
      id: uuidv4(),
      organizationId: org,
      name,
      provider: 'jira',
      baseUrl: 'https://acme.atlassian.net',
      projectKey: 'SHOP',
      issueType: 'Bug',
      userEmail: 'qa@acme.test',
      encryptedToken: encrypted.encryptedValue,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
    })
    .returning();
  return row;
}

beforeAll(async () => {
  organizationId = await createTestOrganization('Issue Routes Org');
  userId = await createTestUser(organizationId, 'issue-routes-user');
  otherOrganizationId = await createTestOrganization('Other Issue Routes Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-issue-routes-user');

  const { default: trackerRoutes } = await import('./issue-trackers.routes');
  const { default: issuesRoutes } = await import('./issues.routes');
  const { runWithTenant } = await import('../middleware/tenancy');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(trackerRoutes);
  app.use(issuesRoutes);
});

beforeEach(async () => {
  createIssue.mockReset().mockResolvedValue({ key: 'SHOP-412', url: 'https://acme.atlassian.net/browse/SHOP-412' });
  addComment.mockReset().mockResolvedValue(undefined);
  checkConnection.mockReset().mockResolvedValue({ ok: true, detail: 'Connected to Shop.' });

  await privilegedDb.delete(issueLinks);
  await privilegedDb.delete(reportTestCaseResults);
  await privilegedDb.delete(issueTrackers);
  await privilegedDb.execute(sql`DELETE FROM test_plan_executions`);
  await privilegedDb.execute(sql`DELETE FROM test_plans`);

  currentUser = { id: userId, username: 'issue-routes-user', organizationId, role: 'editor' };

  await privilegedDb.execute(
    sql`INSERT INTO test_plans (id, name, user_id, organization_id) VALUES (${PLAN_ID}, 'Nightly', ${userId}, ${organizationId})`,
  );
  await privilegedDb.execute(
    sql`INSERT INTO test_plan_executions (id, test_plan_id, organization_id, status, started_at)
        VALUES (${EXECUTION_ID}, ${PLAN_ID}, ${organizationId}, 'failed', ${new Date()})`,
  );

  failedResultId = uuidv4();
  passedResultId = uuidv4();
  await privilegedDb.insert(reportTestCaseResults).values([
    {
      id: failedResultId,
      testPlanExecutionId: EXECUTION_ID,
      organizationId,
      testType: 'ui',
      testName: 'Checkout',
      browser: 'chromium',
      status: 'Failed',
      testVersion: 7,
      reasonForFailure: 'Timed out waiting for #pay',
      startedAt: new Date(),
    },
    {
      id: passedResultId,
      testPlanExecutionId: EXECUTION_ID,
      organizationId,
      testType: 'ui',
      testName: 'Login',
      browser: 'chromium',
      status: 'Passed',
      startedAt: new Date(),
    },
  ]);

  trackerId = (await seedTracker()).id;
});

describe('issue trackers', () => {
  it('never answers with the token, in any shape', async () => {
    // Not even masked: a mask still leaks length, and nothing here needs either.
    const response = await request(app).get('/api/issue-trackers').expect(200);

    expect(response.body[0]).toMatchObject({ name: 'Jira', provider: 'jira', authenticatesAs: 'qa@acme.test' });
    expect(JSON.stringify(response.body)).not.toContain('token-123');
    expect(Object.keys(response.body[0])).not.toContain('encryptedToken');
  });

  it('refuses a Jira tracker with no account for the token to belong to', async () => {
    const response = await request(app)
      .post('/api/issue-trackers')
      .send({ name: 'Jira 2', provider: 'jira', baseUrl: 'https://acme.atlassian.net', projectKey: 'SHOP', token: 'x' })
      .expect(400);

    expect(response.body.error).toContain('email');
  });

  it('stores an Azure DevOps tracker, which needs no email', async () => {
    await request(app)
      .post('/api/issue-trackers')
      .send({ name: 'ADO', provider: 'azure_devops', baseUrl: 'https://dev.azure.com/acme', projectKey: 'Platform', token: 'pat' })
      .expect(201);

    const rows = await privilegedDb.select().from(issueTrackers);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.encryptedToken !== 'pat')).toBe(true);
  });

  it('keeps the stored token when an edit does not carry a new one', async () => {
    // An edit form cannot show the current token, so leaving the field empty has to mean
    // "leave it alone" rather than "set it to nothing".
    const before = (await privilegedDb.select().from(issueTrackers))[0];

    await request(app).put(`/api/issue-trackers/${trackerId}`).send({ projectKey: 'SHOP2' }).expect(200);

    const after = (await privilegedDb.select().from(issueTrackers))[0];
    expect(after.projectKey).toBe('SHOP2');
    expect(after.encryptedToken).toBe(before.encryptedToken);
  });

  it('checks the connection by reading, never by filing something', async () => {
    const response = await request(app).post(`/api/issue-trackers/${trackerId}/test`).expect(200);

    expect(response.body).toEqual({ ok: true, detail: 'Connected to Shop.' });
    expect(createIssue).not.toHaveBeenCalled();
  });

  it('is not visible to another organization', async () => {
    currentUser = { id: otherUserId, username: 'other-issue-routes-user', organizationId: otherOrganizationId, role: 'owner' };

    expect((await request(app).get('/api/issue-trackers').expect(200)).body).toEqual([]);
    await request(app).post(`/api/issue-trackers/${trackerId}/test`).expect(404);
    await request(app).delete(`/api/issue-trackers/${trackerId}`).expect(404);
  });

  it('refuses a second tracker with the same name', async () => {
    await request(app)
      .post('/api/issue-trackers')
      .send({ name: 'JIRA', provider: 'jira', baseUrl: 'https://acme.atlassian.net', projectKey: 'S', token: 'x', userEmail: 'a@b.test' })
      .expect(409);
  });
});

describe('POST /api/issues', () => {
  it('files the failure and answers with where it went', async () => {
    const response = await request(app)
      .post('/api/issues')
      .send({ executionId: EXECUTION_ID, testCaseResultId: failedResultId })
      .expect(200);

    expect(response.body).toMatchObject({ action: 'created', issueKey: 'SHOP-412' });
    expect(createIssue).toHaveBeenCalledTimes(1);
    const draft = createIssue.mock.calls[0][1];
    expect(draft.title).toContain('Checkout');
    expect(draft.body).toContain('Timed out waiting for #pay');
    // Which version of the test failed, because that is the first thing a reader needs in
    // order to tell a broken application from a changed test.
    expect(draft.body).toContain('Test version: 7');
  });

  it('comments instead of filing the same failure twice', async () => {
    await request(app).post('/api/issues').send({ executionId: EXECUTION_ID, testCaseResultId: failedResultId }).expect(200);

    const second = await request(app)
      .post('/api/issues')
      .send({ executionId: EXECUTION_ID, testCaseResultId: failedResultId })
      .expect(200);

    expect(second.body).toMatchObject({ action: 'commented', occurrences: 2 });
    expect(createIssue).toHaveBeenCalledTimes(1);
    expect(await privilegedDb.select().from(issueLinks)).toHaveLength(1);
  });

  it('refuses to file a test that passed', async () => {
    const response = await request(app)
      .post('/api/issues')
      .send({ executionId: EXECUTION_ID, testCaseResultId: passedResultId })
      .expect(400);

    expect(response.body.error).toContain('did not fail');
    expect(createIssue).not.toHaveBeenCalled();
  });

  it('asks which tracker when there is more than one and nothing says', async () => {
    await seedTracker('Second');

    const response = await request(app)
      .post('/api/issues')
      .send({ executionId: EXECUTION_ID, testCaseResultId: failedResultId })
      .expect(400);

    expect(response.body.trackers).toHaveLength(2);
  });

  it('uses the tracker the plan names', async () => {
    const second = await seedTracker('Second');
    await privilegedDb.execute(
      sql`UPDATE test_plans SET issue_tracker_id = ${second.id} WHERE id = ${PLAN_ID}`,
    );

    const response = await request(app)
      .post('/api/issues')
      .send({ executionId: EXECUTION_ID, testCaseResultId: failedResultId })
      .expect(200);

    expect(response.body.tracker.name).toBe('Second');
  });

  it('answers 502 when the tracker refused, not 500', async () => {
    // The fault is in the other system, and a 500 would send somebody looking for it here.
    createIssue.mockRejectedValue(new Error('Creating the Jira issue failed (403): no permission'));

    const response = await request(app)
      .post('/api/issues')
      .send({ executionId: EXECUTION_ID, testCaseResultId: failedResultId })
      .expect(502);

    expect(response.body.error).toContain('403');
  });

  it('cannot file another organization’s failure', async () => {
    currentUser = { id: otherUserId, username: 'other-issue-routes-user', organizationId: otherOrganizationId, role: 'owner' };

    await request(app)
      .post('/api/issues')
      .send({ executionId: EXECUTION_ID, testCaseResultId: failedResultId })
      .expect(404);
  });

  it('is closed to a viewer', async () => {
    currentUser = { id: userId, username: 'issue-routes-user', organizationId, role: 'viewer' };

    await request(app)
      .post('/api/issues')
      .send({ executionId: EXECUTION_ID, testCaseResultId: failedResultId })
      .expect(403);
  });
});

describe('GET /api/test-plan-executions/:executionId/issues', () => {
  it('shows what this run’s failures already have', async () => {
    await request(app).post('/api/issues').send({ executionId: EXECUTION_ID, testCaseResultId: failedResultId }).expect(200);

    const response = await request(app).get(`/api/test-plan-executions/${EXECUTION_ID}/issues`).expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ issueKey: 'SHOP-412', testName: 'Checkout' });
  });

  it('includes an issue opened by an earlier run of the same failure', async () => {
    // A report that only knew about issues filed from itself would invite the duplicate the
    // whole feature exists to prevent.
    await privilegedDb.execute(
      sql`INSERT INTO test_plan_executions (id, test_plan_id, organization_id, status, started_at)
          VALUES ('exec-older', ${PLAN_ID}, ${organizationId}, 'failed', ${new Date()})`,
    );
    await privilegedDb.insert(issueLinks).values({
      organizationId,
      trackerId,
      dedupeKey: `${PLAN_ID}::Checkout::chromium`,
      testPlanId: PLAN_ID,
      testName: 'Checkout',
      browser: 'chromium',
      issueKey: 'SHOP-99',
      issueUrl: 'https://acme.atlassian.net/browse/SHOP-99',
      firstExecutionId: 'exec-older',
      lastExecutionId: 'exec-older',
    });

    const response = await request(app).get(`/api/test-plan-executions/${EXECUTION_ID}/issues`).expect(200);

    expect(response.body[0].issueKey).toBe('SHOP-99');
  });

  it('is empty, not an error, when nothing has been filed', async () => {
    const response = await request(app).get(`/api/test-plan-executions/${EXECUTION_ID}/issues`).expect(200);

    expect(response.body).toEqual([]);
  });

  it('is a 404 for another organization’s execution', async () => {
    currentUser = { id: otherUserId, username: 'other-issue-routes-user', organizationId: otherOrganizationId, role: 'owner' };

    await request(app).get(`/api/test-plan-executions/${EXECUTION_ID}/issues`).expect(404);
  });
});

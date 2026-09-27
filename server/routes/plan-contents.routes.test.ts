import { describe, it, expect, beforeAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from '../db';
import {
  projectMembers,
  projects,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlanSuites,
  testPlans,
  testSuiteItems,
  testSuites,
  tests,
} from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * GET /api/test-plans/:id/contents — a plan opened by anyone who can see it (collaudo MEM-06).
 *
 * A plan is the organization's and runs a restricted project's tests whoever presses Run; what a
 * member not on that project must not learn is the tests' names. So they are counted, not named,
 * and the latest report is there for everyone.
 */

let app: express.Express;
let organizationId: number;
let currentUser: { id: number; organizationId: number; role: string; username: string };
let outsider: typeof currentUser;
let reader: typeof currentUser;
let planId: string;
let looseTestId: number;
let secretTestId: number;
let runId: string;

beforeAll(async () => {
  organizationId = await createTestOrganization('Plan Contents Org');
  const ownerId = await createTestUser(organizationId, 'contents-owner');
  outsider = { id: await createTestUser(organizationId, 'contents-outsider'), organizationId, role: 'viewer', username: 'outsider' };
  reader = { id: await createTestUser(organizationId, 'contents-reader'), organizationId, role: 'editor', username: 'reader' };

  const [secret] = await privilegedDb.insert(projects).values({ name: 'Secret', userId: ownerId, organizationId, restricted: true }).returning();
  await privilegedDb.insert(projectMembers).values({ projectId: secret.id, userId: reader.id, organizationId, role: 'viewer' });

  const makeTest = async (name: string, projectId: number | null) =>
    (await privilegedDb.insert(tests).values({ name, url: 'https://x.test', sequence: [], elements: [], userId: ownerId, organizationId, projectId } as any).returning())[0].id;
  looseTestId = await makeTest('Loose login', null);
  secretTestId = await makeTest('Secret checkout', secret.id);

  const [suite] = await privilegedDb.insert(testSuites).values({ name: 'Secret suite', kind: 'static', projectId: secret.id, userId: ownerId, organizationId } as any).returning();
  await privilegedDb.insert(testSuiteItems).values({ suiteId: suite.id, organizationId, testType: 'ui', testId: secretTestId, position: 0 } as any);

  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Nightly', userId: ownerId, organizationId });
  await privilegedDb.insert(testPlanSelectedTests).values({ testPlanId: planId, organizationId, testId: looseTestId, testType: 'ui' });
  await privilegedDb.insert(testPlanSuites).values({ testPlanId: planId, suiteId: suite.id, organizationId, position: 0 } as any);
  runId = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({ id: runId, organizationId, testPlanId: planId, status: 'completed', triggeredBy: 'manual', startedAt: new Date() } as any);

  const { default: testPlanRoutes } = await import('./test-plans.routes');
  const { runWithTenant } = await import('../middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), { userId: currentUser.id, role: currentUser.role });
  });
  app.use(testPlanRoutes);
});

describe('GET /api/test-plans/:id/contents', () => {
  it('counts a restricted project’s tests for someone not on it, without naming them', async () => {
    currentUser = outsider;
    const response = await request(app).get(`/api/test-plans/${planId}/contents`).expect(200);

    expect(response.body.tests).toEqual([
      { type: 'ui', id: looseTestId, name: 'Loose login' },
      { type: 'ui', id: secretTestId, name: null },
    ]);
    // The suite is the project's, so it is not listed either; the run and its report are the plan's.
    expect(response.body.suites).toEqual([]);
    expect(response.body.latestRun).toMatchObject({ id: runId, status: 'completed' });
  });

  it('names them for a member of the project, viewer or not', async () => {
    currentUser = reader;
    const response = await request(app).get(`/api/test-plans/${planId}/contents`).expect(200);

    expect(response.body.tests.map((test: { name: string | null }) => test.name)).toEqual(['Loose login', 'Secret checkout']);
    expect(response.body.suites.map((suite: { name: string }) => suite.name)).toEqual(['Secret suite']);
  });

  it('answers 404 for a plan that is not there', async () => {
    currentUser = outsider;
    await request(app).get(`/api/test-plans/${uuidv4()}/contents`).expect(404);
  });
});

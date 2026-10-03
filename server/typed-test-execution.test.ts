import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const runApiRequest = vi.fn();
const performMobileTest = vi.fn();
vi.mock('./logger', () => ({
  default: Promise.resolve({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));
vi.mock('./browser-tasks', () => ({ browserTasks: {}, BrowserTaskError: class extends Error {} }));
vi.mock('./queue', () => ({
  TEST_EXECUTION_QUEUE_NAME: 'q',
  testExecutionQueue: { add: vi.fn() },
}));
vi.mock('./api-test-runner', async (original) => ({
  ...(await original<typeof import('./api-test-runner')>()),
  runApiRequest: (...args: unknown[]) => runApiRequest(...args),
}));
vi.mock('./mobile-runner', async (original) => ({
  ...(await original<typeof import('./mobile-runner')>()),
  performMobileTest: (...args: unknown[]) => performMobileTest(...args),
}));

const { privilegedDb } = await import('./db');
const {
  reportTestCaseResults,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  browserGrids,
  users,
} = await import('@shared/schema');
const { createTestOrganization } = await import('./tests/factories');
const { tenancyMiddleware } = await import('./middleware/tenancy');
const { default: testsRoutes } = await import('./routes/tests.routes');
const { default: mobileRoutes } = await import('./routes/mobile-tests.routes');
const { default: publishingRoutes } = await import('./routes/test-publishing.routes');
const { default: versionsRoutes } = await import('./routes/test-versions.routes');
const { processTestPlanJob } = await import('./test-execution-service');
let app: express.Express;
let org: number;
let current: { id: number; username: string; organizationId: number; role: string };
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = current;
    (req as any).isAuthenticated = () => true;
    next();
  });
  app.use(tenancyMiddleware, testsRoutes, mobileRoutes, publishingRoutes, versionsRoutes);
});
beforeEach(async () => {
  org = await createTestOrganization('Typed version run');
  current = (
    await privilegedDb
      .insert(users)
      .values({ organizationId: org, username: 'typed-' + uuidv4(), password: 'x', role: 'owner' })
      .returning()
  )[0];
  runApiRequest.mockReset();
  performMobileTest.mockReset();
  runApiRequest.mockResolvedValue({
    passed: true,
    assertions: [],
    extracted: {},
    status: 200,
    headers: {},
    body: {},
    durationMs: 1,
  });
  performMobileTest.mockResolvedValue({
    status: 'passed',
    steps: [],
    error: null,
    screenshot: null,
    sessionUrl: null,
  });
});
async function planRun(kind: 'api' | 'mobile', id: number) {
  const planId = uuidv4(),
    executionId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'Typed plan', userId: current.id, organizationId: org });
  await privilegedDb
    .insert(testPlanSelectedTests)
    .values({
      testPlanId: planId,
      testType: kind,
      organizationId: org,
      ...(kind === 'api' ? { apiTestId: id } : { mobileTestId: id }),
    });
  await privilegedDb
    .insert(testPlanExecutions)
    .values({
      id: executionId,
      organizationId: org,
      testPlanId: planId,
      status: 'queued',
      triggeredBy: 'manual',
    });
  await processTestPlanJob(planId, executionId, current.id);
  return (
    await privilegedDb
      .select()
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, executionId))
  )[0];
}
async function api() {
  return (
    await request(app)
      .post('/api/api-tests')
      .send({ name: 'Typed API', method: 'GET', url: 'https://example.test/published' })
      .expect(201)
  ).body;
}
async function mobile() {
  const gridId = uuidv4();
  await privilegedDb
    .insert(browserGrids)
    .values({
      id: gridId,
      organizationId: org,
      name: 'Device grid',
      provider: 'browserstack',
      username: 'qa',
    });
  return (
    await request(app)
      .post('/api/mobile-tests')
      .send({
        name: 'Typed mobile',
        platform: 'android',
        app: 'bs://published',
        deviceName: 'Pixel',
        gridId,
        steps: [{ id: 'old-step', action: 'tap', target: '~Old' }],
      })
      .expect(201)
  ).body;
}
describe('typed versions in plans', () => {
  it('runs a published API request and records its version instead of the newer working copy', async () => {
    const test = await api();
    await request(app).post(`/api/api-tests/${test.id}/publish`).send({}).expect(200);
    await request(app)
      .put(`/api/api-tests/${test.id}`)
      .send({ url: 'https://example.test/unfinished' })
      .expect(200);
    const result = await planRun('api', test.id);
    expect(runApiRequest.mock.calls[0][0].url).toBe('https://example.test/published');
    expect(result).toMatchObject({ testVersion: 1, status: 'Passed' });
  });
  it('uses the published mobile device, steps and grid while the working copy changes', async () => {
    const test = await mobile();
    await request(app).post(`/api/mobile-tests/${test.id}/publish`).send({}).expect(200);
    const nextGrid = uuidv4();
    await privilegedDb
      .insert(browserGrids)
      .values({
        id: nextGrid,
        organizationId: org,
        name: 'New grid',
        provider: 'browserstack',
        username: 'qa',
      });
    await request(app)
      .put(`/api/mobile-tests/${test.id}`)
      .send({
        ...test,
        app: 'bs://unfinished',
        deviceName: 'Other device',
        gridId: nextGrid,
        steps: [{ id: 'new-step', action: 'tap', target: '~New' }],
      })
      .expect(200);
    const result = await planRun('mobile', test.id);
    expect(performMobileTest.mock.calls[0][0]).toMatchObject({
      app: 'bs://published',
      deviceName: 'Pixel',
      steps: [{ action: 'tap', target: '~Old' }],
    });
    expect(performMobileTest.mock.calls[0][1].id).toBe(test.gridId);
    expect(result).toMatchObject({ testVersion: 1, status: 'Passed' });
  });
  it.each(['api', 'mobile'] as const)(
    'skips unpublished %s tests under mandatory review',
    async (kind) => {
      const test = await (kind === 'api' ? api() : mobile());
      await request(app)
        .put('/api/organization/test-review-policy')
        .send({ required: true })
        .expect(200);
      const result = await planRun(kind, test.id);
      expect(result).toMatchObject({ status: 'Skipped' });
      expect(result.reasonForFailure).toMatch(/Not published/);
      expect(runApiRequest).not.toHaveBeenCalled();
      expect(performMobileTest).not.toHaveBeenCalled();
    },
  );
});

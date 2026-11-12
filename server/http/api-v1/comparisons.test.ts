import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * Comparisons through /api/v1, as a pipeline meets them: a real key, real tenancy, the real
 * comparison orchestrator over a queue that runs nothing.
 */

vi.mock('../../platform/logger', () => ({
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
vi.mock('../../integrations/comparisons', async () => {
  const { createComparisonOrchestrator } = await import('../../execution/comparison-orchestrator');
  const { createExecutionOrchestrator } = await import('../../execution/execution-orchestrator');
  const queue = {
    add: async (_name: string, _data: unknown, options: { jobId: string }) => ({
      id: options.jobId,
    }),
  };
  return {
    comparisonOrchestrator: createComparisonOrchestrator({
      executions: createExecutionOrchestrator(queue as any),
      engine: async () => {
        throw new Error('not computed in these tests');
      },
    }),
  };
});

const { privilegedDb } = await import('../../platform/db');
const { apiKeys, auditLog, environments, testPlanSelectedTests, testPlans, tests, users } =
  await import('@shared/schema');
const { createTestOrganization, createTestUser } = await import('../../tests/factories');
const { generateApiKey } = await import('../../identity/api-keys');
const { apiKeyAuth, resetApiKeyUsageThrottle } = await import('../middleware/api-key-auth');
const { tenancyMiddleware } = await import('../../platform/middleware/tenancy');
const { default: apiV1Routes } = await import('../routes/api-v1.routes');

let app: express.Express;
let org: number;
let editor: number;
let viewer: number;
let stranger: number;
let other: number;
let plan: string;
let otherPlan: string;
let prod: number;
let staging: number;

async function keyFor(userId: number, organizationId: number, scopes: string[] | null) {
  const { key, hashedKey, prefix } = generateApiKey();
  await privilegedDb
    .insert(apiKeys)
    .values({ id: uuidv4(), organizationId, userId, name: 'test', prefix, hashedKey, scopes });
  return key;
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

async function planWithOneTest(organizationId: number, userId: number) {
  const id = `plan-${uuidv4()}`;
  await privilegedDb
    .insert(testPlans)
    .values({ id, name: 'Migration', userId, organizationId } as any);
  const [test] = await privilegedDb
    .insert(tests)
    .values({
      userId,
      organizationId,
      name: 'checkout',
      url: 'https://example.test/checkout',
      sequence: [],
      elements: [],
    })
    .returning();
  await privilegedDb
    .insert(testPlanSelectedTests)
    .values({ testPlanId: id, testType: 'ui', testId: test.id, organizationId } as any);
  return id;
}

beforeAll(async () => {
  org = await createTestOrganization('V1 Comparison Org');
  editor = await createTestUser(org, `v1c-editor-${uuidv4().slice(0, 6)}`);
  viewer = await createTestUser(org, `v1c-viewer-${uuidv4().slice(0, 6)}`);
  await privilegedDb.update(users).set({ role: 'viewer' }).where(eq(users.id, viewer));
  plan = await planWithOneTest(org, editor);
  const [p, s] = await privilegedDb
    .insert(environments)
    .values([
      { name: 'prod', userId: editor, organizationId: org },
      { name: 'staging', userId: editor, organizationId: org },
    ])
    .returning();
  prod = p.id;
  staging = s.id;

  other = await createTestOrganization('V1 Comparison Elsewhere');
  stranger = await createTestUser(other, `v1c-stranger-${uuidv4().slice(0, 6)}`);
  otherPlan = await planWithOneTest(other, stranger);

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).isAuthenticated = () => false;
    next();
  });
  app.use(apiKeyAuth);
  app.use(tenancyMiddleware);
  app.use(apiV1Routes);
});

beforeEach(() => resetApiKeyUsageThrottle());

const body = () => ({ baselineEnvironmentId: prod, candidateEnvironmentId: staging });

describe('comparisons through /api/v1', () => {
  it('starts one, once per Idempotency-Key, says where to poll it, and records it as an API call', async () => {
    const key = await keyFor(editor, org, ['runs:write', 'runs:read']);
    const idem = `build-${uuidv4()}`;

    const started = await request(app)
      .post(`/api/v1/plans/${plan}/comparisons`)
      .set(bearer(key))
      .set('Idempotency-Key', idem)
      .send({ ...body(), name: 'Angular 22' })
      .expect(202);
    expect(started.body).toMatchObject({
      planId: plan,
      name: 'Angular 22',
      status: 'running',
      verdict: null,
      baseline: { environmentId: prod, environmentName: 'prod' },
      candidate: { environmentId: staging, environmentName: 'staging' },
    });
    expect(started.headers.location).toBe(`/api/v1/comparisons/${started.body.id}`);
    expect(started.body.links.html).toBe(`/api/v1/comparisons/${started.body.id}/export/html`);

    const again = await request(app)
      .post(`/api/v1/plans/${plan}/comparisons`)
      .set(bearer(key))
      .set('Idempotency-Key', idem)
      .send({ ...body(), name: 'Angular 22' })
      .expect(202);
    expect(again.body.id).toBe(started.body.id);

    const entries = await privilegedDb
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, 'comparison.created'), eq(auditLog.targetId, started.body.id)),
      );
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata).toMatchObject({ via: 'api', planId: plan });

    const polled = await request(app).get(started.headers.location).set(bearer(key)).expect(200);
    expect(polled.body).toMatchObject({ id: started.body.id, planName: 'Migration' });

    const html = await request(app)
      .get(`/api/v1/comparisons/${started.body.id}/export/html`)
      .set(bearer(key))
      .expect(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.text).toContain('Parity report');
    await request(app)
      .get(`/api/v1/comparisons/${started.body.id}/export/allure`)
      .set(bearer(key))
      .expect(400);
  });

  it('holds the scopes and the role: runs:write to start, runs:read to read', async () => {
    const readOnly = await keyFor(editor, org, ['runs:read']);
    const refused = await request(app)
      .post(`/api/v1/plans/${plan}/comparisons`)
      .set(bearer(readOnly))
      .send(body())
      .expect(403);
    expect(refused.body.error).toMatchObject({
      code: 'insufficient_scope',
      requiredScope: 'runs:write',
    });

    const viewerKey = await keyFor(viewer, org, ['runs:write']);
    const notAllowed = await request(app)
      .post(`/api/v1/plans/${plan}/comparisons`)
      .set(bearer(viewerKey))
      .send(body())
      .expect(403);
    expect(notAllowed.body.error.code).toBe('insufficient_role');

    const writeOnly = await keyFor(editor, org, ['runs:write']);
    await request(app).get(`/api/v1/comparisons/${uuidv4()}`).set(bearer(writeOnly)).expect(403);
  });

  it('rejects a body it does not understand', async () => {
    const key = await keyFor(editor, org, ['runs:write']);
    const refused = await request(app)
      .post(`/api/v1/plans/${plan}/comparisons`)
      .set(bearer(key))
      .send({ baselineEnvironmentId: prod })
      .expect(400);
    expect(refused.body.error.code).toBe('invalid_request');
  });

  it("does not find another organization's plan or comparison", async () => {
    const key = await keyFor(editor, org, ['runs:write', 'runs:read']);
    const missing = await request(app)
      .post(`/api/v1/plans/${otherPlan}/comparisons`)
      .set(bearer(key))
      .send(body())
      .expect(404);
    expect(missing.body.error.code).toBe('plan_not_found');

    const theirKey = await keyFor(stranger, other, ['runs:read']);
    const mine = await request(app)
      .post(`/api/v1/plans/${plan}/comparisons`)
      .set(bearer(key))
      .send(body())
      .expect(202);
    const hidden = await request(app)
      .get(`/api/v1/comparisons/${mine.body.id}`)
      .set(bearer(theirKey))
      .expect(404);
    expect(hidden.body.error.code).toBe('comparison_not_found');
    await request(app)
      .get(`/api/v1/comparisons/${mine.body.id}/export/html`)
      .set(bearer(theirKey))
      .expect(404);
  });
});

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * /api/v1 as a pipeline meets it: real keys, real authentication, real tenancy.
 *
 * What these hold: a scoped key can do what its scopes say and nothing else, on /api/v1 and
 * nowhere else; the account's role stays the ceiling; another organization's plans and runs do
 * not exist; and a key from before scopes keeps working everywhere it did.
 */

const queued: Array<{ options: { jobId: string } }> = [];

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));
vi.mock('../queue', () => ({
  TEST_EXECUTION_QUEUE_NAME: 'test-queue',
  testExecutionQueue: {
    add: vi.fn(async (_name: string, _data: unknown, options: { jobId: string }) => {
      queued.push({ options });
      return { id: options.jobId };
    }),
  },
}));

const { privilegedDb } = await import('../db');
const { apiKeys, testPlanExecutions, testPlans, users } = await import('@shared/schema');
const { createTestOrganization, createTestUser } = await import('../tests/factories');
const { generateApiKey } = await import('../api-keys');
const { apiKeyAuth, resetApiKeyUsageThrottle } = await import('../middleware/api-key-auth');
const { tenancyMiddleware } = await import('../middleware/tenancy');
const { default: apiV1Routes } = await import('./api-v1.routes');
const { default: apiKeysRoutes } = await import('./api-keys.routes');

let app: express.Express;
let org: number;
let editor: number;
let viewer: number;
let plan: string;
let otherPlan: string;
let otherRun: string;

async function keyFor(userId: number, organizationId: number, scopes: string[] | null) {
  const { key, hashedKey, prefix } = generateApiKey();
  await privilegedDb.insert(apiKeys).values({ id: uuidv4(), organizationId, userId, name: 'test', prefix, hashedKey, scopes });
  return key;
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

beforeAll(async () => {
  org = await createTestOrganization('V1 Org');
  editor = await createTestUser(org, `v1-editor-${uuidv4().slice(0, 6)}`);
  viewer = await createTestUser(org, `v1-viewer-${uuidv4().slice(0, 6)}`);
  await privilegedDb.update(users).set({ role: 'viewer' }).where(eq(users.id, viewer));
  plan = `plan-${uuidv4()}`;
  await privilegedDb.insert(testPlans).values({ id: plan, name: 'Checkout', userId: editor, organizationId: org } as any);

  const other = await createTestOrganization('Elsewhere');
  const stranger = await createTestUser(other, `v1-stranger-${uuidv4().slice(0, 6)}`);
  otherPlan = `plan-${uuidv4()}`;
  await privilegedDb.insert(testPlans).values({ id: otherPlan, name: 'Theirs', userId: stranger, organizationId: other } as any);
  otherRun = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({ id: otherRun, organizationId: other, testPlanId: otherPlan, status: 'queued' } as any);

  app = express();
  app.use(express.json());
  // What passport leaves on a request with no session.
  app.use((req, _res, next) => {
    (req as any).isAuthenticated = () => false;
    next();
  });
  app.use(apiKeyAuth);
  app.use(tenancyMiddleware);
  app.use(apiV1Routes);
  app.use(apiKeysRoutes);
});

beforeEach(async () => {
  queued.length = 0;
  resetApiKeyUsageThrottle();
  await privilegedDb.delete(testPlanExecutions).where(eq(testPlanExecutions.testPlanId, plan));
});

describe('starting a run', () => {
  it('queues it as an API run of the key holder, and says where to watch it', async () => {
    const key = await keyFor(editor, org, ['runs:write', 'runs:read']);

    const started = await request(app).post(`/api/v1/plans/${plan}/runs`).set(bearer(key)).send({}).expect(202);

    expect(started.body).toMatchObject({ planId: plan, planName: 'Checkout', status: 'queued', trigger: 'api' });
    expect(started.headers.location).toBe(`/api/v1/runs/${started.body.id}`);
    expect(queued.map((j) => j.options.jobId)).toEqual([started.body.id]);
    const [row] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, started.body.id));
    expect(row.requestedByUserId).toBe(editor);

    const polled = await request(app).get(started.headers.location).set(bearer(key)).expect(200);
    expect(polled.body.id).toBe(started.body.id);
  });

  it('returns the same run for the same Idempotency-Key', async () => {
    const key = await keyFor(editor, org, ['runs:write']);
    const first = await request(app).post(`/api/v1/plans/${plan}/runs`).set(bearer(key)).set('Idempotency-Key', 'build-42').expect(202);
    const again = await request(app).post(`/api/v1/plans/${plan}/runs`).set(bearer(key)).set('Idempotency-Key', 'build-42').expect(202);

    expect(again.body.id).toBe(first.body.id);
  });

  it('refuses a key without the scope, and queues nothing', async () => {
    const key = await keyFor(editor, org, ['runs:read']);

    const refused = await request(app).post(`/api/v1/plans/${plan}/runs`).set(bearer(key)).send({}).expect(403);

    expect(refused.body.error).toMatchObject({ code: 'insufficient_scope', requiredScope: 'runs:write' });
    expect(queued).toHaveLength(0);
  });

  it("keeps the account's role as the ceiling: a viewer's key with runs:write still cannot", async () => {
    const key = await keyFor(viewer, org, ['runs:write']);

    const refused = await request(app).post(`/api/v1/plans/${plan}/runs`).set(bearer(key)).send({}).expect(403);

    expect(refused.body.error.code).toBe('insufficient_role');
  });

  it("does not find another organization's plan", async () => {
    const key = await keyFor(editor, org, ['runs:write']);

    const missing = await request(app).post(`/api/v1/plans/${otherPlan}/runs`).set(bearer(key)).send({}).expect(404);

    expect(missing.body.error.code).toBe('plan_not_found');
    expect(queued).toHaveLength(0);
  });

  it('rejects a body with fields it does not know', async () => {
    const key = await keyFor(editor, org, ['runs:write']);

    const refused = await request(app).post(`/api/v1/plans/${plan}/runs`).set(bearer(key)).send({ browsers: ['webkit'] }).expect(400);

    expect(refused.body.error.code).toBe('invalid_request');
  });
});

describe('reading and stopping runs', () => {
  it("lists this organization's runs and not another's, and filters them", async () => {
    const key = await keyFor(editor, org, ['runs:write', 'runs:read']);
    const started = await request(app).post(`/api/v1/plans/${plan}/runs`).set(bearer(key)).expect(202);

    const all = await request(app).get('/api/v1/runs').set(bearer(key)).expect(200);
    expect(all.body.items.map((r: { id: string }) => r.id)).toEqual([started.body.id]);

    const none = await request(app).get('/api/v1/runs?status=completed').set(bearer(key)).expect(200);
    expect(none.body.items).toEqual([]);

    await request(app).get('/api/v1/runs?status=finished').set(bearer(key)).expect(400);
    await request(app).get(`/api/v1/runs/${otherRun}`).set(bearer(key)).expect(404);
  });

  it('cancels a queued run at once', async () => {
    const key = await keyFor(editor, org, ['runs:write']);
    const started = await request(app).post(`/api/v1/plans/${plan}/runs`).set(bearer(key)).expect(202);

    const cancelled = await request(app).post(`/api/v1/runs/${started.body.id}/cancel`).set(bearer(key)).expect(200);
    expect(cancelled.body.status).toBe('cancelled');

    const again = await request(app).post(`/api/v1/runs/${started.body.id}/cancel`).set(bearer(key)).expect(409);
    expect(again.body.error.code).toBe('run_already_ended');
  });

  it('serves the JUnit report', async () => {
    const key = await keyFor(editor, org, ['runs:write', 'runs:read']);
    const started = await request(app).post(`/api/v1/plans/${plan}/runs`).set(bearer(key)).expect(202);

    const junit = await request(app).get(`/api/v1/runs/${started.body.id}/junit`).set(bearer(key)).expect(200);

    expect(junit.headers['content-type']).toContain('application/xml');
    expect(junit.text).toContain('<testsuites');
  });

  it('lists plans with plans:read', async () => {
    const key = await keyFor(viewer, org, ['plans:read']);

    const plans = await request(app).get('/api/v1/plans').set(bearer(key)).expect(200);

    expect(plans.body.items).toEqual([expect.objectContaining({ id: plan, name: 'Checkout' })]);
  });
});

describe('where a key works', () => {
  it('a scoped key is not a credential outside /api/v1', async () => {
    const key = await keyFor(editor, org, ['runs:write', 'runs:read', 'plans:read']);

    await request(app).get('/api/api-keys').set(bearer(key)).expect(401);
  });

  it('a key from before scopes keeps working on both', async () => {
    const key = await keyFor(editor, org, null);

    await request(app).get('/api/api-keys').set(bearer(key)).expect(200);
    await request(app).post(`/api/v1/plans/${plan}/runs`).set(bearer(key)).expect(202);
  });

  it('answers a request with no key in the API\'s own shape', async () => {
    const response = await request(app).get('/api/v1/runs').expect(401);

    expect(response.body.error.code).toBe('unauthenticated');
  });

  it('answers an unknown endpoint in the API\'s own shape', async () => {
    const response = await request(app).get('/api/v1/nothing-here').expect(404);

    expect(response.body.error.code).toBe('not_found');
  });

  it('describes itself to anyone', async () => {
    const response = await request(app).get('/api/v1/openapi.json').expect(200);

    expect(response.body.openapi).toBe('3.1.0');
  });
});

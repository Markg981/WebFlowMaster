import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { eq, sql } from 'drizzle-orm';

/**
 * Webhooks: created with a token shown once, kept as a hash, and triggered with it.
 *
 * `runTestPlan` stands in for starting the run: what is under test is who may trigger what.
 */

const warn = vi.fn();
vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: (...args: unknown[]) => warn(...args), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));
const runTestPlan = vi.fn();
vi.mock('./test-execution-service', () => ({ runTestPlan: (...args: unknown[]) => runTestPlan(...args) }));

const { privilegedDb } = await import('./db');
const { auditLog, testPlans, testPlanWebhooks } = await import('@shared/schema');
const { createTestOrganization, createTestUser } = await import('./tests/factories');
const { hashWebhookToken, redactWebhookPath, webhookTokenFromRequest } = await import('./webhook-tokens');

let app: express.Express;
let organizationId: number;
let otherOrganizationId: number;
let ownerId: number;
let planId: string;
let otherPlanId: string;
let currentUser: { id: number; organizationId: number; role: string; username: string };
let editor: typeof currentUser;

beforeAll(async () => {
  organizationId = await createTestOrganization('Webhook Org');
  otherOrganizationId = await createTestOrganization('Other Webhook Org');
  ownerId = await createTestUser(organizationId, 'webhook-owner');
  const otherOwner = await createTestUser(otherOrganizationId, 'other-webhook-owner');
  editor = { id: ownerId, organizationId, role: 'editor', username: 'ada' };
  planId = uuidv4();
  otherPlanId = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Deploy checks', userId: ownerId, organizationId });
  await privilegedDb.insert(testPlans).values({ id: otherPlanId, name: 'Theirs', userId: otherOwner, organizationId: otherOrganizationId });

  const { default: managementRoutes } = await import('./routes/webhooks.routes');
  const { webhooksRouter } = await import('./webhooks');
  const { runWithTenant } = await import('./middleware/tenancy');

  app = express();
  app.use(express.json());
  // CI calls arrive with no session; management calls with one.
  app.use('/api/webhooks', webhooksRouter);
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(managementRoutes);
});

beforeEach(() => {
  currentUser = editor;
  runTestPlan.mockReset();
  runTestPlan.mockResolvedValue({ id: 'run-1', status: 'queued' });
  warn.mockReset();
});

async function createWebhook(name = 'GitHub Actions') {
  const response = await request(app).post(`/api/test-plans/${planId}/webhooks`).send({ name }).expect(201);
  return response.body as { id: number; token: string; tokenPrefix: string };
}

describe('webhook tokens', () => {
  it('are read from the header first, then Bearer, then the path', () => {
    expect(webhookTokenFromRequest({ 'x-webhook-token': ' a ' }, 'c')).toBe('a');
    expect(webhookTokenFromRequest({ authorization: 'Bearer b' }, 'c')).toBe('b');
    expect(webhookTokenFromRequest({}, 'c')).toBe('c');
    expect(webhookTokenFromRequest({})).toBeNull();
  });

  it('are masked in a logged path', () => {
    expect(redactWebhookPath('/api/webhooks/execute/wfmwh_secret')).toBe('/api/webhooks/execute/[redacted]');
    expect(redactWebhookPath('/api/test-plans/1')).toBe('/api/test-plans/1');
  });

  it('hash in the database exactly as in the application, so the migration keeps existing webhooks working', async () => {
    const token = 'legacy-token-9f2c';
    const result = await privilegedDb.execute(sql`select encode(sha256(convert_to(${token}, 'UTF8')), 'hex') as h`);
    const rows = (result as any).rows ?? result;
    expect(rows[0].h).toBe(hashWebhookToken(token));
  });
});

describe('managing webhooks', () => {
  it('shows the token once, keeps only its hash, and records who created it', async () => {
    const created = await createWebhook();

    expect(created.token).toMatch(/^wfmwh_/);
    expect(created.tokenPrefix).toBe(created.token.slice(0, 12));
    const [row] = await privilegedDb.select().from(testPlanWebhooks).where(eq(testPlanWebhooks.id, created.id));
    expect(row.tokenHash).toBe(hashWebhookToken(created.token));
    expect(JSON.stringify(row)).not.toContain(created.token);

    const listed = (await request(app).get(`/api/test-plans/${planId}/webhooks`).expect(200)).body;
    const mine = listed.find((w: any) => w.id === created.id);
    expect(mine).toMatchObject({ name: 'GitHub Actions', tokenPrefix: created.tokenPrefix });
    expect(mine.token).toBeUndefined();
    expect(mine.tokenHash).toBeUndefined();

    const audits = await privilegedDb.select().from(auditLog).where(eq(auditLog.targetId, String(created.id)));
    expect(audits.map((a) => a.action)).toContain('webhook.created');
    expect(JSON.stringify(audits)).not.toContain(created.token);
  });

  it("cannot create one for another organization's plan", async () => {
    await request(app).post(`/api/test-plans/${otherPlanId}/webhooks`).send({ name: 'x' }).expect(404);
  });

  it('is not for a viewer', async () => {
    currentUser = { ...editor, role: 'viewer' };
    await request(app).post(`/api/test-plans/${planId}/webhooks`).send({ name: 'x' }).expect(403);
  });
});

describe('triggering a plan', () => {
  it('starts the plan with the token in a header, on behalf of its owner', async () => {
    const { token } = await createWebhook();

    const response = await request(app).post('/api/webhooks/execute').set('X-Webhook-Token', token).expect(202);

    expect(response.body).toMatchObject({ success: true, testPlanRunId: 'run-1' });
    expect(runTestPlan).toHaveBeenCalledWith(planId, ownerId, expect.objectContaining({ trigger: 'webhook' }));
  });

  it('still accepts the URL existing pipelines were given', async () => {
    const { token } = await createWebhook();
    await request(app).post(`/api/webhooks/execute/${token}`).expect(202);
    expect(runTestPlan).toHaveBeenCalledTimes(1);
  });

  it('refuses a wrong token without writing it to the log', async () => {
    await request(app).post('/api/webhooks/execute').set('X-Webhook-Token', 'wfmwh_not-a-real-token-at-all').expect(401);

    expect(runTestPlan).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('not-a-real-token-at-all');
  });

  it('refuses a call with no token', async () => {
    await request(app).post('/api/webhooks/execute').expect(401);
  });

  it('stops working the moment the webhook is deleted', async () => {
    const { id, token } = await createWebhook();

    await request(app).delete(`/api/webhooks/${id}`).expect(200);

    await request(app).post('/api/webhooks/execute').set('X-Webhook-Token', token).expect(401);
    expect(runTestPlan).not.toHaveBeenCalled();
  });

  it("cannot be deleted from another organization", async () => {
    const { id, token } = await createWebhook();
    currentUser = { ...editor, organizationId: otherOrganizationId };

    await request(app).delete(`/api/webhooks/${id}`).expect(404);

    currentUser = editor;
    await request(app).post('/api/webhooks/execute').set('X-Webhook-Token', token).expect(202);
  });
});

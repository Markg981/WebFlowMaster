import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { testPlans, testPlanExecutions } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/** POST /api/test-plan-executions/:id/cancel — the button a person presses to stop a run. */

let app: express.Express;
let organizationId: number;
let otherOrganizationId: number;
let currentUser: { id: number; organizationId: number; role: string; username: string };
let editor: typeof currentUser;
let planId: string;

beforeAll(async () => {
  organizationId = await createTestOrganization('Cancel Org');
  otherOrganizationId = await createTestOrganization('Other Cancel Org');
  const userId = await createTestUser(organizationId, 'cancel-user');
  editor = { id: userId, organizationId, role: 'editor', username: 'ada' };
  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Cancel plan', userId, organizationId });

  const { default: testPlanRoutes } = await import('./test-plans.routes');
  const { runWithTenant } = await import('../middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(testPlanRoutes);
});

beforeEach(() => {
  currentUser = editor;
});

async function runIn(status: string) {
  const id = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({
    id,
    organizationId,
    testPlanId: planId,
    status,
    triggeredBy: 'manual',
    ...(status !== 'queued' ? { startedAt: new Date() } : {}),
  } as any);
  return id;
}

const statusOf = async (id: string) =>
  (await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id)))[0];

describe('POST /api/test-plan-executions/:id/cancel', () => {
  it('cancels a queued run at once, and records who did', async () => {
    const id = await runIn('queued');

    const response = await request(app).post(`/api/test-plan-executions/${id}/cancel`).expect(200);

    expect(response.body.status).toBe('cancelled');
    expect(await statusOf(id)).toMatchObject({ status: 'cancelled', failureMessage: 'Cancelled by ada.' });
  });

  it('asks a running run to stop and answers 202: its worker ends it', async () => {
    const id = await runIn('running');

    const response = await request(app).post(`/api/test-plan-executions/${id}/cancel`).expect(202);

    expect(response.body.status).toBe('cancelling');
    expect((await statusOf(id)).status).toBe('cancelling');
  });

  it('answers 409 for a run that has already ended, and leaves it as it was', async () => {
    const id = await runIn('completed');

    const response = await request(app).post(`/api/test-plan-executions/${id}/cancel`).expect(409);

    expect(response.body.status).toBe('completed');
    expect((await statusOf(id)).status).toBe('completed');
  });

  it("does not find another organization's run", async () => {
    const id = await runIn('running');
    currentUser = { ...editor, organizationId: otherOrganizationId };

    await request(app).post(`/api/test-plan-executions/${id}/cancel`).expect(404);
    expect((await statusOf(id)).status).toBe('running');
  });

  it('is not for a viewer', async () => {
    const id = await runIn('running');
    currentUser = { ...editor, role: 'viewer' };

    await request(app).post(`/api/test-plan-executions/${id}/cancel`).expect(403);
    expect((await statusOf(id)).status).toBe('running');
  });
});

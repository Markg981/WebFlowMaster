import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testPlans, testPlanExecutions, users, tests, testPlanSelectedTests } from '@shared/schema';
import { privilegedDb } from '../db';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { tenancyMiddleware, runAsOrganization } from '../middleware/tenancy';

vi.mock('../queue', () => ({ testExecutionQueue: { add: vi.fn(async () => ({})) } }));
vi.mock('../logger', () => ({ default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }) }));
const { createExecutionOrchestrator } = await import('../execution-orchestrator');
const { default: routes } = await import('./reports.routes');
const { default: planRoutes } = await import('./test-plans.routes');
const app = express();
let current: typeof users.$inferSelect;
let authenticated = true;
let executionId: string;
app.use(express.json(), (req, _res, next) => { req.user = current; req.isAuthenticated = (() => authenticated) as any; next(); }, tenancyMiddleware, routes, planRoutes);
beforeEach(async () => {
  const org = await createTestOrganization();
  const userId = await createTestUser(org);
  [current] = await privilegedDb.update(users).set({ role: 'editor' }).where(eq(users.id, userId)).returning();
  const planId = randomUUID();
  await privilegedDb.insert(testPlans).values({ id: planId, organizationId: org, userId, name: 'Replay plan' });
  const [test] = await privilegedDb.insert(tests).values({ organizationId: org, userId, name: 'UI', url: 'https://test', sequence: [], elements: [] }).returning();
  await privilegedDb.insert(testPlanSelectedTests).values({ organizationId: org, testPlanId: planId, testType: 'ui', testId: test.id });
  const row = await runAsOrganization(org, () => createExecutionOrchestrator({ add: async () => ({}) }).enqueue({ planId, requestedByUserId: userId, trigger: 'manual' }));
  executionId = row.id; authenticated = true;
});
describe('explicit historical replay route', () => {
  it('never exposes retained definitions or data in execution list, detail and cancellation responses', async () => {
    await privilegedDb.update(testPlanExecutions).set({ configurationSnapshot: { private: 'retained-secret' } }).where(eq(testPlanExecutions.id, executionId));
    current.role = 'viewer';
    for (const path of ['/api/test-plan-executions', `/api/test-plan-executions/${executionId}`]) {
      const response = await request(app).get(path).expect(200);
      expect(JSON.stringify(response.body)).not.toContain('retained-secret');
      expect(JSON.stringify(response.body)).not.toContain('configurationSnapshot');
    }
    current.role = 'editor';
    const cancelled = await request(app).post(`/api/test-plan-executions/${executionId}/cancel`).expect(200);
    expect(JSON.stringify(cancelled.body)).not.toContain('retained-secret');
    expect(cancelled.body.execution).not.toHaveProperty('configurationSnapshot');
  });
  it('requires an explicit mode, returns only safe queued metadata and honors idempotency', async () => {
    await request(app).post(`/api/test-plan-executions/${executionId}/replay`).send({}).expect(400);
    const first = await request(app).post(`/api/test-plan-executions/${executionId}/replay`).set('Idempotency-Key', 'route-key').send({ mode: 'historical' }).expect(202);
    expect(Object.keys(first.body).sort()).toEqual(['id', 'status', 'testPlanId']);
    const second = await request(app).post(`/api/test-plan-executions/${executionId}/replay`).set('Idempotency-Key', 'route-key').send({ mode: 'historical' }).expect(202);
    expect(first.body.id).toBe(second.body.id);
  });
  it('refuses unauthenticated users and viewers', async () => {
    authenticated = false;
    await request(app).post(`/api/test-plan-executions/${executionId}/replay`).send({ mode: 'historical' }).expect(401);
    authenticated = true; current.role = 'viewer';
    await request(app).post(`/api/test-plan-executions/${executionId}/replay`).send({ mode: 'historical' }).expect(403);
  });
  it('refuses a foreign execution, legacy inputs and snapshot injection', async () => {
    await request(app).post(`/api/test-plan-executions/${executionId}/replay`).send({ mode: 'historical', configurationSnapshot: {} }).expect(400);
    await privilegedDb.update(testPlanExecutions).set({ configurationSnapshot: {} }).where(eq(testPlanExecutions.id, executionId));
    expect((await request(app).post(`/api/test-plan-executions/${executionId}/replay`).send({ mode: 'historical' }).expect(409)).body.code).toBe('replay_unavailable');
    const other = await createTestOrganization();
    const userId = await createTestUser(other);
    [current] = await privilegedDb.update(users).set({ role: 'editor' }).where(eq(users.id, userId)).returning();
    await request(app).post(`/api/test-plan-executions/${executionId}/replay`).send({ mode: 'historical' }).expect(404);
  });
});

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { testPlanExecutions, testPlans } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * The figures behind the dashboard.
 *
 * `getDashboardMetrics` was written, exported, and never called: no route mounted it. The
 * client's GET fell through to the catch-all that serves index.html, `res.json()` threw on
 * the HTML, and the query failed — so every account saw a success rate of 0%, empty charts
 * and no recent reports, whatever it had actually run. Nothing said so, because a failed
 * query and an account with no executions render identically.
 *
 * These tests hold the route in place and pin the two things that were wrong in the payload
 * it returns: a trend window filled with real days, and slices identified by a stable status
 * rather than by a hex colour and an English label.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let otherUserId: number;
let currentUser: { id: number; organizationId: number; role: string };

beforeAll(async () => {
  organizationId = await createTestOrganization('Analytics Org');
  userId = await createTestUser(organizationId, 'analytics-user');
  otherUserId = await createTestUser(organizationId, 'analytics-other-user');

  const { default: analyticsRoutes } = await import('./analytics.routes');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => Boolean(currentUser);
    next();
  });
  app.use(analyticsRoutes);
});

beforeEach(async () => {
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlans);
  currentUser = { id: userId, organizationId, role: 'owner' };
});

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${++idCounter}`;

async function createPlan(ownerId: number, name: string): Promise<string> {
  const id = nextId('plan');
  await privilegedDb.execute(
    sql`INSERT INTO test_plans (id, name, user_id, organization_id)
        VALUES (${id}, ${name}, ${ownerId}, ${organizationId})`,
  );
  return id;
}

async function createExecution(planId: string, status: string, durationMs: number) {
  await privilegedDb.execute(
    sql`INSERT INTO test_plan_executions
          (id, test_plan_id, organization_id, status, started_at, execution_duration_ms)
        VALUES (${nextId('exec')}, ${planId}, ${organizationId}, ${status}, ${new Date()}, ${durationMs})`,
  );
}

describe('GET /api/analytics/dashboard', () => {
  it('is mounted at the path the dashboard asks for', async () => {
    // The whole defect in one assertion: without a router here this returned index.html,
    // which the client could not parse and reported as no data at all.
    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('refuses an unauthenticated request', async () => {
    currentUser = undefined as any;

    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.status).toBe(401);
  });

  it('counts only the executions of the caller’s own plans', async () => {
    const mine = await createPlan(userId, 'Mine');
    const theirs = await createPlan(otherUserId, 'Theirs');
    await createExecution(mine, 'completed', 1000);
    await createExecution(mine, 'failed', 3000);
    await createExecution(theirs, 'completed', 5000);

    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.body.kpis.totalRuns).toBe(2);
    expect(res.body.kpis.successRate).toBe(50);
  });

  it('reports zero runs without inventing a success rate', async () => {
    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.body.kpis.totalRuns).toBe(0);
    expect(res.body.kpis.lastRun).toBeNull();
  });

  it('identifies each slice by status, not by colour or an English label', async () => {
    const plan = await createPlan(userId, 'Slices');
    await createExecution(plan, 'completed', 1000);

    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.body.distribution.map((slice: any) => slice.status)).toEqual([
      'passed',
      'failed',
      'pending',
    ]);
    // Colour is the interface's decision, so that it can follow the theme; the label is the
    // interface's decision, so that it can be translated.
    for (const slice of res.body.distribution) {
      expect(slice).not.toHaveProperty('fill');
      expect(slice).not.toHaveProperty('name');
    }
  });

  it('fills the trend with every day of the window', async () => {
    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.body.trend).toHaveLength(30);
    // Which is why the chart cannot take a non-empty array to mean that something ran.
    expect(res.body.trend.every((day: any) => day.passed === 0 && day.failed === 0)).toBe(true);
  });

  it('returns the most recent executions for the reports panel', async () => {
    const plan = await createPlan(userId, 'Recent');
    await createExecution(plan, 'completed', 1000);
    await createExecution(plan, 'failed', 2000);

    const res = await request(app).get('/api/analytics/dashboard');

    expect(res.body.recent).toHaveLength(2);
    expect(res.body.recent[0]).toMatchObject({ planName: 'Recent' });
  });
});

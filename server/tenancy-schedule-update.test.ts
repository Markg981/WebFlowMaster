import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { privilegedDb } from './db';
import { users, organizations, testPlans, testPlanSchedules, type User } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { createTestOrganization } from './tests/factories';

/**
 * C5 from the final security review: server/routes/test-plans.routes.ts's
 * PUT /api/test-plan-schedules/:id used to call schedulerService.updateScheduleJob(...)
 * *inside* the withTenantTransaction callback. That reaches scheduler-service.ts's
 * addScheduleJob, which issues its own privilegedDb.select() — a second query on the
 * handle while the tenant transaction still holds the connection.
 *
 * Deliberately does NOT mock ./scheduler-service, unlike server/tenancy-routes.test.ts and
 * server/test-plan-schedules.test.ts: that mock is the only reason this bug was invisible.
 * Under PGlite (this suite's driver), the real addScheduleJob call deadlocks the shared
 * single-writer connection, and every later test's hooks time out — so this file also
 * proves the fix by not wedging the process for the rest of the run.
 */

vi.mock('./playwright-service', () => ({
  playwrightService: {
    loadWebsite: vi.fn(),
    detectElements: vi.fn(),
    executeAdhocSequence: vi.fn(),
    executeTest: vi.fn(),
    startRecordingSession: vi.fn(),
    stopRecordingSession: vi.fn(),
    getRecordedActions: vi.fn(),
  },
  PlaywrightService: class {},
}));

let app: Application;
let currentUser: User;
let sessionOrganizationId: number;
let sessionUser: User;

beforeAll(async () => {
  const tempApp = express();
  tempApp.use(express.json());
  tempApp.use((req: Request, res: Response, next: NextFunction) => {
    req.user = currentUser;
    req.isAuthenticated = () => true;
    next();
  });
  const { registerRoutes } = await import('./routes');
  await registerRoutes(tempApp);
  app = tempApp;
});

async function clearAll() {
  await privilegedDb.delete(testPlanSchedules);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
}

afterAll(clearAll);

beforeEach(async () => {
  await clearAll();
  sessionOrganizationId = await createTestOrganization('C5 Session Organization');
  [sessionUser] = await privilegedDb
    .insert(users)
    .values({ username: 'c5_session_user', password: 'hashed', organizationId: sessionOrganizationId })
    .returning();
  currentUser = sessionUser;
});

describe('PUT /api/test-plan-schedules/:id with the real scheduler-service (C5)', () => {
  it('responds without deadlocking the shared database connection', async () => {
    const [plan] = await privilegedDb
      .insert(testPlans)
      .values({ id: 'c5-plan', name: 'C5 plan', userId: sessionUser.id, organizationId: sessionOrganizationId })
      .returning();

    // 'daily@02:00' is not a frequency addScheduleJob's frequencyToCronPattern recognizes,
    // so — bug fixed — updateScheduleJob logs a warning and registers nothing: no live
    // node-cron task is left running past this test. That is orthogonal to what this test
    // is checking, which is that the request completes at all.
    const [schedule] = await privilegedDb
      .insert(testPlanSchedules)
      .values({
        id: 'c5-schedule',
        testPlanId: plan.id,
        userId: sessionUser.id,
        organizationId: sessionOrganizationId,
        scheduleName: 'Original name',
        frequency: 'daily@02:00',
        nextRunAt: new Date(),
      })
      .returning();

    // Bounded well under the default test timeout: before the fix this hung indefinitely
    // (PGlite's client-wide single-writer mutex deadlocks the inner query against the still-
    // open outer transaction) rather than rejecting quickly, so a tight timeout is what turns
    // that into a fast, legible failure instead of a full CI timeout.
    const response = await request(app)
      .put(`/api/test-plan-schedules/${schedule.id}`)
      .send({ scheduleName: 'Updated name' })
      .expect(200);

    expect(response.body.scheduleName).toBe('Updated name');

    const [stored] = await privilegedDb
      .select()
      .from(testPlanSchedules)
      .where(eq(testPlanSchedules.id, schedule.id));
    expect(stored.scheduleName).toBe('Updated name');
  }, 15000);
});

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { db } from './db';
import {
  testPlans, type TestPlan,
  testPlanSchedules, type InsertTestPlanSchedule,
  testPlanExecutions, type InsertTestPlanExecution
} from '../shared/schema';
import { eq, and, desc, getTableColumns } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

let app: Application;
const mockUser = { id: 1, username: 'testuser_exec' };

async function setupTestAppForExecutions() {
  const tempApp = express();
  tempApp.use(express.json());
  tempApp.use((req: Request, res: Response, next: NextFunction) => {
    req.user = mockUser as any;
    req.isAuthenticated = () => true;
    next();
  });
  const { registerRoutes } = await import('./routes');
  await registerRoutes(tempApp);
  return tempApp;
}

let seededPlan: TestPlan;
let seededSchedule1: InsertTestPlanSchedule;
let seededSchedule2: InsertTestPlanSchedule;

beforeAll(async () => {
  app = await setupTestAppForExecutions();
});

beforeEach(async () => {
  await db.delete(testPlanExecutions);
  await db.delete(testPlanSchedules);
  await db.delete(testPlans);
  vi.clearAllMocks();

  const planId = uuidv4();
  [seededPlan] = await db.insert(testPlans).values({ id: planId, name: 'Execution Test Plan' }).returning();

  seededSchedule1 = {
    id: uuidv4(), testPlanId: seededPlan.id, scheduleName: 'Exec Sched 1',
    frequency: 'daily', nextRunAt: Date.now(), environment: 'QA', browsers: JSON.stringify(['chrome'])
  };
  seededSchedule2 = {
    id: uuidv4(), testPlanId: seededPlan.id, scheduleName: 'Exec Sched 2',
    frequency: 'weekly', nextRunAt: Date.now(), environment: 'Staging', browsers: JSON.stringify(['firefox'])
  };
  await db.insert(testPlanSchedules).values([seededSchedule1, seededSchedule2]);
});

afterAll(async () => {
  await db.delete(testPlanExecutions);
  await db.delete(testPlanSchedules);
  await db.delete(testPlans);
});

describe('Test Plan Executions API (/api/test-plan-executions)', () => {
  it('should get all executions, parsing JSON fields', async () => {
    const exec1: InsertTestPlanExecution = {
      id: uuidv4(), testPlanId: seededPlan.id, scheduleId: seededSchedule1.id, status: 'completed',
      results: JSON.stringify({ steps: 5, outcome: 'passed' }), browsers: JSON.stringify(['chrome']), environment: 'QA', triggeredBy: 'scheduled'
    };
    const exec2: InsertTestPlanExecution = {
      id: uuidv4(), testPlanId: seededPlan.id, scheduleId: seededSchedule2.id, status: 'failed',
      results: JSON.stringify({ steps: 2, error: 'assertion failed' }), browsers: JSON.stringify(['firefox']), environment: 'Staging', triggeredBy: 'manual'
    };
    await db.insert(testPlanExecutions).values([exec1, exec2]);

    const response = await request(app)
      .get('/api/test-plan-executions')
      .expect(200);

    expect(response.body.items.length).toBe(2);
    const e1 = response.body.items.find((e:any) => e.id === exec1.id);
    const e2 = response.body.items.find((e:any) => e.id === exec2.id);

    expect(e1.status).toBe('completed');
    expect(e1.results).toEqual({ steps: 5, outcome: 'passed' });
    expect(e1.browsers).toEqual(['chrome']);
    expect(e1.testPlanName).toBe(seededPlan.name);
    expect(e1.scheduleName).toBe(seededSchedule1.scheduleName);

    expect(e2.status).toBe('failed');
    expect(e2.results).toEqual({ steps: 2, error: 'assertion failed' });
    expect(e2.browsers).toEqual(['firefox']);
  });

  it('should filter executions by planId', async () => {
    const otherPlanId = uuidv4();
    await db.insert(testPlans).values({ id: otherPlanId, name: 'Other Plan' });
    const exec1: InsertTestPlanExecution = { id: uuidv4(), testPlanId: seededPlan.id, status: 'completed' };
    const exec2: InsertTestPlanExecution = { id: uuidv4(), testPlanId: otherPlanId, status: 'pending' };
    await db.insert(testPlanExecutions).values([exec1, exec2]);

    const response = await request(app)
      .get(`/api/test-plan-executions?planId=${seededPlan.id}`)
      .expect(200);

    expect(response.body.items.length).toBe(1);
    expect(response.body.items[0].testPlanId).toBe(seededPlan.id);
  });

  it('should filter executions by scheduleId', async () => {
    const exec1: InsertTestPlanExecution = { id: uuidv4(), testPlanId: seededPlan.id, scheduleId: seededSchedule1.id, status: 'completed' };
    const exec2: InsertTestPlanExecution = { id: uuidv4(), testPlanId: seededPlan.id, scheduleId: seededSchedule2.id, status: 'running' };
    await db.insert(testPlanExecutions).values([exec1, exec2]);

    const response = await request(app)
      .get(`/api/test-plan-executions?scheduleId=${seededSchedule1.id}`)
      .expect(200);

    expect(response.body.items.length).toBe(1);
    expect(response.body.items[0].scheduleId).toBe(seededSchedule1.id);
  });

  it('should filter executions by status', async () => {
    const exec1: InsertTestPlanExecution = { id: uuidv4(), testPlanId: seededPlan.id, status: 'completed' };
    const exec2: InsertTestPlanExecution = { id: uuidv4(), testPlanId: seededPlan.id, status: 'failed' };
    await db.insert(testPlanExecutions).values([exec1, exec2]);

    const response = await request(app)
      .get(`/api/test-plan-executions?status=failed`)
      .expect(200);

    expect(response.body.items.length).toBe(1);
    expect(response.body.items[0].status).toBe('failed');
  });

  it('should filter executions by triggeredBy', async () => {
    const exec1: InsertTestPlanExecution = { id: uuidv4(), testPlanId: seededPlan.id, triggeredBy: 'scheduled', status: 'completed' };
    const exec2: InsertTestPlanExecution = { id: uuidv4(), testPlanId: seededPlan.id, triggeredBy: 'manual', status: 'completed' };
    await db.insert(testPlanExecutions).values([exec1, exec2]);

    const response = await request(app)
      .get(`/api/test-plan-executions?triggeredBy=manual`)
      .expect(200);

    expect(response.body.items.length).toBe(1);
    expect(response.body.items[0].triggeredBy).toBe('manual');
  });

  it('should handle pagination with limit and offset', async () => {
    const execs: InsertTestPlanExecution[] = [];
    for (let i = 0; i < 15; i++) {
      execs.push({ id: uuidv4(), testPlanId: seededPlan.id, status: 'pending', startedAt: Date.now() + i }); // Ensure different startedAt for consistent order
    }
    await db.insert(testPlanExecutions).values(execs);

    // Get first page
    let response = await request(app)
      .get('/api/test-plan-executions?limit=5&offset=0')
      .expect(200);
    expect(response.body.items.length).toBe(5);
    const firstIdOnPage1 = response.body.items[0].id;

    // Get second page
    response = await request(app)
      .get('/api/test-plan-executions?limit=5&offset=5')
      .expect(200);
    expect(response.body.items.length).toBe(5);
    expect(response.body.items[0].id).not.toBe(firstIdOnPage1);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { db } from './db'; // Main DB import
import { testPlanSchedules, testPlans, type InsertTestPlanSchedule, type TestPlanSchedule, type TestPlan } from '../shared/schema';
import { eq, leftJoin, desc, getTableColumns } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import schedulerService from './scheduler-service'; // Import the actual service

// Mock the schedulerService
vi.mock('./scheduler-service', () => ({
  default: {
    addScheduleJob: vi.fn(),
    updateScheduleJob: vi.fn(),
    removeScheduleJob: vi.fn(),
    initializeScheduler: vi.fn(), // Should not be called by routes directly usually
  }
}));

let app: Application;
const mockUser = { id: 1, username: 'testuser' };

async function setupTestApp() {
  const tempApp = express();
  tempApp.use(express.json());
  tempApp.use((req: Request, res: Response, next: NextFunction) => {
    req.user = mockUser as any;
    req.isAuthenticated = () => true;
    next();
  });

  // Import actual routes from your application
  // This requires your routes.ts to export a function that takes an app instance
  // or that the app instance used by tests is the one from server/index.ts (more complex setup)
  // For now, let's assume we are testing the actual routes module.
  // We need to ensure the routes from server/routes.ts are applied to `tempApp`.
  // This is a simplified way. Ideally, you'd import your configured app instance.
  const { registerRoutes } = await import('./routes'); // Adjust if your routes are default export
  await registerRoutes(tempApp); // This will register all routes, including /api/test-plan-schedules

  return tempApp;
}


let seededPlan1: TestPlan;
let seededPlan2: TestPlan;

beforeAll(async () => {
  app = await setupTestApp(); // Setup app with actual routes
});

beforeEach(async () => {
  // Clear tables: testPlanSchedules first due to FK, then testPlans
  await db.delete(testPlanSchedules);
  await db.delete(testPlans);
  vi.clearAllMocks(); // Clear mocks before each test

  // Seed Test Plans
  const planId1 = uuidv4();
  const planId2 = uuidv4();
  [seededPlan1] = await db.insert(testPlans).values({ id: planId1, name: 'Default Test Plan 1', description: 'For general testing' }).returning();
  [seededPlan2] = await db.insert(testPlans).values({ id: planId2, name: 'Default Test Plan 2', description: 'Another plan' }).returning();
});

afterAll(async () => {
  // Clean up seeded data
  await db.delete(testPlanSchedules);
  await db.delete(testPlans);
});


describe('Test Plan Schedules API (/api/test-plan-schedules)', () => {
  describe('POST /api/test-plan-schedules', () => {
    it('should create a new schedule with valid data and call schedulerService.addScheduleJob', async () => {
      const newSchedulePayload: Omit<InsertTestPlanSchedule, 'id' | 'createdAt' | 'updatedAt'> = {
        scheduleName: 'Nightly QA Run',
        testPlanId: seededPlan1.id,
        frequency: 'daily@02:00',
        nextRunAt: Math.floor(new Date('2025-01-01T02:00:00Z').getTime() / 1000),
        environment: 'QA',
        browsers: JSON.stringify(['chromium', 'firefox']),
        isActive: true,
        retryOnFailure: 'once',
        notificationConfigOverride: JSON.stringify({ emails: 'qa@example.com', onSuccess: true, onFailure: true }),
        executionParameters: JSON.stringify({ customVar: 'nightlyValue' }),
      };

      const response = await request(app)
        .post('/api/test-plan-schedules')
        .send(newSchedulePayload)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      const scheduleId = response.body.id;
      expect(response.body.scheduleName).toBe(newSchedulePayload.scheduleName);
      expect(response.body.testPlanId).toBe(newSchedulePayload.testPlanId);
      expect(response.body.testPlanName).toBe(seededPlan1.name);
      expect(response.body.environment).toBe('QA');
      expect(response.body.browsers).toEqual(['chromium', 'firefox']); // Expect parsed JSON
      expect(response.body.isActive).toBe(true);
      expect(response.body.retryOnFailure).toBe('once');

      const dbSchedule = await db.select().from(testPlanSchedules).where(eq(testPlanSchedules.id, scheduleId));
      expect(dbSchedule.length).toBe(1);
      expect(dbSchedule[0].testPlanId).toBe(newSchedulePayload.testPlanId);
      expect(dbSchedule[0].environment).toBe('QA');

      expect(schedulerService.addScheduleJob).toHaveBeenCalledTimes(1);
      // Check if addScheduleJob was called with the schedule that has the correct id
      expect(schedulerService.addScheduleJob).toHaveBeenCalledWith(
        expect.objectContaining({ id: scheduleId, scheduleName: newSchedulePayload.scheduleName })
      );
    });

    it('should return 400 for invalid payload (e.g., missing required fields)', async () => {
        const invalidPayload = { testPlanId: seededPlan1.id }; // Missing scheduleName, frequency, nextRunAt
        await request(app)
            .post('/api/test-plan-schedules')
            .send(invalidPayload)
            .expect(400);
        expect(schedulerService.addScheduleJob).not.toHaveBeenCalled();
    });

    it('should return 400 when creating a schedule with a non-existent testPlanId', async () => {
      const newSchedulePayload = {
        scheduleName: 'Invalid Plan Run', testPlanId: uuidv4(), frequency: 'Daily',
        nextRunAt: Math.floor(new Date().getTime() / 1000), environment: "QA", browsers: JSON.stringify(["chromium"])
      };
      const response = await request(app)
        .post('/api/test-plan-schedules')
        .send(newSchedulePayload)
        .expect(400);
      expect(response.body.error).toContain("Invalid Test Plan ID");
      expect(schedulerService.addScheduleJob).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/test-plan-schedules', () => {
    it('should return all schedules with their testPlanName joined and JSON fields parsed', async () => {
      const schedule1Data: InsertTestPlanSchedule = {
        id: uuidv4(), scheduleName: 'Schedule A', testPlanId: seededPlan1.id,
        frequency: 'Daily', nextRunAt: Math.floor(Date.now() / 1000),
        browsers: JSON.stringify(['chromium']), isActive: true, retryOnFailure: 'none'
      };
      await db.insert(testPlanSchedules).values(schedule1Data);

      const response = await request(app)
        .get('/api/test-plan-schedules')
        .expect(200);

      expect(response.body.length).toBe(1);
      expect(response.body[0].scheduleName).toBe(schedule1Data.scheduleName);
      expect(response.body[0].testPlanId).toBe(seededPlan1.id);
      expect(response.body[0].testPlanName).toBe(seededPlan1.name);
      expect(response.body[0].browsers).toEqual(['chromium']);
    });
  });

  describe('GET /api/test-plan-schedules/plan/:planId', () => {
    it('should return schedules for a specific test planId', async () => {
      const s1Id = uuidv4();
      const s2Id = uuidv4();
      await db.insert(testPlanSchedules).values([
        { id: s1Id, scheduleName: 'Plan1 Sched1', testPlanId: seededPlan1.id, frequency: 'once', nextRunAt: Date.now(), environment: 'QA', browsers: JSON.stringify(['chrome']) },
        { id: s2Id, scheduleName: 'Plan2 Sched1', testPlanId: seededPlan2.id, frequency: 'daily', nextRunAt: Date.now(), environment: 'Staging', browsers: JSON.stringify(['firefox']) },
      ]);

      const response = await request(app)
        .get(`/api/test-plan-schedules/plan/${seededPlan1.id}`)
        .expect(200);

      expect(response.body.length).toBe(1);
      expect(response.body[0].id).toBe(s1Id);
      expect(response.body[0].scheduleName).toBe('Plan1 Sched1');
      expect(response.body[0].testPlanName).toBe(seededPlan1.name);
      expect(response.body[0].environment).toBe('QA');
    });
  });


  describe('PUT /api/test-plan-schedules/:id', () => {
    it('should update an existing schedule and call schedulerService.updateScheduleJob', async () => {
      const scheduleId = uuidv4();
      const initialSchedule: InsertTestPlanSchedule = {
        id: scheduleId, scheduleName: 'Initial Name', testPlanId: seededPlan1.id,
        frequency: 'Daily', nextRunAt: Math.floor(Date.now() / 1000),
        environment: 'Dev', browsers: JSON.stringify(['webkit']), isActive: true, retryOnFailure: 'none'
      };
      await db.insert(testPlanSchedules).values(initialSchedule);

      const updatedData = {
        scheduleName: 'Updated Schedule Name',
        testPlanId: seededPlan2.id,
        frequency: 'Weekly',
        environment: 'Staging',
        browsers: ['firefox', 'edge'], // Send as array, server should stringify
        isActive: false,
        retryOnFailure: 'twice',
      };

      const response = await request(app)
        .put(`/api/test-plan-schedules/${scheduleId}`)
        .send(updatedData)
        .expect(200);

      expect(response.body.scheduleName).toBe(updatedData.scheduleName);
      expect(response.body.testPlanId).toBe(updatedData.testPlanId);
      expect(response.body.testPlanName).toBe(seededPlan2.name);
      expect(response.body.frequency).toBe(updatedData.frequency);
      expect(response.body.environment).toBe('Staging');
      expect(response.body.browsers).toEqual(['firefox', 'edge']);
      expect(response.body.isActive).toBe(false);
      expect(response.body.retryOnFailure).toBe('twice');

      const dbSchedule = await db.select().from(testPlanSchedules).where(eq(testPlanSchedules.id, scheduleId));
      expect(dbSchedule[0].testPlanId).toBe(updatedData.testPlanId);
      expect(dbSchedule[0].environment).toBe('Staging');
      expect(dbSchedule[0].isActive).toBe(0); // SQLite stores boolean as 0/1

      expect(schedulerService.updateScheduleJob).toHaveBeenCalledTimes(1);
      expect(schedulerService.updateScheduleJob).toHaveBeenCalledWith(
        expect.objectContaining({ id: scheduleId, isActive: false }) // Check that the updated schedule is passed
      );
    });
  });

  describe('DELETE /api/test-plan-schedules/:id', () => {
    it('should delete an existing schedule and call schedulerService.removeScheduleJob', async () => {
      const scheduleId = uuidv4();
      const scheduleToDelete: InsertTestPlanSchedule = {
        id: scheduleId, scheduleName: 'To Delete', testPlanId: seededPlan1.id,
        frequency: 'Once', nextRunAt: Math.floor(Date.now() / 1000),
        environment: 'Prod', browsers: JSON.stringify(['all'])
      };
      await db.insert(testPlanSchedules).values(scheduleToDelete);

      await request(app)
        .delete(`/api/test-plan-schedules/${scheduleId}`)
        .expect(204);

      const dbSchedule = await db.select().from(testPlanSchedules).where(eq(testPlanSchedules.id, scheduleId));
      expect(dbSchedule.length).toBe(0);
      expect(schedulerService.removeScheduleJob).toHaveBeenCalledTimes(1);
      expect(schedulerService.removeScheduleJob).toHaveBeenCalledWith(scheduleId);
    });

    it('should return 404 if schedule to delete is not found', async () => {
        await request(app).delete(`/api/test-plan-schedules/${uuidv4()}`).expect(404);
        expect(schedulerService.removeScheduleJob).not.toHaveBeenCalled();
    });
  });
});

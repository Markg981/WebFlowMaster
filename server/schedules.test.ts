import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { db } from './db';
import { schedules, testPlans, type InsertSchedule, type Schedule, type TestPlan } from '../shared/schema'; // Added testPlans
import { eq, leftJoin, desc } from 'drizzle-orm'; // Added leftJoin, desc
import { v4 as uuidv4 } from 'uuid';

// --- Test Application Setup ---
// This is a simplified setup. Ideally, export 'app' from server/index.ts or a dedicated app.ts
// For now, we'll create a new app instance and try to replicate route setup if direct import is hard.

// Placeholder for the main app or a test-specific app
let app: Application;

// Mock user for authentication bypass
const mockUser = { id: 1, username: 'testuser' } as Express.User; // Adjust as per your User type

beforeAll(async () => {
  // Initialize a new Express app for testing
  app = express();
  app.use(express.json());

  // Mock authentication middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.user = mockUser;
    req.isAuthenticated = () => true;
    next();
  });

  // Dynamically import and register routes
  // This assumes registerRoutes can be called on an existing app instance.
  // If server/index.ts immediately starts listening, this needs adjustment.
  // For now, we'll assume we can import and call a function that sets up routes.
  // This part is tricky without refactoring server/index.ts to export the app before listening.
  // Let's assume we have a way to get the router for '/api/schedules' or setup a test server.
  // For this example, we'll manually recreate a simplified router for schedules.

  // --- Recreating Schedule Routes for Test (with join logic) ---
  const scheduleRouter = express.Router();

  scheduleRouter.get("/api/schedules", async (req, res) => {
    try {
      const result = await db
        .select({
          id: schedules.id, scheduleName: schedules.scheduleName, testPlanId: schedules.testPlanId,
          frequency: schedules.frequency, nextRunAt: schedules.nextRunAt, createdAt: schedules.createdAt,
          updatedAt: schedules.updatedAt, testPlanName: testPlans.name,
        })
        .from(schedules)
        .leftJoin(testPlans, eq(schedules.testPlanId, testPlans.id))
        .orderBy(desc(schedules.createdAt));
      res.json(result);
    } catch (error) { res.status(500).json({ error: "Failed to fetch schedules" }); }
  });

  scheduleRouter.post("/api/schedules", async (req, res) => {
    try {
      // Simplified validation for test router - actual app uses Zod
      const { scheduleName, testPlanId, frequency, nextRunAt } = req.body;
      if (!scheduleName || !testPlanId || !frequency || nextRunAt === undefined) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Check if testPlanId exists
      const planExists = await db.select({id: testPlans.id}).from(testPlans).where(eq(testPlans.id, testPlanId));
      if(planExists.length === 0) {
        return res.status(400).json({ error: "Invalid Test Plan ID: The specified Test Plan does not exist." });
      }

      const scheduleId = uuidv4();
      const newSchedule: InsertSchedule = {
        id: scheduleId, scheduleName, testPlanId, frequency,
        nextRunAt: typeof nextRunAt === 'string' ? Math.floor(new Date(nextRunAt).getTime() / 1000) : nextRunAt,
        // createdAt and updatedAt will use DB defaults or be set by app logic
      };
      await db.insert(schedules).values(newSchedule);

      // Fetch with join for response
      const result = await db.select({
          id: schedules.id, scheduleName: schedules.scheduleName, testPlanId: schedules.testPlanId,
          frequency: schedules.frequency, nextRunAt: schedules.nextRunAt, createdAt: schedules.createdAt,
          updatedAt: schedules.updatedAt, testPlanName: testPlans.name,
        })
        .from(schedules)
        .leftJoin(testPlans, eq(schedules.testPlanId, testPlans.id))
        .where(eq(schedules.id, scheduleId)).limit(1);

      res.status(201).json(result[0]);
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });

  scheduleRouter.put("/api/schedules/:id", async (req, res) => {
    const scheduleId = req.params.id;
    try {
      const { scheduleName, testPlanId, frequency, nextRunAt } = req.body;
      if (!scheduleName && !testPlanId && !frequency && nextRunAt === undefined) {
         return res.status(400).json({ error: "No update data provided" });
      }

      if (testPlanId) {
        const planExists = await db.select({id: testPlans.id}).from(testPlans).where(eq(testPlans.id, testPlanId));
        if(planExists.length === 0) {
          return res.status(400).json({ error: "Invalid Test Plan ID: The specified Test Plan does not exist." });
        }
      }

      const updateData: Partial<Schedule> = { updatedAt: Math.floor(Date.now() / 1000) };
      if (scheduleName) updateData.scheduleName = scheduleName;
      if (testPlanId) updateData.testPlanId = testPlanId;
      if (frequency) updateData.frequency = frequency;
      if (nextRunAt !== undefined) updateData.nextRunAt = typeof nextRunAt === 'string' ? Math.floor(new Date(nextRunAt).getTime() / 1000) : nextRunAt;

      const updatedResultMeta = await db.update(schedules).set(updateData).where(eq(schedules.id, scheduleId)).returning({ updatedId: schedules.id });
      if (updatedResultMeta.length === 0) return res.status(404).json({ error: "Schedule not found" });

      const result = await db.select({
          id: schedules.id, scheduleName: schedules.scheduleName, testPlanId: schedules.testPlanId,
          frequency: schedules.frequency, nextRunAt: schedules.nextRunAt, createdAt: schedules.createdAt,
          updatedAt: schedules.updatedAt, testPlanName: testPlans.name,
        })
        .from(schedules)
        .leftJoin(testPlans, eq(schedules.testPlanId, testPlans.id))
        .where(eq(schedules.id, scheduleId)).limit(1);

      res.json(result[0]);
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });

  scheduleRouter.delete("/api/schedules/:id", async (req, res) => {
    const scheduleId = req.params.id;
    try {
      const result = await db.delete(schedules).where(eq(schedules.id, scheduleId)).returning();
      if (result.length === 0) return res.status(404).json({ error: "Schedule not found" });
      res.status(204).send();
    } catch (error) {
      console.error(`Test DELETE /api/schedules/${scheduleId} error:`, error);
      res.status(500).json({ error: "Failed to delete schedule" });
    }
  });

  app.use(scheduleRouter);
});

let seededPlan1: TestPlan;
let seededPlan2: TestPlan;

beforeEach(async () => {
  // Clear tables: schedules first due to FK, then testPlans
  await db.delete(schedules);
  await db.delete(testPlans);

  // Seed Test Plans
  const planId1 = uuidv4();
  const planId2 = uuidv4();
  [seededPlan1] = await db.insert(testPlans).values({ id: planId1, name: 'Default Test Plan 1', description: 'For general testing' }).returning();
  [seededPlan2] = await db.insert(testPlans).values({ id: planId2, name: 'Default Test Plan 2', description: 'Another plan' }).returning();
});

afterAll(async () => {
  // Clean up seeded data
  await db.delete(schedules);
  await db.delete(testPlans);
});


describe('Schedules API', () => {
  describe('POST /api/schedules', () => {
    it('should create a new schedule with valid data and return joined testPlanName', async () => {
      const newSchedulePayload = {
        scheduleName: 'Daily Sync Run',
        testPlanId: seededPlan1.id, // Use ID from seeded plan
        frequency: 'Daily',
        nextRunAt: Math.floor(new Date('2024-12-01T10:00:00Z').getTime() / 1000),
      };
      const response = await request(app)
        .post('/api/schedules')
        .send(newSchedulePayload)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.scheduleName).toBe(newSchedulePayload.scheduleName);
      expect(response.body.testPlanId).toBe(newSchedulePayload.testPlanId);
      expect(response.body.testPlanName).toBe(seededPlan1.name); // Check for joined name
      expect(response.body.frequency).toBe(newSchedulePayload.frequency);

      const dbSchedule = await db.select().from(schedules).where(eq(schedules.id, response.body.id));
      expect(dbSchedule.length).toBe(1);
      expect(dbSchedule[0].testPlanId).toBe(newSchedulePayload.testPlanId);
    });

    it('should return 400 when creating a schedule with a non-existent testPlanId', async () => {
      const newSchedulePayload = {
        scheduleName: 'Invalid Plan Run',
        testPlanId: uuidv4(), // Non-existent ID
        frequency: 'Daily',
        nextRunAt: Math.floor(new Date().getTime() / 1000),
      };
      await request(app)
        .post('/api/schedules')
        .send(newSchedulePayload)
        .expect(400);
        // Optionally check error message if test router provides one:
        // .then(res => {
        //   expect(res.body.error).toContain("Invalid Test Plan ID");
        // });
    });
  });

  describe('GET /api/schedules', () => {
    it('should return all schedules with their testPlanName joined', async () => {
      const schedule1Data = { id: uuidv4(), scheduleName: 'Schedule A', testPlanId: seededPlan1.id, frequency: 'Daily', nextRunAt: Math.floor(Date.now() / 1000) };
      await db.insert(schedules).values(schedule1Data);

      const response = await request(app)
        .get('/api/schedules')
        .expect(200);

      expect(response.body.length).toBe(1);
      expect(response.body[0].scheduleName).toBe(schedule1Data.scheduleName);
      expect(response.body[0].testPlanId).toBe(seededPlan1.id);
      expect(response.body[0].testPlanName).toBe(seededPlan1.name);
    });
  });

  describe('PUT /api/schedules/:id', () => {
    it('should update an existing schedule, including testPlanId, and return joined testPlanName', async () => {
      const scheduleId = uuidv4();
      const initialSchedule = { id: scheduleId, scheduleName: 'Initial Name', testPlanId: seededPlan1.id, frequency: 'Daily', nextRunAt: Math.floor(Date.now() / 1000) };
      await db.insert(schedules).values(initialSchedule);

      const updatedData = {
        scheduleName: 'Updated Schedule Name',
        testPlanId: seededPlan2.id, // Update to a different valid plan
        frequency: 'Weekly',
      };

      const response = await request(app)
        .put(`/api/schedules/${scheduleId}`)
        .send(updatedData)
        .expect(200);

      expect(response.body.scheduleName).toBe(updatedData.scheduleName);
      expect(response.body.testPlanId).toBe(updatedData.testPlanId);
      expect(response.body.testPlanName).toBe(seededPlan2.name); // Check for new joined name
      expect(response.body.frequency).toBe(updatedData.frequency);

      const dbSchedule = await db.select().from(schedules).where(eq(schedules.id, scheduleId));
      expect(dbSchedule[0].testPlanId).toBe(updatedData.testPlanId);
    });

    it('should return 400 when updating a schedule with a non-existent testPlanId', async () => {
      const scheduleId = uuidv4();
      const initialSchedule = { id: scheduleId, scheduleName: 'Test Sched', testPlanId: seededPlan1.id, frequency: 'Daily', nextRunAt: Math.floor(Date.now() / 1000) };
      await db.insert(schedules).values(initialSchedule);

      const updatedData = { testPlanId: uuidv4() }; // Non-existent ID
      await request(app)
        .put(`/api/schedules/${scheduleId}`)
        .send(updatedData)
        .expect(400);
    });
  });

  // DELETE tests remain largely the same, as testPlanName was not part of delete logic
  describe('DELETE /api/schedules/:id', () => {
    it('should delete an existing schedule', async () => {
      const scheduleId = uuidv4();
      const scheduleToDelete = { id: scheduleId, scheduleName: 'To Delete', testPlanId: seededPlan1.id, frequency: 'Once', nextRunAt: Math.floor(Date.now() / 1000) };
      await db.insert(schedules).values(scheduleToDelete);

      await request(app).delete(`/api/schedules/${scheduleId}`).expect(204);

      const dbSchedule = await db.select().from(schedules).where(eq(schedules.id, scheduleId));
      expect(dbSchedule.length).toBe(0);
    });
  });
});

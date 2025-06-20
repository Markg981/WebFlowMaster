import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { db } from './db';
import {
  tests,
  users,
  projects,
  insertTestSchema,
  AdhocTestStepSchema,
  AdhocDetectedElementSchema,
  type User,
  type Project,
  type InsertUser,
  type InsertProject,
  type Test
} from '../shared/schema';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';

// Mock logger
vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn() },
  updateLogLevel: vi.fn(),
}));

let app: Application;
const mockUser1 = { id: 1, username: 'testuser1', password: 'password1' } as User;
let currentMockUser: User = mockUser1;

// Define the Zod schema for the POST /api/tests request body, mirroring server/routes.ts
const createTestBodySchema = insertTestSchema.extend({
  projectId: z.number().int().positive(),
  sequence: z.array(AdhocTestStepSchema),
  elements: z.array(AdhocDetectedElementSchema),
}).omit({ userId: true, id: true, createdAt: true, updatedAt: true });


beforeAll(async () => {
  app = express();
  app.use(express.json());

  app.use((req: Request, res: Response, next: NextFunction) => {
    req.user = currentMockUser;
    req.isAuthenticated = () => true;
    next();
  });

  const generalTestRouter = express.Router();

  generalTestRouter.post("/api/tests", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;
    const resolvedLogger = (await vi.importActual('./logger') as any).default; // Get actual logger for router logic

    const parseResult = createTestBodySchema.safeParse(req.body);

    if (!parseResult.success) {
      resolvedLogger.warn({ message: "POST /api/tests - Invalid payload (test)", errors: parseResult.error.flatten(), userId });
      return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() });
    }

    const { name, url, sequence, elements, projectId, status } = parseResult.data;

    try {
      const newTestResult = await db
        .insert(tests)
        .values({
          userId,
          projectId,
          name,
          url,
          sequence: JSON.stringify(sequence),
          elements: JSON.stringify(elements),
          status: status || "draft",
        })
        .returning();

      if (newTestResult.length === 0) {
        resolvedLogger.error({ message: "Test creation failed, no record returned (test).", name, userId });
        return res.status(500).json({ error: "Failed to create test." });
      }
      res.status(201).json(newTestResult[0]);
    } catch (error: any) {
      resolvedLogger.error({ message: "Error creating test (test)", userId, testName: name, error: error.message, stack: error.stack });
      if (error.message && error.message.includes('FOREIGN KEY constraint failed')) {
        return res.status(400).json({ error: "Invalid project ID or project does not exist." });
      }
      res.status(500).json({ error: "Failed to create test" });
    }
  });

  app.use(generalTestRouter);
});

let seededUser: User;
let seededProject: Project;

beforeEach(async () => {
  await db.delete(tests); // Depends on projects and users
  await db.delete(projects); // Depends on users
  await db.delete(users);

  [seededUser] = await db.insert(users).values({ id: mockUser1.id, username: mockUser1.username, password: 'hashed_password' } as InsertUser).returning();
  [seededProject] = await db.insert(projects).values({ name: 'Test Project', userId: seededUser.id } as InsertProject).returning();

  currentMockUser = mockUser1; // Reset to default mock user
});

afterAll(async () => {
  await db.delete(tests);
  await db.delete(projects);
  await db.delete(users);
});

describe('POST /api/tests', () => {
  const validSequence: any[] = [{ id: 'step1', action: { id: 'click', type: 'click', name: 'Click', icon: '', description: '' }, targetElement: { id: 'elem1', type: 'button', selector: '#btn', text: 'Click me', tag: 'button', attributes: {} }, value: '' }];
  const validElements: any[] = [{ id: 'elem1', type: 'button', selector: '#btn', text: 'Click me', tag: 'button', attributes: {} }];

  it('should create a new test with valid data', async () => {
    const testPayload = {
      name: 'My New Test',
      url: 'http://example.com',
      projectId: seededProject.id,
      sequence: validSequence,
      elements: validElements,
      status: 'draft',
    };

    const response = await request(app)
      .post('/api/tests')
      .send(testPayload)
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.name).toBe(testPayload.name);
    expect(response.body.userId).toBe(seededUser.id);
    expect(response.body.projectId).toBe(seededProject.id);
    expect(response.body.url).toBe(testPayload.url);
    expect(response.body.status).toBe('draft');

    // Verify data in DB
    const dbTest = await db.select().from(tests).where(eq(tests.id, response.body.id)).limit(1);
    expect(dbTest.length).toBe(1);
    expect(dbTest[0].name).toBe(testPayload.name);
    expect(JSON.parse(dbTest[0].sequence as string)).toEqual(validSequence);
    expect(JSON.parse(dbTest[0].elements as string)).toEqual(validElements);
  });

  it('should fail if name is missing', async () => {
    const testPayload = {
      url: 'http://example.com',
      projectId: seededProject.id,
      sequence: validSequence,
      elements: validElements,
    };
    await request(app).post('/api/tests').send(testPayload).expect(400);
  });

  it('should fail if url is missing', async () => {
    const testPayload = {
      name: 'Test without URL',
      projectId: seededProject.id,
      sequence: validSequence,
      elements: validElements,
    };
    await request(app).post('/api/tests').send(testPayload).expect(400);
  });

  it('should fail if projectId is missing', async () => {
    const testPayload = {
      name: 'Test without Project',
      url: 'http://example.com',
      sequence: validSequence,
      elements: validElements,
    };
    await request(app).post('/api/tests').send(testPayload).expect(400);
  });

  it('should fail if sequence is missing or not an array', async () => {
    const testPayload = {
      name: 'Test without Sequence',
      url: 'http://example.com',
      projectId: seededProject.id,
      elements: validElements,
    };
    await request(app).post('/api/tests').send(testPayload).expect(400);

    const testPayloadInvalidSequence = { ...testPayload, sequence: "not an array" };
    await request(app).post('/api/tests').send(testPayloadInvalidSequence).expect(400);
  });

  it('should fail if elements is missing or not an array', async () => {
    const testPayload = {
      name: 'Test without Elements',
      url: 'http://example.com',
      projectId: seededProject.id,
      sequence: validSequence,
    };
    await request(app).post('/api/tests').send(testPayload).expect(400);

    const testPayloadInvalidElements = { ...testPayload, elements: "not an array" };
    await request(app).post('/api/tests').send(testPayloadInvalidElements).expect(400);
  });

  it('should fail with 400 for an invalid (non-existent) projectId', async () => {
    const testPayload = {
      name: 'Test with Invalid Project',
      url: 'http://example.com',
      projectId: 99999, // Non-existent project ID
      sequence: validSequence,
      elements: validElements,
    };
    await request(app).post('/api/tests').send(testPayload).expect(400);
  });

  it('should fail with 401 if user is not authenticated', async () => {
    currentMockUser = null as any; // Simulate unauthenticated user
    const testPayload = {
      name: 'Unauthenticated Test',
      url: 'http://example.com',
      projectId: seededProject.id,
      sequence: validSequence,
      elements: validElements,
    };
    await request(app).post('/api/tests').send(testPayload).expect(401);
    currentMockUser = mockUser1; // Reset for other tests
  });
});

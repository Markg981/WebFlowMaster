import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { db } from './db';
import {
  apiTests,
  users,
  projects,
  type InsertApiTest,
  type User,
  type Project,
  type InsertUser,
  type InsertProject
} from '../shared/schema';
import { eq, and, desc, getTableColumns, leftJoin } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid'; // Not strictly needed for these tests but good for consistency if IDs were strings

// Mock logger to prevent console output during tests, unless explicitly needed
vi.mock('./logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    http: vi.fn(),
  },
  updateLogLevel: vi.fn(),
}));


let app: Application;

// Define mock users (without IDs initially, as they will be auto-generated)
const mockUser1Data = { username: 'user1', password: 'password1' };
const mockUser2Data = { username: 'user2', password: 'password2' };

// Variable to switch authenticated user for testing authorization
// Will hold the full User object including the auto-generated ID after seeding
let currentMockUser: User;
let _seededUser1: User; // To store user1 with its DB-generated ID (renamed)
let _seededUser2: User; // To store user2 with its DB-generated ID (renamed)
// The rest of the seeded variables remain as they are, assuming they are not causing the "already declared" issue.
// If the issue persists for them, they would also need renaming or careful scoping.
let seededProject1User1: Project;
let seededApiTestUser1Project1: InsertApiTest;
let seededApiTestUser1NoProject: InsertApiTest;
let seededApiTestUser2: InsertApiTest;


beforeAll(async () => {
  app = express();
  app.use(express.json());

  // Mock authentication middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.user = currentMockUser; // Use the switchable mock user
    req.isAuthenticated = () => true;
    next();
  });

  // Simplified API Test Router (replicating essential logic from server/routes.ts)
  const apiTestRouter = express.Router();

  // GET /api/api-tests
  apiTestRouter.get("/api/api-tests", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;
    try {
      const userTestsWithDetails = await db
        .select({
          ...getTableColumns(apiTests),
          creatorUsername: users.username,
          projectName: projects.name,
        })
        .from(apiTests)
        .leftJoin(users, eq(apiTests.userId, users.id))
        .leftJoin(projects, eq(apiTests.projectId, projects.id))
        .where(eq(apiTests.userId, userId))
        .orderBy(desc(apiTests.updatedAt));
      res.json(userTestsWithDetails);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch API tests" });
    }
  });

  // GET /api/api-tests/:id
  apiTestRouter.get("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;
    const testId = parseInt(req.params.id);
    if (isNaN(testId)) {
      return res.status(400).json({ error: "Invalid test ID format" });
    }
    try {
      const result = await db
        .select({
          ...getTableColumns(apiTests),
          creatorUsername: users.username,
          projectName: projects.name,
        })
        .from(apiTests)
        .leftJoin(users, eq(apiTests.userId, users.id))
        .leftJoin(projects, eq(apiTests.projectId, projects.id))
        .where(and(eq(apiTests.id, testId), eq(apiTests.userId, userId)))
        .limit(1);
      if (result.length === 0) {
        return res.status(404).json({ error: "API Test not found or not authorized" });
      }
      res.json(result[0]);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch API test" });
    }
  });

  // DELETE /api/api-tests/:id
  apiTestRouter.delete("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;
    const testId = parseInt(req.params.id);
    if (isNaN(testId)) {
      return res.status(400).json({ error: "Invalid test ID format" });
    }
    try {
      const result = await db
        .delete(apiTests)
        .where(and(eq(apiTests.id, testId), eq(apiTests.userId, userId)))
        .returning({ id: apiTests.id }); // Check if any row was affected

      if (result.length === 0) {
        return res.status(404).json({ error: "API Test not found or not authorized for deletion" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete API test" });
    }
  });

  app.use(apiTestRouter); // Mount the router
});

// These are declared once at the module scope.
// The "already declared" error was likely due to a faulty previous edit/read cycle on my part.
// I will ensure the file content matches this structure.
// let seededUser1: User; // This was the duplicate line causing issues if it appeared again below
// let seededUser2: User; // This was the duplicate line


beforeEach(async () => {
  // Clear tables in reverse order of dependencies or specific order
  await db.delete(apiTests);
  await db.delete(projects);
  await db.delete(users);

  // Seed Users
  // Drizzle's .returning() gives an array, so destructure to get the object.
  // Do not specify IDs, let them be auto-generated.
  [seededUser1] = await db.insert(users).values({ username: mockUser1Data.username, password: 'hashed_password1' } as Omit<InsertUser, 'id'>).returning();
  [seededUser2] = await db.insert(users).values({ username: mockUser2Data.username, password: 'hashed_password2' } as Omit<InsertUser, 'id'>).returning();

  // Seed Projects
  [seededProject1User1] = await db.insert(projects).values({ name: 'User1 Project1', userId: seededUser1.id } as Omit<InsertProject, 'id'>).returning();

  // Seed ApiTests
  const testDataUser1Project1 = {
    userId: seededUser1.id,
    projectId: seededProject1User1.id,
    name: 'Test for User1, Project1',
    method: 'GET',
    url: 'http://example.com/user1/project1',
    // other fields can be null or default as per schema for simplicity in test setup
  };
  // No need to use .returning() if we don't need the full returned object with defaults like createdAt for direct comparison in tests (unless we do)
  // For these tests, we mainly care about what's queryable via API.
  await db.insert(apiTests).values(testDataUser1Project1);
  // Store a reference if needed, e.g. by re-selecting or assuming ID if auto-increment makes it predictable (not safe)
  // For simplicity, we will query them back in tests or rely on names/user to identify.
  // Let's retrieve them to have IDs for direct GET/DELETE tests.
  const insertedTestsUser1Project1 = await db.select().from(apiTests).where(and(eq(apiTests.name, testDataUser1Project1.name), eq(apiTests.userId, seededUser1.id)));
  seededApiTestUser1Project1 = insertedTestsUser1Project1[0];


  const testDataUser1NoProject = {
    userId: seededUser1.id,
    name: 'Test for User1, No Project',
    method: 'POST',
    url: 'http://example.com/user1/noproj',
  };
  await db.insert(apiTests).values(testDataUser1NoProject);
  const insertedTestsUser1NoProject = await db.select().from(apiTests).where(and(eq(apiTests.name, testDataUser1NoProject.name), eq(apiTests.userId, seededUser1.id)));
  seededApiTestUser1NoProject = insertedTestsUser1NoProject[0];


  const testDataUser2 = {
    userId: seededUser2.id,
    name: 'Test for User2',
    method: 'PUT',
    url: 'http://example.com/user2',
  };
  await db.insert(apiTests).values(testDataUser2);
  const insertedTestsUser2 = await db.select().from(apiTests).where(and(eq(apiTests.name, testDataUser2.name), eq(apiTests.userId, seededUser2.id)));
  seededApiTestUser2 = insertedTestsUser2[0];

  currentMockUser = mockUser1; // Default to user1 for tests
});

afterAll(async () => {
  await db.delete(apiTests);
  await db.delete(projects);
  await db.delete(users);
});

describe('API Tests Endpoints', () => {
  describe('GET /api/api-tests', () => {
    it('should return API tests for the authenticated user with creator and project names', async () => {
      currentMockUser = mockUser1; // Authenticate as user1
      const response = await request(app)
        .get('/api/api-tests')
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(2); // User1 has two tests

      const test1 = response.body.find((t: ApiTest) => t.name === 'Test for User1, Project1');
      const test2 = response.body.find((t: ApiTest) => t.name === 'Test for User1, No Project');

      expect(test1).toBeDefined();
      expect(test1.creatorUsername).toBe(seededUser1.username);
      expect(test1.projectName).toBe(seededProject1User1.name);
      expect(test1.userId).toBe(seededUser1.id);

      expect(test2).toBeDefined();
      expect(test2.creatorUsername).toBe(seededUser1.username);
      expect(test2.projectName).toBeNull(); // No project associated
      expect(test2.userId).toBe(seededUser1.id);
    });

    it('should return an empty array if the user has no API tests', async () => {
      // Authenticate as user2, who initially has one test. Delete it first.
      currentMockUser = mockUser2;
      await db.delete(apiTests).where(eq(apiTests.userId, seededUser2.id));

      const response = await request(app)
        .get('/api/api-tests')
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(0);
    });

    it('should not return tests from other users', async () => {
      currentMockUser = mockUser2; // Authenticate as user2
      const response = await request(app)
        .get('/api/api-tests')
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(1); // User2 has one test
      expect(response.body[0].name).toBe('Test for User2');
      expect(response.body[0].userId).toBe(seededUser2.id);
      expect(response.body[0].creatorUsername).toBe(seededUser2.username);
    });
  });

  describe('GET /api/api-tests/:id', () => {
    it('should return a single API test with details if it belongs to the user', async () => {
      currentMockUser = mockUser1;
      const testId = seededApiTestUser1Project1.id;
      const response = await request(app)
        .get(`/api/api-tests/${testId}`)
        .expect(200);

      expect(response.body.id).toBe(testId);
      expect(response.body.name).toBe(seededApiTestUser1Project1.name);
      expect(response.body.userId).toBe(seededUser1.id);
      expect(response.body.creatorUsername).toBe(seededUser1.username);
      expect(response.body.projectName).toBe(seededProject1User1.name);
    });

    it('should return 404 if the API test is not found', async () => {
      currentMockUser = mockUser1;
      const nonExistentId = 9999;
      await request(app)
        .get(`/api/api-tests/${nonExistentId}`)
        .expect(404);
    });

    it('should return 404 if the API test belongs to another user', async () => {
      currentMockUser = mockUser1; // User1 tries to access User2's test
      const testIdUser2 = seededApiTestUser2.id;
      await request(app)
        .get(`/api/api-tests/${testIdUser2}`)
        .expect(404); // Expecting 404 due to authorization rule in query
    });

    it('should return 400 if test ID is not a number', async () => {
      currentMockUser = mockUser1;
      await request(app)
        .get('/api/api-tests/invalid-id')
        .expect(400)
        .then(res => {
            expect(res.body.error).toBe("Invalid test ID format");
        });
    });
  });

  describe('DELETE /api/api-tests/:id', () => {
    it('should delete an API test if it belongs to the user', async () => {
      currentMockUser = mockUser1;
      const testIdToDelete = seededApiTestUser1Project1.id;

      await request(app)
        .delete(`/api/api-tests/${testIdToDelete}`)
        .expect(204);

      // Verify it's actually deleted from DB
      const dbCheck = await db.select().from(apiTests).where(eq(apiTests.id, testIdToDelete));
      expect(dbCheck.length).toBe(0);
    });

    it('should return 404 when trying to delete a non-existent API test', async () => {
      currentMockUser = mockUser1;
      const nonExistentId = 9999;
      await request(app)
        .delete(`/api/api-tests/${nonExistentId}`)
        .expect(404);
    });

    it('should return 404 when trying to delete an API test belonging to another user', async () => {
      currentMockUser = mockUser1; // User1 tries to delete User2's test
      const testIdUser2 = seededApiTestUser2.id;

      await request(app)
        .delete(`/api/api-tests/${testIdUser2}`)
        .expect(404);

      // Verify User2's test is still in the DB
      const dbCheck = await db.select().from(apiTests).where(eq(apiTests.id, testIdUser2));
      expect(dbCheck.length).toBe(1);
    });

    it('should return 400 if test ID is not a number', async () => {
        currentMockUser = mockUser1;
        await request(app)
          .delete('/api/api-tests/invalid-id')
          .expect(400)
          .then(res => {
              expect(res.body.error).toBe("Invalid test ID format");
          });
      });
  });
});

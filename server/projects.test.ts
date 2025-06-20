import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { db } from './db';
import {
  projects,
  users,
  tests,
  apiTests,
  insertProjectSchema, // For POST validation
  type Project,
  type User,
  type InsertUser,
  type InsertProject,
  type Test,
  type ApiTest,
  type InsertTest,
  type InsertApiTest
} from '../shared/schema';
import { z } from 'zod';
import { eq, and, desc, asc } from 'drizzle-orm';

// Mock logger
vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn() },
  updateLogLevel: vi.fn(),
}));

let app: Application;
const mockUser1 = { id: 1, username: 'user1', password: 'password1' } as User;
const mockUser2 = { id: 2, username: 'user2', password: 'password2' } as User;
let currentMockUser: User = mockUser1;
let resolvedLogger: any;


beforeAll(async () => {
  app = express();
  app.use(express.json());
  resolvedLogger = (await vi.importActual('./logger') as any).default;


  app.use((req: Request, res: Response, next: NextFunction) => {
    // For a specific test, we might want to simulate unauthenticated
    if (req.headers['x-test-unauthenticated'] === 'true') {
      // @ts-ignore // Allow setting user to null for testing
      req.user = null;
      req.isAuthenticated = () => false;
    } else {
      req.user = currentMockUser;
      req.isAuthenticated = () => true;
    }
    next();
  });

  const projectsRouter = express.Router();

  // POST /api/projects (copied from server/routes.ts for test setup)
  projectsRouter.post("/api/projects", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;
    const parseResult = insertProjectSchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({ message: "POST /api/projects - Invalid payload (test)", errors: parseResult.error.flatten(), userId });
      return res.status(400).json({ error: "Invalid project data", details: parseResult.error.flatten() });
    }
    const { name } = parseResult.data;
    try {
      const newProject = await db.insert(projects).values({ name, userId }).returning();
      if (newProject.length === 0) {
        resolvedLogger.error({ message: "Project creation failed, no record returned (test).", name, userId });
        return res.status(500).json({ error: "Failed to create project." });
      }
      res.status(201).json(newProject[0]);
    } catch (error: any) {
      resolvedLogger.error({ message: "Error creating project (test)", userId, projectName: name, error: error.message, stack: error.stack });
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  // DELETE /api/projects/:projectId
  projectsRouter.delete("/api/projects/:projectId", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;
    const projectId = parseInt(req.params.projectId, 10);

    if (isNaN(projectId)) {
        return res.status(400).json({ error: "Invalid project ID format" });
    }

    try {
        // Check if the project exists and belongs to the user
        const projectToDelete = await db.select()
            .from(projects)
            .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
            .limit(1);

        if (projectToDelete.length === 0) {
            return res.status(404).json({ error: "Project not found or not authorized" });
        }

        // Drizzle does not automatically cascade or set null on FKs at app-level for SQLite.
        // The schema definition { onDelete: 'set null' } is for the DB.
        // For SQLite, PRAGMA foreign_keys=ON; must be active.
        // We assume it is for this test. Drizzle will just issue the DELETE.

        await db.delete(projects).where(eq(projects.id, projectId)); // No .returning() needed for DELETE in this case for supertest

        res.status(204).send();
    } catch (error: any) {
        resolvedLogger.error({
            message: `Error deleting project ${projectId} for user ${userId}`,
            error: error.message,
            stack: error.stack,
        });
        res.status(500).json({ error: "Failed to delete project" });
    }
  });

  app.use(projectsRouter);
});

let seededUser1: User;
let seededUser2: User;
let seededProject1User1: Project;
let seededProject2User1: Project;
let seededProject1User2: Project;

let seededGeneralTest1ForP1U1: Test;
let seededApiTest1ForP1U1: ApiTest;


beforeEach(async () => {
  // Clear tables in order of dependency
  await db.delete(tests);
  await db.delete(apiTests);
  await db.delete(projects);
  await db.delete(users);

  // Seed Users
  [seededUser1] = await db.insert(users).values({ id: mockUser1.id, username: mockUser1.username, password: 'password' } as InsertUser).returning();
  [seededUser2] = await db.insert(users).values({ id: mockUser2.id, username: mockUser2.username, password: 'password' } as InsertUser).returning();

  // Seed Projects
  [seededProject1User1] = await db.insert(projects).values({ name: 'U1 Project 1', userId: seededUser1.id } as InsertProject).returning();
  [seededProject2User1] = await db.insert(projects).values({ name: 'U1 Project 2 (no tests)', userId: seededUser1.id } as InsertProject).returning();
  [seededProject1User2] = await db.insert(projects).values({ name: 'U2 Project 1', userId: seededUser2.id } as InsertProject).returning();

  // Seed general 'tests'
  const generalTestData: Omit<InsertTest, 'userId' | 'projectId'> = {
    name: 'General Test 1 for P1U1',
    url: 'http://example.com/gtest1',
    sequence: JSON.stringify([{ action: 'click' }]),
    elements: JSON.stringify([{ id: 'el1' }]),
    status: 'draft',
  };
  [seededGeneralTest1ForP1U1] = await db.insert(tests).values({
    ...generalTestData,
    userId: seededUser1.id,
    projectId: seededProject1User1.id,
  }).returning();

  // Seed 'apiTests'
  const apiTestData: Omit<InsertApiTest, 'userId' | 'projectId'> = {
    name: 'API Test 1 for P1U1',
    method: 'GET',
    url: 'http://example.com/api/test1',
    assertions: JSON.stringify([{id: 'a1', source: 'status_code', comparison: 'equals', targetValue: '200', enabled: true}]),
  };
  [seededApiTest1ForP1U1] = await db.insert(apiTests).values({
    ...apiTestData,
    userId: seededUser1.id,
    projectId: seededProject1User1.id,
  }).returning();

  currentMockUser = mockUser1; // Default to user1 for tests
});

afterAll(async () => {
  await db.delete(tests);
  await db.delete(apiTests);
  await db.delete(projects);
  await db.delete(users);
});

describe('DELETE /api/projects/:projectId', () => {
  it('should successfully delete a project owned by the authenticated user and set related tests projectId to NULL', async () => {
    currentMockUser = seededUser1; // Ensure user1 is authenticated

    // Verify initial state: general test linked to project
    const initialGeneralTest = await db.select().from(tests).where(eq(tests.id, seededGeneralTest1ForP1U1.id)).limit(1);
    expect(initialGeneralTest[0].projectId).toBe(seededProject1User1.id);

    // Verify initial state: API test linked to project
    const initialApiTest = await db.select().from(apiTests).where(eq(apiTests.id, seededApiTest1ForP1U1.id)).limit(1);
    expect(initialApiTest[0].projectId).toBe(seededProject1User1.id);

    await request(app)
      .delete(`/api/projects/${seededProject1User1.id}`)
      .expect(204);

    // Verify project is removed from DB
    const projectInDb = await db.select().from(projects).where(eq(projects.id, seededProject1User1.id)).limit(1);
    expect(projectInDb.length).toBe(0);

    // Verify tests.projectId is set to NULL
    const updatedGeneralTest = await db.select().from(tests).where(eq(tests.id, seededGeneralTest1ForP1U1.id)).limit(1);
    expect(updatedGeneralTest.length).toBe(1); // Test should still exist
    expect(updatedGeneralTest[0].projectId).toBeNull();

    // Verify apiTests.projectId is set to NULL
    const updatedApiTest = await db.select().from(apiTests).where(eq(apiTests.id, seededApiTest1ForP1U1.id)).limit(1);
    expect(updatedApiTest.length).toBe(1); // API Test should still exist
    expect(updatedApiTest[0].projectId).toBeNull();
  });

  it('should successfully delete a project with no referenced tests', async () => {
    currentMockUser = seededUser1;
    await request(app)
      .delete(`/api/projects/${seededProject2User1.id}`) // This project has no tests linked initially
      .expect(204);

    const projectInDb = await db.select().from(projects).where(eq(projects.id, seededProject2User1.id)).limit(1);
    expect(projectInDb.length).toBe(0);
  });

  it('should return 404 when trying to delete a project not owned by the authenticated user', async () => {
    currentMockUser = seededUser1; // User1
    const projectOfUser2 = seededProject1User2;

    await request(app)
      .delete(`/api/projects/${projectOfUser2.id}`)
      .expect(404); // Or 403, depending on how strict the "not authorized" vs "not found" is implemented

    // Verify project still exists
    const projectInDb = await db.select().from(projects).where(eq(projects.id, projectOfUser2.id)).limit(1);
    expect(projectInDb.length).toBe(1);
  });

  it('should return 404 when trying to delete a non-existent project', async () => {
    currentMockUser = seededUser1;
    const nonExistentProjectId = 99999;
    await request(app)
      .delete(`/api/projects/${nonExistentProjectId}`)
      .expect(404);
  });

  it('should return 400 if projectId is not a number', async () => {
    currentMockUser = seededUser1;
    await request(app)
      .delete('/api/projects/invalid-id')
      .expect(400)
      .then(res => {
          expect(res.body.error).toBe("Invalid project ID format");
      });
  });

  it('should return 401 if unauthenticated', async () => {
    // No need to set currentMockUser as the middleware will handle it based on header
    await request(app)
      .delete(`/api/projects/${seededProject1User1.id}`) // Use any valid project ID for the path
      .set('x-test-unauthenticated', 'true')
      .expect(401)
      .then(res => {
        expect(res.body.error).toBe("Unauthorized");
      });
  });
});

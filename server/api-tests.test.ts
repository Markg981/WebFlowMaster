import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { privilegedDb } from './db';
import {
  apiTests,
  tests,
  users,
  projects,
  type InsertApiTest,
  type User,
  type Project,
  type InsertUser,
  type InsertProject
} from '../shared/schema';
import { eq, and } from 'drizzle-orm';
import { createTestOrganization } from './tests/factories';
import { tenancyMiddleware } from './middleware/tenancy';
// Not strictly needed for these tests but good for consistency if IDs were strings

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
let seededUser1: User; // To store user1 with its DB-generated ID
let seededUser2: User; // To store user2 with its DB-generated ID
// The rest of the seeded variables remain as they are, assuming they are not causing the "already declared" issue.
// If the issue persists for them, they would also need renaming or careful scoping.
let seededProject1User1: Project;
let seededApiTestUser1Project1: InsertApiTest;
let _seededApiTestUser1NoProject: InsertApiTest;
let seededApiTestUser2: InsertApiTest;
let organizationId: number;


beforeAll(async () => {
  app = express();
  app.use(express.json());

  // Mock authentication middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.user = currentMockUser; // Use the switchable mock user
    req.isAuthenticated = () => true;
    next();
  });
  // Establishes the ambient organization from req.user, which withTenantTransaction
  // requires — the same middleware server/routes.ts mounts before every router.
  app.use(tenancyMiddleware);

  // Mount the REAL router. This suite used to re-implement the handlers inline, so it
  // validated a copy: the production route could (and did) drift — silently dropping
  // projectId — while these tests stayed green.
  const { default: testsRoutes } = await import('./routes/tests.routes');
  app.use(testsRoutes);
});

// These are declared once at the module scope.
// The "already declared" error was likely due to a faulty previous edit/read cycle on my part.
// I will ensure the file content matches this structure.
// let seededUser1: User; // This was the duplicate line causing issues if it appeared again below
// let seededUser2: User; // This was the duplicate line


beforeEach(async () => {
  // Clear tables in reverse order of dependencies or specific order
  await privilegedDb.delete(apiTests);
  // UI tests reference both users and projects, so they go before either. Nothing in this
  // file wrote to this table until the POST /api/tests cases below, and the omission showed
  // up as a foreign-key violation on the *next* test's cleanup rather than on the insert.
  await privilegedDb.delete(tests);
  await privilegedDb.delete(projects);
  await privilegedDb.delete(users);

  organizationId = await createTestOrganization();

  // Seed Users
  // Drizzle's .returning() gives an array, so destructure to get the object.
  // Do not specify IDs, let them be auto-generated.
  [seededUser1] = await privilegedDb.insert(users).values({ username: mockUser1Data.username, password: 'hashed_password1', organizationId } as Omit<InsertUser, 'id'>).returning();
  [seededUser2] = await privilegedDb.insert(users).values({ username: mockUser2Data.username, password: 'hashed_password2', organizationId } as Omit<InsertUser, 'id'>).returning();

  // Seed Projects
  [seededProject1User1] = await privilegedDb.insert(projects).values({ name: 'User1 Project1', userId: seededUser1.id, organizationId } as Omit<InsertProject, 'id'>).returning();

  // Seed ApiTests
  const testDataUser1Project1 = {
    userId: seededUser1.id,
    organizationId,
    projectId: seededProject1User1.id,
    name: 'Test for User1, Project1',
    method: 'GET',
    url: 'http://example.com/user1/project1',
    // other fields can be null or default as per schema for simplicity in test setup
  };
  // No need to use .returning() if we don't need the full returned object with defaults like createdAt for direct comparison in tests (unless we do)
  // For these tests, we mainly care about what's queryable via API.
  await privilegedDb.insert(apiTests).values(testDataUser1Project1);
  // Store a reference if needed, e.g. by re-selecting or assuming ID if auto-increment makes it predictable (not safe)
  // For simplicity, we will query them back in tests or rely on names/user to identify.
  // Let's retrieve them to have IDs for direct GET/DELETE tests.
  const insertedTestsUser1Project1 = await privilegedDb.select().from(apiTests).where(and(eq(apiTests.name, testDataUser1Project1.name), eq(apiTests.userId, seededUser1.id)));
  seededApiTestUser1Project1 = insertedTestsUser1Project1[0];


  const testDataUser1NoProject = {
    userId: seededUser1.id,
    organizationId,
    name: 'Test for User1, No Project',
    method: 'POST',
    url: 'http://example.com/user1/noproj',
  };
  await privilegedDb.insert(apiTests).values(testDataUser1NoProject);
  const insertedTestsUser1NoProject = await privilegedDb.select().from(apiTests).where(and(eq(apiTests.name, testDataUser1NoProject.name), eq(apiTests.userId, seededUser1.id)));
  _seededApiTestUser1NoProject = insertedTestsUser1NoProject[0];


  const testDataUser2 = {
    userId: seededUser2.id,
    organizationId,
    name: 'Test for User2',
    method: 'PUT',
    url: 'http://example.com/user2',
  };
  await privilegedDb.insert(apiTests).values(testDataUser2);
  const insertedTestsUser2 = await privilegedDb.select().from(apiTests).where(and(eq(apiTests.name, testDataUser2.name), eq(apiTests.userId, seededUser2.id)));
  seededApiTestUser2 = insertedTestsUser2[0];

  currentMockUser = seededUser1; // Default to user1 for tests
});

afterAll(async () => {
  await privilegedDb.delete(apiTests);
  // Same ordering as beforeEach, and for the same foreign key.
  await privilegedDb.delete(tests);
  await privilegedDb.delete(projects);
  await privilegedDb.delete(users);
});

describe('API Tests Endpoints', () => {
  describe('GET /api/api-tests', () => {
    it('should return API tests for the authenticated user with creator and project names', async () => {
      currentMockUser = seededUser1; // Authenticate as user1
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
      currentMockUser = seededUser2;
      await privilegedDb.delete(apiTests).where(eq(apiTests.userId, seededUser2.id));

      const response = await request(app)
        .get('/api/api-tests')
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(0);
    });

    it('should not return tests from other users', async () => {
      currentMockUser = seededUser2; // Authenticate as user2
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
      currentMockUser = seededUser1;
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
      currentMockUser = seededUser1;
      const nonExistentId = 9999;
      await request(app)
        .get(`/api/api-tests/${nonExistentId}`)
        .expect(404);
    });

    it('should return 404 if the API test belongs to another user', async () => {
      currentMockUser = seededUser1; // User1 tries to access User2's test
      const testIdUser2 = seededApiTestUser2.id;
      await request(app)
        .get(`/api/api-tests/${testIdUser2}`)
        .expect(404); // Expecting 404 due to authorization rule in query
    });

    it('should return 400 if test ID is not a number', async () => {
      currentMockUser = seededUser1;
      await request(app)
        .get('/api/api-tests/invalid-id')
        .expect(400)
        .then(res => {
            expect(res.body.error).toBe("Invalid test ID format");
        });
    });
  });

  describe('POST /api/api-tests', () => {
    // organizationId is the tenancy boundary: insertApiTestSchema omits it from the
    // request body (like userId), and the route derives it from the session instead.
    const newTestPayload = () => ({
      name: 'Created via API',
      method: 'GET',
      url: 'http://example.com/created',
    });

    it('should persist the chosen projectId so the test stays grouped under its project', async () => {
      currentMockUser = seededUser1;
      const response = await request(app)
        .post('/api/api-tests')
        .send({ ...newTestPayload(), projectId: seededProject1User1.id })
        .expect(201);

      expect(response.body.projectId).toBe(seededProject1User1.id);
      expect(response.body.userId).toBe(seededUser1.id);

      const [stored] = await privilegedDb.select().from(apiTests).where(eq(apiTests.id, response.body.id));
      expect(stored.projectId).toBe(seededProject1User1.id);
    });

    it('should accept jsonb fields as real JSON (not pre-encoded strings)', async () => {
      currentMockUser = seededUser1;
      const response = await request(app)
        .post('/api/api-tests')
        .send({
          ...newTestPayload(),
          name: 'With query params',
          queryParams: { plant: 'P1', line: ['L1', 'L2'] },
          requestHeaders: { 'X-Api-Key': 'abc' },
        })
        .expect(201);

      expect(response.body.queryParams).toEqual({ plant: 'P1', line: ['L1', 'L2'] });
      expect(response.body.requestHeaders).toEqual({ 'X-Api-Key': 'abc' });
    });

    it('should reject an unknown projectId with 400, not 500', async () => {
      currentMockUser = seededUser1;
      await request(app)
        .post('/api/api-tests')
        .send({ ...newTestPayload(), projectId: 999999 })
        .expect(400);
    });

    it('should return 400 for an invalid payload', async () => {
      currentMockUser = seededUser1;
      await request(app)
        .post('/api/api-tests')
        .send({ method: 'GET', url: 'not-a-url' })
        .expect(400);
    });

    it('should ignore an organizationId in the request body and persist the row under the session organization', async () => {
      currentMockUser = seededUser1;
      const otherOrganizationId = await createTestOrganization('Other Organization');

      const response = await request(app)
        .post('/api/api-tests')
        .send({ ...newTestPayload(), organizationId: otherOrganizationId })
        .expect(201);

      expect(response.body.organizationId).toBe(organizationId);
      expect(response.body.organizationId).not.toBe(otherOrganizationId);

      const [stored] = await privilegedDb.select().from(apiTests).where(eq(apiTests.id, response.body.id));
      expect(stored.organizationId).toBe(organizationId);
    });
  });

  describe('PUT /api/api-tests/:id', () => {
    it('should update a test owned by the user, including its project', async () => {
      currentMockUser = seededUser1;
      const response = await request(app)
        .put(`/api/api-tests/${seededApiTestUser1Project1.id}`)
        .send({ name: 'Renamed', projectId: null })
        .expect(200);

      expect(response.body.name).toBe('Renamed');
      expect(response.body.projectId).toBeNull();
    });

    it("should return 404 when updating another user's test", async () => {
      currentMockUser = seededUser1;
      await request(app)
        .put(`/api/api-tests/${seededApiTestUser2.id}`)
        .send({ name: 'Hijacked' })
        .expect(404);

      const [untouched] = await privilegedDb.select().from(apiTests).where(eq(apiTests.id, seededApiTestUser2.id));
      expect(untouched.name).toBe('Test for User2');
    });

    it('should return 400 if test ID is not a number', async () => {
      currentMockUser = seededUser1;
      await request(app)
        .put('/api/api-tests/invalid-id')
        .send({ name: 'Whatever' })
        .expect(400)
        .then(res => {
          expect(res.body.error).toBe("Invalid test ID format");
        });
    });
  });

  describe('DELETE /api/api-tests/:id', () => {
    it('should delete an API test if it belongs to the user', async () => {
      currentMockUser = seededUser1;
      const testIdToDelete = seededApiTestUser1Project1.id;

      await request(app)
        .delete(`/api/api-tests/${testIdToDelete}`)
        .expect(204);

      // Verify it's actually deleted from DB
      const dbCheck = await privilegedDb.select().from(apiTests).where(eq(apiTests.id, testIdToDelete));
      expect(dbCheck.length).toBe(0);
    });

    it('should return 404 when trying to delete a non-existent API test', async () => {
      currentMockUser = seededUser1;
      const nonExistentId = 9999;
      await request(app)
        .delete(`/api/api-tests/${nonExistentId}`)
        .expect(404);
    });

    it('should return 404 when trying to delete an API test belonging to another user', async () => {
      currentMockUser = seededUser1; // User1 tries to delete User2's test
      const testIdUser2 = seededApiTestUser2.id;

      await request(app)
        .delete(`/api/api-tests/${testIdUser2}`)
        .expect(404);

      // Verify User2's test is still in the DB
      const dbCheck = await privilegedDb.select().from(apiTests).where(eq(apiTests.id, testIdUser2));
      expect(dbCheck.length).toBe(1);
    });

    it('should return 400 if test ID is not a number', async () => {
        currentMockUser = seededUser1;
        await request(app)
          .delete('/api/api-tests/invalid-id')
          .expect(400)
          .then(res => {
              expect(res.body.error).toBe("Invalid test ID format");
          });
      });
  });
});

/**
 * Saving a UI test — the recorder's whole output has nowhere to go without this.
 *
 * insertTestSchema omitted organizationId but not userId, and the column is NOT NULL, so the
 * schema demanded a userId the page had no business sending. Every "Save test" answered
 * `400 {"fieldErrors":{"userId":["Required"]}}`, which is how a recorded walk through DMO
 * ended up existing only in a browser tab. The sibling routes for API tests and test plans
 * had both already been written the right way.
 */
describe('POST /api/tests', () => {
  const recordedTest = () => ({
    name: 'NCC_TC_00085 - Static Scale Check',
    url: 'https://localhost:7000/home',
    sequence: [],
    elements: [],
  });

  it('saves a test without being told who owns it', async () => {
    currentMockUser = seededUser1;

    const response = await request(app).post('/api/tests').send(recordedTest()).expect(201);

    expect(response.body.userId).toBe(seededUser1.id);
    expect(response.body.organizationId).toBe(organizationId);
  });

  it('files it under the session, not under a userId the body asks for', async () => {
    currentMockUser = seededUser1;

    const response = await request(app)
      .post('/api/tests')
      .send({ ...recordedTest(), userId: seededUser2.id, organizationId: 99999 })
      .expect(201);

    // Honouring either would let a caller attribute its work to someone else — the reason
    // both are derived rather than accepted, and why fixing the 400 by adding userId to the
    // payload would have been the wrong repair.
    expect(response.body.userId).toBe(seededUser1.id);
    expect(response.body.organizationId).toBe(organizationId);
  });
});

/**
 * Saving the same test twice, and changing one that exists.
 *
 * Recording is iterative: walk the path, replay it, find a step wrong, walk it again. Every
 * pass used to leave another row behind — same name, nothing to tell them apart — because
 * POST always inserted and there was no PUT, no PATCH and no DELETE for a UI test at all.
 */
describe('saving a UI test that already exists', () => {
  const named = (name: string) => ({
    name,
    url: 'https://localhost:7000/home',
    sequence: [],
    elements: [],
  });

  it('refuses to make a second test with the same name, and says which one it means', async () => {
    currentMockUser = seededUser1;
    const first = await request(app).post('/api/tests').send(named('NCC_TC_00085')).expect(201);

    const again = await request(app).post('/api/tests').send(named('NCC_TC_00085')).expect(409);

    // The id is the point: the caller can offer to overwrite without having to go and look
    // the test up first.
    expect(again.body.existingTestId).toBe(first.body.id);
    expect(again.body.name).toBe('NCC_TC_00085');
  });

  it('replaces the steps of an existing test', async () => {
    currentMockUser = seededUser1;
    const created = await request(app).post('/api/tests').send(named('Replaceable')).expect(201);

    const response = await request(app)
      .put(`/api/tests/${created.body.id}`)
      .send({ sequence: [{ id: 'step-1', action: { id: 'click' } }] })
      .expect(200);

    expect(response.body.id).toBe(created.body.id);
    expect(response.body.sequence).toHaveLength(1);

    const [stored] = await privilegedDb.select().from(tests).where(eq(tests.id, created.body.id));
    expect((stored.sequence as unknown[]).length).toBe(1);
    // Still the same author: an update is not a change of ownership.
    expect(stored.userId).toBe(seededUser1.id);
  });

  it('does not let another organization overwrite a test it cannot see', async () => {
    currentMockUser = seededUser1;
    const created = await request(app).post('/api/tests').send(named('Mine')).expect(201);

    // A member of another organization. RLS makes the row invisible to the UPDATE, so the
    // statement matches nothing and the answer is "not found" rather than a silent no-op
    // reported as success.
    const otherOrgId = await createTestOrganization();
    const [outsider] = await privilegedDb
      .insert(users)
      .values({ username: 'outsider', password: 'hashed', organizationId: otherOrgId })
      .returning();
    currentMockUser = outsider;

    await request(app).put(`/api/tests/${created.body.id}`).send({ name: 'Hijacked' }).expect(404);

    currentMockUser = seededUser1;
    const [stored] = await privilegedDb.select().from(tests).where(eq(tests.id, created.body.id));
    expect(stored.name).toBe('Mine');
  });

  it('answers 404 for a test that is not there', async () => {
    currentMockUser = seededUser1;
    await request(app).put('/api/tests/999999').send({ name: 'x' }).expect(404);
  });
});

describe('removing a UI test', () => {
  it('deletes it, and says so a second time by not finding it', async () => {
    currentMockUser = seededUser1;
    const created = await request(app)
      .post('/api/tests')
      .send({ name: 'Disposable', url: 'https://x/', sequence: [], elements: [] })
      .expect(201);

    await request(app).delete(`/api/tests/${created.body.id}`).expect(204);

    const remaining = await privilegedDb.select().from(tests).where(eq(tests.id, created.body.id));
    expect(remaining).toHaveLength(0);

    // Previously a DELETE to this path fell past the API router to the single-page
    // application's catch-all, which answered 200 with an HTML page and deleted nothing.
    await request(app).delete(`/api/tests/${created.body.id}`).expect(404);
  });

  it('will not delete another organization’s test', async () => {
    currentMockUser = seededUser1;
    const created = await request(app)
      .post('/api/tests')
      .send({ name: 'Not yours', url: 'https://x/', sequence: [], elements: [] })
      .expect(201);

    const otherOrgId = await createTestOrganization();
    const [outsider] = await privilegedDb
      .insert(users)
      .values({ username: 'outsider-del', password: 'hashed', organizationId: otherOrgId })
      .returning();
    currentMockUser = outsider;

    await request(app).delete(`/api/tests/${created.body.id}`).expect(404);

    currentMockUser = seededUser1;
    const [stored] = await privilegedDb.select().from(tests).where(eq(tests.id, created.body.id));
    expect(stored.name).toBe('Not yours');
  });
});

import { Router, type Response } from "express";
import { db } from "../db";
import { tests, insertTestSchema, apiTests, insertApiTestSchema, updateApiTestSchema, users, projects } from "@shared/schema";
import { eq, desc, and, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import loggerPromise from "../logger";
import { playwrightService } from "../playwright-service";

const router = Router();
const logger = await loggerPromise;

// --- UI Tests ---

// GET /api/tests - List UI tests
router.get("/api/tests", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  try {
    const allTests = await db.select().from(tests).orderBy(desc(tests.createdAt));
    res.json(allTests);
  } catch (error: any) {
    logger.error({ message: "Error fetching tests", error: error.message });
    res.status(500).json({ error: "Failed to fetch tests" });
  }
});

// POST /api/tests - Create UI test
router.post("/api/tests", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const parseResult = insertTestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() });
  }

  try {
    const newTest = await db.insert(tests).values(parseResult.data).returning();
    res.status(201).json(newTest[0]);
  } catch (error: any) {
    logger.error({ message: "Error creating test", error: error.message });
    res.status(500).json({ error: "Failed to create test" });
  }
});

// POST /api/tests/:id/run - Run UI Test
router.post("/api/tests/:id/run", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

    const testId = parseInt(req.params.id);
    try {
        const testRecord = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
        if (testRecord.length === 0) return res.status(404).json({ error: "Test not found" });

        const result = await playwrightService.executeTestSequence(testRecord[0], (req.user as any).id);
        res.json(result);
    } catch (e: any) {
        logger.error({ message: "Test execution failed", error: e.message });
        res.status(500).json({ error: "Test execution failed" });
    }
});

// POST /api/detect-elements - Inspector
router.post("/api/detect-elements", async (req, res) => {
    // Basic wrapper for element detection
    const { url } = req.body;
    if(!url) return res.status(400).json({ error: "URL required" });
    
    try {
        // Assuming loadWebsite returns elements (it currently returns screenshot/html, 
        // usually the client parses it or we need a service method for detection).
        // Reuse loadWebsite for now as in original routes.
        const result = await playwrightService.loadWebsite(url);
        if(result.success) res.json(result);
        else res.status(500).json({ error: result.error });
    } catch(e: any) {
        res.status(500).json({ error: e.message });
    }
});


// --- API Tests ---

// projectId is deliberately omitted from the shared insert/update schemas (they drop the
// FK columns to prevent mass-assignment), but it *is* a user-chosen field: without it here
// zod strips it and every saved test lands with projectId = null, ungrouped in the UI.
const projectIdField = z.number().int().positive().optional().nullable();
const createApiTestSchema = insertApiTestSchema.extend({ projectId: projectIdField });
const editApiTestSchema = updateApiTestSchema.extend({ projectId: projectIdField });

// Saved tests are returned with the creator/project names already resolved so the client
// can group them without a second round-trip.
const selectApiTestsWithNames = () =>
    db
        .select({
            ...getTableColumns(apiTests),
            creatorUsername: users.username,
            projectName: projects.name,
        })
        .from(apiTests)
        .leftJoin(users, eq(apiTests.userId, users.id))
        .leftJoin(projects, eq(apiTests.projectId, projects.id));

/** Parses :id, answering 400 itself when it isn't numeric. Returns null once handled. */
function parseTestId(rawId: string, res: Response): number | null {
    const id = parseInt(rawId);
    if (isNaN(id)) {
        res.status(400).json({ error: "Invalid test ID format" });
        return null;
    }
    return id;
}

/** A bad projectId is the caller's mistake, not a server fault — report it as 400. */
const isForeignKeyError = (error: any) => /foreign key/i.test(error?.message ?? "");

// GET /api/api-tests
router.get("/api/api-tests", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    try {
        const result = await selectApiTestsWithNames()
            .where(eq(apiTests.userId, req.user!.id))
            .orderBy(desc(apiTests.updatedAt));
        res.json(result);
    } catch (e: any) {
        logger.error({ message: "Error fetching API tests", error: e.message, userId: req.user?.id });
        res.status(500).json({ error: "Failed to fetch API tests" });
    }
});

// GET /api/api-tests/:id
router.get("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const id = parseTestId(req.params.id, res);
    if (id === null) return;

    try {
        const result = await selectApiTestsWithNames()
            .where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user!.id)))
            .limit(1);
        if (result.length === 0) return res.status(404).json({ error: "API Test not found or not authorized" });
        res.json(result[0]);
    } catch (e: any) {
        logger.error({ message: `Error fetching API test ${id}`, error: e.message, userId: req.user?.id });
        res.status(500).json({ error: "Failed to fetch API test" });
    }
});

// POST /api/api-tests
router.post("/api/api-tests", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const parseResult = createApiTestSchema.safeParse(req.body);
    if (!parseResult.success) {
        logger.warn({ message: "POST /api/api-tests - Invalid payload", errors: parseResult.error.flatten(), userId: req.user?.id });
        return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() });
    }

    try {
        const newTest = await db.insert(apiTests).values({ ...parseResult.data, userId: req.user!.id }).returning();
        res.status(201).json(newTest[0]);
    } catch (e: any) {
        logger.error({ message: "Error creating API test", error: e.message, userId: req.user?.id });
        if (isForeignKeyError(e)) return res.status(400).json({ error: "Invalid project ID or project does not exist." });
        res.status(500).json({ error: "Failed to create API test" });
    }
});

// PUT /api/api-tests/:id
router.put("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const id = parseTestId(req.params.id, res);
    if (id === null) return;

    const parseResult = editApiTestSchema.safeParse(req.body);
    if (!parseResult.success) {
        logger.warn({ message: `PUT /api/api-tests/${id} - Invalid payload`, errors: parseResult.error.flatten(), userId: req.user?.id });
        return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() });
    }

    try {
        const updated = await db.update(apiTests)
            .set({ ...parseResult.data, updatedAt: new Date() })
            .where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user!.id)))
            .returning();
        if (updated.length === 0) return res.status(404).json({ error: "Test not found or not authorized" });
        res.json(updated[0]);
    } catch (e: any) {
        logger.error({ message: `Error updating API test ${id}`, error: e.message, userId: req.user?.id });
        if (isForeignKeyError(e)) return res.status(400).json({ error: "Invalid project ID or project does not exist." });
        res.status(500).json({ error: "Failed to update API test" });
    }
});

// DELETE /api/api-tests/:id
router.delete("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const id = parseTestId(req.params.id, res);
    if (id === null) return;

    try {
        // .returning() distinguishes "deleted" from "never existed / someone else's row",
        // which a bare delete cannot: it succeeds either way.
        const deleted = await db.delete(apiTests)
            .where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user!.id)))
            .returning();
        if (deleted.length === 0) return res.status(404).json({ error: "API Test not found or not authorized" });
        res.status(204).send();
    } catch (e: any) {
        logger.error({ message: `Error deleting API test ${id}`, error: e.message, userId: req.user?.id });
        res.status(500).json({ error: "Failed to delete API test" });
    }
});

export default router;

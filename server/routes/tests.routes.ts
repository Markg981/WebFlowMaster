import { Router } from "express";
import { db } from "../db";
import { tests, insertTestSchema, apiTests, insertApiTestSchema, updateApiTestSchema, AdhocTestStepSchema, AdhocDetectedElementSchema, apiTestHistory, insertApiTestHistorySchema } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
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

// GET /api/api-tests
router.get("/api/api-tests", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    try {
        const result = await db.select().from(apiTests).where(eq(apiTests.userId, (req.user as any).id)).orderBy(desc(apiTests.createdAt));
        res.json(result);
    } catch (e: any) {
        res.status(500).json({ error: "Failed to fetch API tests" });
    }
});

// POST /api/api-tests
router.post("/api/api-tests", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const parseResult = insertApiTestSchema.safeParse(req.body);
    if(!parseResult.success) return res.status(400).json({ error: "Invalid data" });
    
    try {
        const newTest = await db.insert(apiTests).values({ ...parseResult.data, userId: (req.user as any).id }).returning();
        res.status(201).json(newTest[0]);
    } catch(e: any) {
        res.status(500).json({ error: "Failed to create API test" });
    }
});

// PUT /api/api-tests/:id
router.put("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const id = parseInt(req.params.id);
    const parseResult = updateApiTestSchema.safeParse(req.body);

    if(!parseResult.success) return res.status(400).json({ error: "Invalid data" });

    try {
        const updated = await db.update(apiTests)
           .set({ ...parseResult.data, updatedAt: new Date() }) 
           .where(and(eq(apiTests.id, id), eq(apiTests.userId, (req.user as any).id)))
           .returning();
        if(updated.length === 0) return res.status(404).json({ error: "Test not found" });
        res.json(updated[0]);
    } catch(e: any) {
         res.status(500).json({ error: "Failed to update" });
    }
});

// DELETE /api/api-tests/:id
router.delete("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const id = parseInt(req.params.id);
    try {
        await db.delete(apiTests).where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user.id)));
        res.status(204).send();
    } catch(e) {
        res.status(500).json({ error: "Failed to delete" });
    }
});

export default router;

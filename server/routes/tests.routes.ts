import { Router, type Response } from "express";
import { tests, insertTestSchema, apiTests, insertApiTestSchema, updateApiTestSchema, users, projects } from "@shared/schema";
import { eq, desc, and, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import loggerPromise from "../logger";
import { playwrightService } from "../playwright-service";
import { withTenantTransaction, type TenantTx } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { resolveVariables } from "../variables";

const router = Router();
const logger = await loggerPromise;

// --- UI Tests ---

// GET /api/tests - List UI tests
router.get("/api/tests", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  try {
    // No organization filter here on purpose: the RLS policy applies it. Adding one would
    // be harmless but would suggest the isolation depends on remembering it.
    const allTests = await withTenantTransaction((tx) =>
      tx.select().from(tests).orderBy(desc(tests.createdAt)),
    );
    res.json(allTests);
  } catch (error: any) {
    logger.error({ message: "Error fetching tests", error: error.message });
    res.status(500).json({ error: "Failed to fetch tests" });
  }
});

// POST /api/tests - Create UI test
router.post("/api/tests", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const parseResult = insertTestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() });
  }

  try {
    const newTest = await withTenantTransaction((tx) =>
      tx
        .insert(tests)
        .values({ ...parseResult.data, organizationId: req.user!.organizationId })
        .returning(),
    );
    res.status(201).json(newTest[0]);
  } catch (error: any) {
    logger.error({ message: "Error creating test", error: error.message });
    res.status(500).json({ error: "Failed to create test" });
  }
});

// Executing a test launches a browser, reaches external systems, writes execution_logs and
// may run preconditions that mutate the system under test. It is a mutation, so editor.
router.post("/api/tests/:id/run", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

    const testId = parseInt(req.params.id);
    try {
        // Under RLS this finds nothing for another organization's test, so the 404 below
        // is the correct answer rather than a leak.
        const testRecord = await withTenantTransaction((tx) =>
          tx.select().from(tests).where(eq(tests.id, testId)).limit(1),
        );
        if (testRecord.length === 0) return res.status(404).json({ error: "Test not found" });

        // The environment is the caller's choice, but the organization it must belong to is
        // the session's — never the body's, or an id from another tenant would resolve.
        const environmentId = Number.isInteger(req.body?.environmentId)
          ? (req.body.environmentId as number)
          : null;
        const vars = await resolveVariables({
          userId: (req.user as any).id,
          organizationId: (req.user as any).organizationId,
          environmentId,
        });

        const result = await playwrightService.executeTestSequence(
          testRecord[0],
          (req.user as any).id,
          undefined,
          undefined,
          vars,
        );
        res.json(result);
    } catch (e: any) {
        logger.error({ message: "Test execution failed", error: e.message });
        res.status(500).json({ error: "Test execution failed" });
    }
});

// NOTE: /api/detect-elements is intentionally NOT defined here. It is handled by the
// authenticated handler in routes.ts, which calls playwrightService.detectElements()
// (with the user's settings) and returns { success, elements }. An earlier stub here
// wrongly called loadWebsite() and returned no `elements`, shadowing the real route
// and leaving the Detected Elements panel empty.


// --- API Tests ---

// projectId is deliberately omitted from the shared insert/update schemas (they drop the
// FK columns to prevent mass-assignment), but it *is* a user-chosen field: without it here
// zod strips it and every saved test lands with projectId = null, ungrouped in the UI.
const projectIdField = z.number().int().positive().optional().nullable();
const createApiTestSchema = insertApiTestSchema.extend({ projectId: projectIdField });
const editApiTestSchema = updateApiTestSchema.extend({ projectId: projectIdField });

// Saved tests are returned with the creator/project names already resolved so the client
// can group them without a second round-trip.
const selectApiTestsWithNames = (tx: TenantTx) =>
    tx
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
router.get("/api/api-tests", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    try {
        const result = await withTenantTransaction((tx) =>
          selectApiTestsWithNames(tx)
            .where(eq(apiTests.userId, req.user!.id))
            .orderBy(desc(apiTests.updatedAt)),
        );
        res.json(result);
    } catch (e: any) {
        logger.error({ message: "Error fetching API tests", error: e.message, userId: req.user?.id });
        res.status(500).json({ error: "Failed to fetch API tests" });
    }
});

// GET /api/api-tests/:id
router.get("/api/api-tests/:id", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const id = parseTestId(req.params.id, res);
    if (id === null) return;

    try {
        const result = await withTenantTransaction((tx) =>
          selectApiTestsWithNames(tx)
            .where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user!.id)))
            .limit(1),
        );
        if (result.length === 0) return res.status(404).json({ error: "API Test not found or not authorized" });
        res.json(result[0]);
    } catch (e: any) {
        logger.error({ message: `Error fetching API test ${id}`, error: e.message, userId: req.user?.id });
        res.status(500).json({ error: "Failed to fetch API test" });
    }
});

// POST /api/api-tests
router.post("/api/api-tests", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const parseResult = createApiTestSchema.safeParse(req.body);
    if (!parseResult.success) {
        logger.warn({ message: "POST /api/api-tests - Invalid payload", errors: parseResult.error.flatten(), userId: req.user?.id });
        return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() });
    }

    try {
        const newTest = await withTenantTransaction((tx) =>
          tx
            .insert(apiTests)
            .values({ ...parseResult.data, userId: req.user!.id, organizationId: req.user!.organizationId })
            .returning(),
        );
        res.status(201).json(newTest[0]);
    } catch (e: any) {
        logger.error({ message: "Error creating API test", error: e.message, userId: req.user?.id });
        if (isForeignKeyError(e)) return res.status(400).json({ error: "Invalid project ID or project does not exist." });
        res.status(500).json({ error: "Failed to create API test" });
    }
});

// PUT /api/api-tests/:id
router.put("/api/api-tests/:id", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const id = parseTestId(req.params.id, res);
    if (id === null) return;

    const parseResult = editApiTestSchema.safeParse(req.body);
    if (!parseResult.success) {
        logger.warn({ message: `PUT /api/api-tests/${id} - Invalid payload`, errors: parseResult.error.flatten(), userId: req.user?.id });
        return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() });
    }

    try {
        const updated = await withTenantTransaction((tx) =>
          tx.update(apiTests)
            .set({ ...parseResult.data, updatedAt: new Date() })
            .where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user!.id)))
            .returning(),
        );
        if (updated.length === 0) return res.status(404).json({ error: "Test not found or not authorized" });
        res.json(updated[0]);
    } catch (e: any) {
        logger.error({ message: `Error updating API test ${id}`, error: e.message, userId: req.user?.id });
        if (isForeignKeyError(e)) return res.status(400).json({ error: "Invalid project ID or project does not exist." });
        res.status(500).json({ error: "Failed to update API test" });
    }
});

// DELETE /api/api-tests/:id
router.delete("/api/api-tests/:id", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    const id = parseTestId(req.params.id, res);
    if (id === null) return;

    try {
        // .returning() distinguishes "deleted" from "never existed / someone else's row",
        // which a bare delete cannot: it succeeds either way.
        const deleted = await withTenantTransaction((tx) =>
          tx.delete(apiTests)
            .where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user!.id)))
            .returning(),
        );
        if (deleted.length === 0) return res.status(404).json({ error: "API Test not found or not authorized" });
        res.status(204).send();
    } catch (e: any) {
        logger.error({ message: `Error deleting API test ${id}`, error: e.message, userId: req.user?.id });
        res.status(500).json({ error: "Failed to delete API test" });
    }
});

export default router;

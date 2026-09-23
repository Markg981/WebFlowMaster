import { Router, type Response } from "express";
import { tests, insertTestSchema, apiTests, insertApiTestSchema, updateApiTestSchema, users, projects } from "@shared/schema";
import { eq, desc, and, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import loggerPromise from "../logger";
import { BrowserTaskError, browserTasks } from "../browser-tasks";
import { withTenantTransaction, type TenantTx } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { recordTestVersion } from "../test-version-store";
import { tagsOfTests } from "../test-tags";

const router = Router();
const logger = await loggerPromise;

// --- UI Tests ---

// GET /api/tests - List UI tests
router.get("/api/tests", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  try {
    // No organization filter here on purpose: the RLS policy applies it. Adding one would
    // be harmless but would suggest the isolation depends on remembering it.
    const allTests = await withTenantTransaction(async (tx) => {
      const rows = await tx.select().from(tests).orderBy(desc(tests.createdAt));
      // One query for every row's tags rather than one per row: this list is what the library
      // and the pickers are built from, and per-row lookups is where a list becomes hundreds
      // of queries.
      const byTest = await tagsOfTests(tx, { testIds: rows.map((row) => row.id) });
      return rows.map((row) => ({ ...row, tags: byTest.ui.get(row.id) ?? [] }));
    });
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
    const created = await withTenantTransaction(async (tx) => {
      // Saving the same test again must not silently make a second one. Recording is
      // iterative — you walk the path, replay it, find a step wrong, walk it again — and
      // every pass through that loop used to leave another row behind, all with the same
      // name and nothing to tell them apart. The caller decides what to do about it, so this
      // reports the collision and the id rather than overwriting on its own.
      //
      // Scoped to the organization by RLS, not by a where clause: a name belonging to
      // another tenant is not a collision and must not even be visible as one.
      const [existing] = await tx
        .select({ id: tests.id })
        .from(tests)
        .where(eq(tests.name, parseResult.data.name))
        .limit(1);

      if (existing) return { conflict: existing.id };

      const rows = await tx
        .insert(tests)
        // Both derived from the session, never from the body — the same treatment the API
        // test route beside this one already gave them.
        .values({ ...parseResult.data, userId: req.user!.id, organizationId: req.user!.organizationId })
        .returning();

      // Version 1, in the same transaction as the insert: a history that can begin at version
      // 2 is one that lost the original.
      await recordTestVersion(tx, {
        testId: rows[0].id,
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        test: rows[0],
      });

      return { test: rows[0] };
    });

    if ('conflict' in created) {
      return res.status(409).json({
        error: "A test with this name already exists.",
        existingTestId: created.conflict,
        name: parseResult.data.name,
      });
    }

    res.status(201).json(created.test);
  } catch (error: any) {
    logger.error({ message: "Error creating test", error: error.message });
    res.status(500).json({ error: "Failed to create test" });
  }
});

// PUT /api/tests/:id - Replace an existing UI test
//
// There was no way to change a saved UI test at all: no PUT, no PATCH, not even a DELETE.
// A test could be created and run and nothing else, so correcting one step meant recording
// the whole walk again and saving it under a new name.
router.put("/api/tests/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid test id" });

  const parseResult = insertTestSchema.partial().safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() });
  }

  try {
    const updated = await withTenantTransaction(async (tx) => {
      const rows = await tx
        .update(tests)
        // userId is not touched: the test keeps its author. organizationId is not in the
        // payload at all, and RLS decides which rows this statement can see — so another
        // organization's test simply is not found, which is the 404 below.
        .set({ ...parseResult.data, updatedAt: new Date() })
        .where(eq(tests.id, id))
        .returning();

      // What the test was before this save is already written down; this records what it has
      // become. The builder turns a name collision into an overwrite of the existing test,
      // which is the right thing to do while re-recording a flow and the wrong thing to be
      // unable to undo — so every save leaves the previous walk recoverable.
      if (rows.length > 0) {
        await recordTestVersion(tx, {
          testId: rows[0].id,
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          test: rows[0],
        });
      }

      return rows;
    });

    if (updated.length === 0) return res.status(404).json({ error: "Test not found" });
    res.json(updated[0]);
  } catch (error: any) {
    logger.error({ message: "Error updating test", error: error.message, testId: id });
    res.status(500).json({ error: "Failed to update test" });
  }
});

// DELETE /api/tests/:id - Remove a UI test
//
// The other half of the same omission. Without it a list of tests only ever grows, and the
// duplicates the missing name check produced could not be cleared away. A request to this
// path used to fall through the API router entirely and be answered by the single-page
// application's catch-all — 200, with an HTML body, and nothing deleted.
router.delete("/api/tests/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid test id" });

  try {
    const deleted = await withTenantTransaction((tx) =>
      // Bare returning(): the tenant transaction's union type does not accept a projection.
      tx.delete(tests).where(eq(tests.id, id)).returning(),
    );

    if (deleted.length === 0) return res.status(404).json({ error: "Test not found" });
    res.status(204).end();
  } catch (error: any) {
    logger.error({ message: "Error deleting test", error: error.message, testId: id });
    res.status(500).json({ error: "Failed to delete test" });
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
        // the session's — never the body's, or an id from another tenant would resolve. It is
        // resolved where the browser runs, so its decrypted values never pass through the queue.
        const environmentId = Number.isInteger(req.body?.environmentId)
          ? (req.body.environmentId as number)
          : null;

        const result = await browserTasks.run({
          task: { kind: 'run-test', testId, environmentId },
          userId: (req.user as any).id,
          organizationId: (req.user as any).organizationId,
        });
        res.json(result);
    } catch (e: any) {
        if (e instanceof BrowserTaskError) {
          return res.status(e.status).json({ error: e.message, code: e.code });
        }
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

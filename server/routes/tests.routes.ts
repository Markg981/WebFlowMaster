import { Router, type Response } from "express";
import { tests, insertTestSchema, apiTests, insertApiTestSchema, updateApiTestSchema, users, projects, projectMembers, AUDIT_ACTIONS } from "@shared/schema";
import { auditActor, changedFields, recordAudit } from "../audit";
import { eq, and, desc, getTableColumns, isNull } from "drizzle-orm";
import { z } from "zod";
import loggerPromise from "../logger";
import { BrowserTaskError, browserTasks } from "../browser-tasks";
import { withTenantTransaction, type TenantTx } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { recordTestVersion, recordTypedTestVersion } from "../test-version-store";
import { tagsOfTests } from "../test-tags";
import { manualSequenceProblem } from "@shared/manual-tests";
import { ImportError, MAX_IMPORTED_TESTS, importApiDescription } from "../api-import";
import { API_TEST_FIELDS, BundleError, TEST_FIELDS, exportBundle, parseBundle, sameAs } from "../test-bundle";
import { toPlaywright } from "../playwright-export";
import { expandSequenceForRun } from "../step-groups";
import { resolveSequenceForRun } from "../step-elements";
import { GherkinError } from "../gherkin";

const router = Router();
const logger = await loggerPromise;

/**
 * Answers a change that touched no row: 404 when the test is not there for the requester, 403
 * when it is there but its project does not let them change it (they are a viewer on a
 * restricted project — row-level security refused the write, see migration 0031). A 404 for a
 * test the person is looking at on screen would send them looking for a bug.
 */
async function notChanged(res: Response, id: number, notFound: string, table: typeof tests | typeof apiTests = tests) {
  const [visible] = await withTenantTransaction((tx) => tx.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1));
  if (visible) {
    return res.status(403).json({ error: "You can view this test's project but not change it.", code: "project_read_only" });
  }
  return res.status(404).json({ error: notFound });
}

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
  const manualProblem = manualSequenceProblem(parseResult.data.sequence);
  if (manualProblem) return res.status(400).json({ error: manualProblem, code: "manual_step_empty" });

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

      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TEST_CREATED,
        actor: auditActor(req),
        targetType: 'test',
        targetId: rows[0].id,
        metadata: { name: rows[0].name },
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
    if (isForeignKeyError(error)) return res.status(400).json({ error: "Invalid project ID or project does not exist." });
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
  const manualProblem = manualSequenceProblem(parseResult.data.sequence);
  if (manualProblem) return res.status(400).json({ error: manualProblem, code: "manual_step_empty" });

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
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.TEST_UPDATED,
          actor: auditActor(req),
          targetType: 'test',
          targetId: rows[0].id,
          // Which fields, not their values: the version just recorded holds those.
          metadata: { name: rows[0].name, fields: changedFields(parseResult.data) },
        });
      }

      return rows;
    });

    if (updated.length === 0) return notChanged(res, id, "Test not found");
    res.json(updated[0]);
  } catch (error: any) {
    if (isForeignKeyError(error)) return res.status(400).json({ error: "Invalid project ID or project does not exist." });
    logger.error({ message: "Error updating test", error: error.message, testId: id });
    res.status(500).json({ error: "Failed to update test" });
  }
});

/**
 * PUT /api/tests/:id/steps/:stepId/selector — a new selector for one of the test's own steps.
 *
 * What "Apply to the test" in the report's AI analysis sends (FailureAnalysisDialog). A save like
 * any other: a new version, recoverable from the history, and an audit entry — only the one
 * selector changes. A step inside a step group is the group's, and is not found here.
 */
router.put("/api/tests/:id/steps/:stepId/selector", requireRole('editor'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid test id" });
  const parsed = z.object({ selector: z.string().trim().min(1).max(2000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A selector is required.", details: parsed.error.flatten() });

  try {
    const outcome = await withTenantTransaction(async (tx) => {
      const [test] = await tx.select().from(tests).where(eq(tests.id, id)).limit(1);
      if (!test) return { status: 404, error: "Test not found" } as const;
      const raw = typeof test.sequence === 'string' ? JSON.parse(test.sequence) : test.sequence;
      const sequence = Array.isArray(raw) ? (raw as Array<Record<string, any>>) : [];
      const index = sequence.findIndex((step) => step?.id === req.params.stepId);
      if (index === -1) return { status: 404, error: "That step is not one of this test's own steps." } as const;
      if (!sequence[index].targetElement) return { status: 409, error: "That step has no element to find." } as const;

      const previous = sequence[index].targetElement.selector ?? null;
      const next = sequence.map((step, i) =>
        i === index ? { ...step, targetElement: { ...step.targetElement, selector: parsed.data.selector } } : step,
      );
      const [row] = await tx
        .update(tests)
        .set({ sequence: (typeof test.sequence === 'string' ? JSON.stringify(next) : next) as any, updatedAt: new Date() })
        .where(eq(tests.id, id))
        .returning();
      const version = await recordTestVersion(tx, { testId: row.id, organizationId: req.user!.organizationId, userId: req.user!.id, test: row });
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TEST_UPDATED,
        actor: auditActor(req),
        targetType: 'test',
        targetId: row.id,
        metadata: { name: row.name, fields: ['sequence'], step: req.params.stepId, previousSelector: previous, selector: parsed.data.selector },
      });
      return { status: 200, test: row, version } as const;
    });
    if ('error' in outcome) return res.status(outcome.status).json({ error: outcome.error });
    res.json({ id: outcome.test.id, version: (outcome.version as { version?: number } | undefined)?.version ?? null });
  } catch (error: any) {
    logger.error({ message: "Error updating a step's selector", error: error.message, testId: id });
    res.status(500).json({ error: "Failed to update the step." });
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
    const deleted = await withTenantTransaction(async (tx) => {
      // Bare returning(): the tenant transaction's union type does not accept a projection.
      const rows = await tx.delete(tests).where(eq(tests.id, id)).returning();
      if (rows.length > 0) {
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.TEST_DELETED,
          actor: auditActor(req),
          targetType: 'test',
          targetId: id,
          // The name, because once the row is gone nothing else says what it was.
          metadata: { name: rows[0].name },
        });
      }
      return rows;
    });

    if (deleted.length === 0) return notChanged(res, id, "Test not found");
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

const importSchema = z.object({
  /** The file as text: OpenAPI 3 or Swagger 2 (JSON or YAML), or a Postman collection. */
  content: z.string().min(1).max(10 * 1024 * 1024),
  /** Read the file and say what it would make, without saving anything. */
  dryRun: z.boolean().optional().default(false),
  projectId: projectIdField,
  /** Which of the tests the preview listed, by position; all of them when absent. */
  select: z.array(z.number().int().min(0)).max(MAX_IMPORTED_TESTS).optional(),
  /** Leave out tests whose method and address the organization already has. */
  skipExisting: z.boolean().optional().default(true),
});

// POST /api/api-tests/import — tests from an OpenAPI description or a Postman collection
// (server/api-import.ts): a preview with dryRun, then the ones kept, saved in one transaction.
router.post("/api/api-tests/import", requireRole('editor'), async (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid import", details: parsed.error.flatten() });
    let result;
    try {
        result = importApiDescription(parsed.data.content);
    } catch (error) {
        if (error instanceof ImportError) return res.status(400).json({ error: error.message });
        throw error;
    }

    const existing = await withTenantTransaction((tx) => tx.select({ method: apiTests.method, url: apiTests.url }).from(apiTests));
    const known = new Set(existing.map((t) => `${t.method.toUpperCase()} ${t.url}`));
    const listed = result.tests.map((test, index) => ({ ...test, index, exists: known.has(`${test.method} ${test.url}`) }));
    if (parsed.data.dryRun) return res.json({ ...result, tests: listed });

    const chosen = parsed.data.select ? listed.filter((t) => parsed.data.select!.includes(t.index)) : listed;
    const skipped = parsed.data.skipExisting ? chosen.filter((t) => t.exists).map((t) => ({ index: t.index, name: t.name, reason: 'already exists' })) : [];
    const invalid: Array<{ index: number; name: string; reason: string }> = [];
    const rows: Array<z.infer<typeof createApiTestSchema>> = [];
    for (const test of chosen) {
        if (parsed.data.skipExisting && test.exists) continue;
        const candidate = createApiTestSchema.safeParse({
            name: test.name, method: test.method, url: test.url, queryParams: test.queryParams, requestHeaders: test.requestHeaders,
            requestBody: test.requestBody, bodyType: test.bodyType, bodyRawContentType: test.bodyRawContentType,
            bodyGraphqlQuery: test.bodyGraphqlQuery, bodyGraphqlVariables: test.bodyGraphqlVariables,
            authType: test.authType, authParams: test.authParams, assertions: test.assertions, module: test.module,
            projectId: parsed.data.projectId ?? null,
        });
        if (!candidate.success) {
            invalid.push({ index: test.index, name: test.name, reason: Object.values(candidate.error.flatten().fieldErrors).flat().join('; ') || 'invalid' });
            continue;
        }
        rows.push(candidate.data);
    }

    try {
        const created = await withTenantTransaction(async (tx) => {
            if (rows.length === 0) return [];
            const inserted = await tx
                .insert(apiTests)
                .values(rows.map((row) => ({ ...row, userId: req.user!.id, organizationId: req.user!.organizationId })))
                .returning();
            for (const row of inserted) await recordTypedTestVersion(tx, {
                testType: 'api', testId: row.id, organizationId: req.user!.organizationId,
                userId: req.user!.id, test: row,
            });
            await recordAudit(tx, {
                action: AUDIT_ACTIONS.API_TESTS_IMPORTED,
                actor: auditActor(req),
                targetType: 'api_test',
                targetId: inserted[0].id,
                metadata: { format: result.format, title: result.title, created: inserted.length, skipped: skipped.length, invalid: invalid.length, names: inserted.slice(0, 50).map((t) => t.name) },
            });
            return inserted;
        });
        res.status(201).json({ created: created.map((t) => ({ id: t.id, name: t.name })), skipped, invalid, variables: result.variables });
    } catch (e: any) {
        if (isForeignKeyError(e)) return res.status(400).json({ error: "Invalid project ID or project does not exist." });
        throw e;
    }
});
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
/**
 * A project the row cannot go into: one that does not exist (the foreign key), or one the
 * requester cannot edit or even see (row-level security, migration 0031). One answer for both,
 * so the response does not say whether a restricted project exists.
 */
const isForeignKeyError = (error: any) => /foreign key|row-level security/i.test(error?.message ?? "");

// GET /api/api-tests
router.get("/api/api-tests", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    try {
        const result = await withTenantTransaction((tx) =>
          // The organization's, like its UI tests: RLS applies the organization and the
          // restricted projects. Filtering by author made every API test private to whoever
          // saved it, so a colleague could not open it, a plan could not be built from it, and
          // restricting its project changed nothing.
          selectApiTestsWithNames(tx)
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
            .where(eq(apiTests.id, id))
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
        const newTest = await withTenantTransaction(async (tx) => {
          const rows = await tx
            .insert(apiTests)
            .values({ ...parseResult.data, userId: req.user!.id, organizationId: req.user!.organizationId })
            .returning();
          await recordTypedTestVersion(tx, {
            testType: 'api', testId: rows[0].id, organizationId: req.user!.organizationId,
            userId: req.user!.id, test: rows[0],
          });
          await recordAudit(tx, {
            action: AUDIT_ACTIONS.API_TEST_CREATED,
            actor: auditActor(req),
            targetType: 'api_test',
            targetId: rows[0].id,
            metadata: { name: rows[0].name },
          });
          return rows;
        });
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
        const updated = await withTenantTransaction(async (tx) => {
          const rows = await tx.update(apiTests)
            .set({ ...parseResult.data, updatedAt: new Date() })
            .where(eq(apiTests.id, id))
            .returning();
          if (rows.length > 0) {
            await recordTypedTestVersion(tx, {
              testType: 'api', testId: rows[0].id, organizationId: req.user!.organizationId,
              userId: req.user!.id, test: rows[0],
            });
            await recordAudit(tx, {
              action: AUDIT_ACTIONS.API_TEST_UPDATED,
              actor: auditActor(req),
              targetType: 'api_test',
              targetId: id,
              // Names only: an API test's headers and body are exactly where tokens live.
              metadata: { name: rows[0].name, fields: changedFields(parseResult.data) },
            });
          }
          return rows;
        });
        if (updated.length === 0) return notChanged(res, id, "Test not found", apiTests);
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
        const deleted = await withTenantTransaction(async (tx) => {
          const rows = await tx.delete(apiTests)
            .where(eq(apiTests.id, id))
            .returning();
          if (rows.length > 0) {
            await recordAudit(tx, {
              action: AUDIT_ACTIONS.API_TEST_DELETED,
              actor: auditActor(req),
              targetType: 'api_test',
              targetId: id,
              metadata: { name: rows[0].name },
            });
          }
          return rows;
        });
        if (deleted.length === 0) return notChanged(res, id, "API Test not found", apiTests);
        res.status(204).send();
    } catch (e: any) {
        logger.error({ message: `Error deleting API test ${id}`, error: e.message, userId: req.user?.id });
        res.status(500).json({ error: "Failed to delete API test" });
    }
});

// ─── Tests as files: a versionable bundle, and Playwright (server/test-bundle.ts, server/playwright-export.ts) ───

/** `?projectId=12`, `?projectId=none` (tests in no project), or absent (all of them). */
function projectFilter(value: unknown): { ok: true; projectId: number | null | undefined } | { ok: false } {
  if (value === undefined || value === '') return { ok: true, projectId: undefined };
  if (value === 'none') return { ok: true, projectId: null };
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? { ok: true, projectId: id } : { ok: false };
}

// GET /api/tests/export — the web and API tests of a project as one YAML (or ?format=json) file.
router.get("/api/tests/export", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  const filter = projectFilter(req.query.projectId);
  if (!filter.ok) return res.status(400).json({ error: "projectId is a project id, or none." });
  if (req.query.format !== undefined && !['yaml', 'json', 'gherkin'].includes(String(req.query.format))) return res.status(400).json({ error: "format is yaml, json or gherkin." });
  const format = req.query.format === 'json' ? 'json' : req.query.format === 'gherkin' ? 'gherkin' : 'yaml';
  const { projectId } = filter;
  const data = await withTenantTransaction(async (tx) => {
    const where = <T extends typeof tests | typeof apiTests>(table: T) =>
      projectId === undefined ? undefined : projectId === null ? isNull(table.projectId) : eq(table.projectId, projectId);
    const [project] = projectId ? await tx.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)) : [];
    return {
      project: project?.name ?? null,
      projectMissing: Boolean(projectId) && !project,
      tests: await tx.select().from(tests).where(where(tests)),
      apiTests: await tx.select().from(apiTests).where(where(apiTests)),
    };
  });
  if (data.projectMissing) return res.status(404).json({ error: "Project not found" });
  let bundle;
  try { bundle = exportBundle(data, format); }
  catch (error) {
    if (error instanceof GherkinError) return res.status(400).json({ error: error.message });
    throw error;
  }
  res.setHeader("Content-Disposition", `attachment; filename="${bundle.fileName}"`);
  // What the file left out or refers to, for the client to say so; the file itself is the body.
  res.setHeader("X-WFM-Secrets-Replaced", String(bundle.secretsReplaced.length));
  res.setHeader("X-WFM-Tests-With-References", String(bundle.withReferences.length));
  res.type(format === 'json' ? 'application/json' : format === 'gherkin' ? 'text/plain' : 'application/yaml').send(bundle.content);
});

const importBundleSchema = z.object({
  content: z.string().min(1).max(20 * 1024 * 1024),
  /** Where new tests go; existing tests keep their project. */
  projectId: projectIdField,
  dryRun: z.boolean().optional().default(false),
  format: z.literal('gherkin').optional(),
});
class BundleProjectAccessError extends Error {}

// POST /api/tests/import-bundle — a file made by the export: tests of the same name are updated
// (a new version each), the others created. Unchanged tests are left alone.
router.post("/api/tests/import-bundle", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  const parsed = importBundleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid import", details: parsed.error.flatten() });
  let bundle;
  try {
    bundle = parseBundle(parsed.data.content, parsed.data.format);
  } catch (error) {
    if (error instanceof BundleError || error instanceof GherkinError) return res.status(400).json({ error: error.message });
    throw error;
  }
  const projectId = parsed.data.projectId ?? null;

  type Outcome = { kind: 'test' | 'api_test'; name: string; outcome: 'created' | 'updated' | 'unchanged' | 'invalid'; reason?: string };
  try {
    const outcomes = await withTenantTransaction(async (tx) => {
      const results: Outcome[] = [];
      const projectAccess = new Map<number, boolean>();
      const canEditProject = async (id: number | null): Promise<boolean> => {
        if (id === null) return true;
        if (projectAccess.has(id)) return projectAccess.get(id)!;
        const [project] = await tx.select({ restricted: projects.restricted }).from(projects).where(eq(projects.id, id)).limit(1);
        let allowed = Boolean(project) && (!project.restricted || req.user!.role === 'owner');
        if (project?.restricted && req.user!.role !== 'owner') {
          const [member] = await tx.select({ role: projectMembers.role }).from(projectMembers).where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, req.user!.id))).limit(1);
          allowed = member?.role === 'editor';
        }
        projectAccess.set(id, allowed);
        return allowed;
      };
      // A preview must not promise writes the selected project's policy will refuse.
      if (!await canEditProject(projectId)) throw new BundleProjectAccessError();
      for (const raw of bundle.tests) {
        const name = String(raw.name ?? '');
        // The detected elements are the builder's palette, not part of the test: the file leaves them out.
        const candidate = insertTestSchema.safeParse({ elements: [], ...raw, projectId });
        if (!candidate.success) {
          results.push({ kind: 'test', name, outcome: 'invalid', reason: Object.entries(candidate.error.flatten().fieldErrors).map(([k, v]) => `${k}: ${v?.join(', ')}`).join('; ') || 'invalid' });
          continue;
        }
        // The column is free jsonb: a file edited by hand must still hold a list of steps.
        const sequence = candidate.data.sequence;
        if (!Array.isArray(sequence) || sequence.some((s) => !s || typeof s !== 'object' || Array.isArray(s))) {
          results.push({ kind: 'test', name, outcome: 'invalid', reason: 'sequence: a list of steps' });
          continue;
        }
        const manualProblem = manualSequenceProblem(candidate.data.sequence);
        if (manualProblem) {
          results.push({ kind: 'test', name, outcome: 'invalid', reason: manualProblem });
          continue;
        }
        const [existing] = await tx.select().from(tests).where(eq(tests.name, candidate.data.name)).limit(1);
        if (existing && !await canEditProject(existing.projectId)) {
          results.push({ kind: 'test', name, outcome: 'invalid', reason: 'You can view this test\'s project but not change it.' });
          continue;
        }
        if (existing && sameAs(existing as unknown as Record<string, unknown>, raw, TEST_FIELDS)) {
          results.push({ kind: 'test', name, outcome: 'unchanged' });
          continue;
        }
        if (parsed.data.dryRun) {
          results.push({ kind: 'test', name, outcome: existing ? 'updated' : 'created' });
          continue;
        }
        const { projectId: _projectId, ...fields } = candidate.data;
        const [row] = existing
          ? await tx.update(tests).set({ ...fields, updatedAt: new Date() }).where(eq(tests.id, existing.id)).returning()
          : await tx
              .insert(tests)
              .values({ ...candidate.data, userId: req.user!.id, organizationId: req.user!.organizationId })
              .returning();
        await recordTestVersion(tx, { testId: row.id, organizationId: req.user!.organizationId, userId: req.user!.id, test: row });
        results.push({ kind: 'test', name, outcome: existing ? 'updated' : 'created' });
      }
      for (const raw of bundle.apiTests) {
        const name = String(raw.name ?? '');
        const candidate = createApiTestSchema.safeParse({ ...raw, projectId });
        if (!candidate.success) {
          results.push({ kind: 'api_test', name, outcome: 'invalid', reason: Object.entries(candidate.error.flatten().fieldErrors).map(([k, v]) => `${k}: ${v?.join(', ')}`).join('; ') || 'invalid' });
          continue;
        }
        const same = await tx.select().from(apiTests).where(eq(apiTests.name, candidate.data.name)).limit(2);
        if (same.length > 1) {
          results.push({ kind: 'api_test', name, outcome: 'invalid', reason: 'several API tests have this name here: rename them, or import into a fresh organization' });
          continue;
        }
        const existing = same[0];
        if (existing && !await canEditProject(existing.projectId)) {
          results.push({ kind: 'api_test', name, outcome: 'invalid', reason: 'You can view this test\'s project but not change it.' });
          continue;
        }
        if (existing && sameAs(existing as unknown as Record<string, unknown>, raw, API_TEST_FIELDS)) {
          results.push({ kind: 'api_test', name, outcome: 'unchanged' });
          continue;
        }
        if (!parsed.data.dryRun) {
          const { projectId: _projectId, ...fields } = candidate.data;
          const [row] = existing
            ? await tx.update(apiTests).set({ ...fields, updatedAt: new Date() }).where(eq(apiTests.id, existing.id)).returning()
            : await tx.insert(apiTests).values({ ...candidate.data, userId: req.user!.id, organizationId: req.user!.organizationId }).returning();
          if (row) await recordTypedTestVersion(tx, {
            testType: 'api', testId: row.id, organizationId: req.user!.organizationId,
            userId: req.user!.id, test: row,
          });
        }
        results.push({ kind: 'api_test', name, outcome: existing ? 'updated' : 'created' });
      }
      const count = (o: Outcome['outcome']) => results.filter((r) => r.outcome === o).length;
      if (!parsed.data.dryRun && (count('created') > 0 || count('updated') > 0)) {
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.TESTS_IMPORTED,
          actor: auditActor(req),
          targetType: 'project',
          targetId: projectId ?? 'none',
          metadata: { project: bundle.project ?? null, created: count('created'), updated: count('updated'), unchanged: count('unchanged'), invalid: count('invalid') },
        });
      }
      return results;
    });
    res.status(parsed.data.dryRun ? 200 : 201).json({ dryRun: parsed.data.dryRun, results: outcomes });
  } catch (error: any) {
    if (error instanceof BundleProjectAccessError) return res.status(400).json({ error: "Invalid project ID or project does not allow edits." });
    if (isForeignKeyError(error)) return res.status(400).json({ error: "Invalid project ID or project does not exist." });
    throw error;
  }
});

// GET /api/tests/:id/playwright — the test as a Playwright Test file, with the steps a run would
// execute (groups and custom actions expanded, repository elements resolved). ?format=json adds what
// could not be exported.
router.get("/api/tests/:id/playwright", requireRole('viewer'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid test id" });
  const [test] = await withTenantTransaction((tx) => tx.select().from(tests).where(eq(tests.id, id)).limit(1));
  if (!test) return res.status(404).json({ error: "Test not found" });
  const expansion = await expandSequenceForRun(test.sequence);
  if (expansion.errors.length > 0) return res.status(409).json({ error: expansion.errors.join(' ') });
  const resolution = await resolveSequenceForRun(expansion.steps);
  const exported = toPlaywright({
    name: test.name,
    url: test.url,
    sequence: resolution.steps as never,
    preconditions: (test.preconditions as never) ?? null,
    cleanups: ((test as { cleanups?: unknown }).cleanups as never) ?? null,
    dataset: Array.isArray(test.dataset) ? (test.dataset as Array<Record<string, unknown>>) : null,
    version: test.publishedVersion ?? null,
  });
  if (req.query.format === 'json') return res.json(exported);
  res.setHeader("Content-Disposition", `attachment; filename="${exported.fileName}"`);
  res.type('text/plain').send(exported.code);
});

export default router;

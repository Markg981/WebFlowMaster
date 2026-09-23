import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { AUDIT_ACTIONS, reportTestCaseResults, tests, testVersions, users } from "@shared/schema";
import { auditActor, recordAudit } from "../audit";
import { withTenantTransaction, type TenantTx } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { recordTestVersion } from "../test-version-store";
import loggerPromise from "../logger";

/**
 * What a test used to be, and putting it back.
 *
 * A test that passed last week and fails today poses one question first: did the application
 * change, or did the test? Until now nothing could answer it — saving overwrote everything,
 * and the builder turns a name collision into an overwrite, so re-recording a flow discarded
 * the previous walk through the application with no trace.
 *
 * Restoring writes the old content back as a NEW version rather than deleting the ones after
 * it. app_user has no DELETE on this table at all (migration 0018): the application physically
 * cannot rewrite its own history, which is the only reason a history is worth reading.
 */

const router = Router();
const logger = await loggerPromise;

/** Counting steps in SQL, so listing a history never loads a sequence. */
const stepCount = sql<number>`CASE WHEN jsonb_typeof(${testVersions.sequence}) = 'array'
  THEN jsonb_array_length(${testVersions.sequence}) ELSE 0 END`;

/**
 * How each version actually did, counted from the runs that named it.
 *
 * A history that only says what changed is a list of edits. What somebody comparing two
 * versions wants is which of them was the one that worked — and since every result records the
 * version it ran (migration 0020), that is a count rather than a guess.
 *
 * One grouped query for the whole history: a test with thirty versions would otherwise be
 * thirty queries to open a dialog.
 */
async function runsByVersion(tx: TenantTx, testId: number) {
  const rows = await tx
    .select({
      version: reportTestCaseResults.testVersion,
      runs: sql<number>`count(*)`,
      passed: sql<number>`sum(case when lower(${reportTestCaseResults.status}) = 'passed' then 1 else 0 end)`,
      failed: sql<number>`sum(case when lower(${reportTestCaseResults.status}) = 'failed' then 1 else 0 end)`,
      lastRunAt: sql<string | null>`max(${reportTestCaseResults.startedAt})`,
    })
    .from(reportTestCaseResults)
    .where(eq(reportTestCaseResults.uiTestId, testId))
    .groupBy(reportTestCaseResults.testVersion);

  const byVersion = new Map<number, { runs: number; passed: number; failed: number; lastRunAt: string | null }>();
  // Runs from before results carried a version. Counted and reported separately rather than
  // spread over the versions they might have been: attributing them would be inventing history.
  let unversionedRuns = 0;

  for (const row of rows) {
    const runs = Number(row.runs ?? 0);
    if (row.version == null) {
      unversionedRuns += runs;
      continue;
    }
    byVersion.set(row.version, {
      runs,
      passed: Number(row.passed ?? 0),
      failed: Number(row.failed ?? 0),
      lastRunAt: row.lastRunAt ? new Date(row.lastRunAt).toISOString() : null,
    });
  }

  return { byVersion, unversionedRuns };
}

// GET /api/tests/:id/versions — the history, newest first, without the snapshots.
router.get("/api/tests/:id/versions", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const testId = Number(req.params.id);
  if (!Number.isInteger(testId)) return res.status(400).json({ error: "Invalid test id" });

  try {
    const outcome = await withTenantTransaction(async (tx) => {
      // RLS decides which test this is. Another organization's id has no versions here rather
      // than somebody else's.
      const [test] = await tx.select({ id: tests.id }).from(tests).where(eq(tests.id, testId)).limit(1);
      if (!test) return null;

      const outcomes = await runsByVersion(tx, testId);
      const versions = await tx
        .select({
          version: testVersions.version,
          name: testVersions.name,
          url: testVersions.url,
          summary: testVersions.summary,
          restoredFromVersion: testVersions.restoredFromVersion,
          createdAt: testVersions.createdAt,
          // Null when the member who saved it has since been removed: their work stays in the
          // history with an author nobody can name any more, rather than vanishing with them.
          authorName: users.username,
          stepCount,
        })
        .from(testVersions)
        .leftJoin(users, eq(testVersions.createdBy, users.id))
        .where(eq(testVersions.testId, testId))
        .orderBy(desc(testVersions.version));

      return { versions, ...outcomes };
    });

    if (outcome === null) return res.status(404).json({ error: "Test not found" });
    res.json({
      versions: outcome.versions.map((row) => ({
        ...row,
        stepCount: Number(row.stepCount ?? 0),
        // Zeroes rather than nothing for a version that has never run: "0 runs" is a fact
        // about that version, and it is the answer to "did we ever try this one?".
        ...(outcome.byVersion.get(row.version) ?? { runs: 0, passed: 0, failed: 0, lastRunAt: null }),
      })),
      unversionedRuns: outcome.unversionedRuns,
    });
  } catch (error: any) {
    logger.error({ message: 'Failed to list test versions', error: error?.message ?? String(error), testId });
    res.status(500).json({ error: "Failed to load the history." });
  }
});

// GET /api/tests/:id/versions/:version — one snapshot in full, for reading before restoring.
router.get("/api/tests/:id/versions/:version", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const testId = Number(req.params.id);
  const version = Number(req.params.version);
  if (!Number.isInteger(testId) || !Number.isInteger(version)) {
    return res.status(400).json({ error: "Invalid test or version id" });
  }

  try {
    const [snapshot] = await withTenantTransaction((tx) =>
      tx
        .select()
        .from(testVersions)
        .where(and(eq(testVersions.testId, testId), eq(testVersions.version, version)))
        .limit(1),
    );

    if (!snapshot) return res.status(404).json({ error: "Version not found" });
    res.json(snapshot);
  } catch (error: any) {
    logger.error({ message: 'Failed to read a test version', error: error?.message ?? String(error), testId });
    res.status(500).json({ error: "Failed to load that version." });
  }
});

/**
 * POST /api/tests/:id/versions/:version/restore — the test as it was on that day.
 *
 * The restore is itself a save, so it leaves a version of its own, marked with where it came
 * from. Restoring is an edit like any other and the history says so; the versions in between
 * stay exactly where they are, and can be restored in turn.
 */
router.post("/api/tests/:id/versions/:version/restore", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const testId = Number(req.params.id);
  const version = Number(req.params.version);
  if (!Number.isInteger(testId) || !Number.isInteger(version)) {
    return res.status(400).json({ error: "Invalid test or version id" });
  }

  try {
    const outcome = await withTenantTransaction(async (tx) => {
      const [snapshot] = await tx
        .select()
        .from(testVersions)
        .where(and(eq(testVersions.testId, testId), eq(testVersions.version, version)))
        .limit(1);
      if (!snapshot) return { missing: 'version' as const };

      const restored = await tx
        .update(tests)
        .set({
          // Only what a version holds. The project, the author, the reporting fields and the
          // status are facts about the test rather than about this sequence of steps, and a
          // restore that silently moved them would be doing more than it said.
          name: snapshot.name,
          url: snapshot.url,
          sequence: snapshot.sequence,
          elements: snapshot.elements,
          preconditions: snapshot.preconditions,
          dataset: snapshot.dataset,
          updatedAt: new Date(),
        })
        .where(eq(tests.id, testId))
        .returning();

      if (restored.length === 0) return { missing: 'test' as const };

      const recorded = await recordTestVersion(tx, {
        testId,
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        test: restored[0],
        restoredFromVersion: version,
      });

      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TEST_VERSION_RESTORED,
        actor: auditActor(req),
        targetType: 'test',
        targetId: testId,
        metadata: { name: restored[0].name, restoredFromVersion: version },
      });

      return { missing: null, test: restored[0], recorded };
    });

    if (outcome.missing === 'version') return res.status(404).json({ error: "Version not found" });
    if (outcome.missing === 'test') return res.status(404).json({ error: "Test not found" });

    res.json({
      test: outcome.test,
      restoredFrom: version,
      // Null when the test already was that version: restoring something already in place
      // changes nothing, and a history should not gain a row saying so.
      newVersion: outcome.recorded?.version ?? null,
    });
  } catch (error: any) {
    logger.error({ message: 'Failed to restore a test version', error: error?.message ?? String(error), testId });
    res.status(500).json({ error: "Failed to restore that version." });
  }
});

export default router;

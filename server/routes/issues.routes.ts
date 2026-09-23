import { Router } from "express";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import {
  issueLinks,
  issueTrackers,
  reportTestCaseResults,
  testPlanExecutions,
  testPlans,
} from "@shared/schema";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { fileFailure } from "../issue-store";
import { dedupeKeyFor } from "../issue-tracking";
import loggerPromise from "../logger";

/**
 * Filing a failure from the report, and saying what has already been filed.
 *
 * The automatic path belongs to the run (see server/test-execution-service.ts). This is the
 * other half: the person reading a report who decides this one is worth a ticket, and the
 * report itself, which should say "already filed as SHOP-412" instead of offering to file it
 * again.
 */

const router = Router();
const logger = await loggerPromise;

const fileSchema = z.object({
  executionId: z.string().min(1),
  testCaseResultId: z.string().min(1),
  /** Which tracker to file in. Optional when the plan names one, or when there is only one. */
  trackerId: z.string().optional().nullable(),
});

// POST /api/issues — file this failure, or say it again on the issue that already has it.
router.post("/api/issues", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const parsed = fileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  try {
    // Everything this needs, read under RLS: another organization's execution is not found
    // here rather than filed against somebody else's board.
    const context = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(reportTestCaseResults)
        .where(eq(reportTestCaseResults.id, parsed.data.testCaseResultId))
        .limit(1);
      if (!row || row.testPlanExecutionId !== parsed.data.executionId) return null;

      const [execution] = await tx
        .select({ id: testPlanExecutions.id, testPlanId: testPlanExecutions.testPlanId })
        .from(testPlanExecutions)
        .where(eq(testPlanExecutions.id, parsed.data.executionId))
        .limit(1);
      if (!execution) return null;

      const [plan] = execution.testPlanId
        ? await tx
            .select({ id: testPlans.id, name: testPlans.name, issueTrackerId: testPlans.issueTrackerId })
            .from(testPlans)
            .where(eq(testPlans.id, execution.testPlanId))
            .limit(1)
        : [undefined];

      const trackers = await tx.select().from(issueTrackers);
      return { row, execution, plan, trackers };
    });

    if (!context) return res.status(404).json({ error: "That result is not part of this execution." });

    const status = String(context.row.status).toLowerCase();
    if (status !== 'failed' && status !== 'error') {
      // Filing a passing test would put a bug on somebody's board that nobody can reproduce,
      // because there is nothing to reproduce.
      return res.status(400).json({ error: "That test did not fail, so there is nothing to file." });
    }

    const wantedId = parsed.data.trackerId ?? context.plan?.issueTrackerId ?? null;
    const tracker = wantedId
      ? context.trackers.find((candidate) => candidate.id === wantedId)
      : context.trackers.length === 1
        ? context.trackers[0]
        : undefined;

    if (!tracker) {
      return res.status(400).json({
        error: context.trackers.length === 0
          ? "No issue tracker is configured for this organization."
          : "Name which tracker to file this in.",
        trackers: context.trackers.map((candidate) => ({ id: candidate.id, name: candidate.name })),
      });
    }

    const outcome = await fileFailure({
      organizationId: req.user.organizationId,
      tracker,
      uiTestId: context.row.uiTestId,
      failure: {
        planId: context.execution.testPlanId,
        planName: context.plan?.name ?? null,
        executionId: context.execution.id,
        testName: context.row.testName,
        browser: context.row.browser,
        status: context.row.status,
        reason: context.row.reasonForFailure,
        startedAt: context.row.startedAt,
      },
    });

    if (outcome.action === 'failed') {
      // 502: this side did its part and the tracker refused. Saying 500 would send somebody
      // looking for the fault in the wrong system.
      return res.status(502).json({ error: outcome.error ?? "The tracker refused the issue." });
    }

    res.json({ ...outcome, tracker: { id: tracker.id, name: tracker.name, provider: tracker.provider } });
  } catch (error: any) {
    logger.error({ message: 'Failed to file an issue', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Could not file the issue." });
  }
});

/**
 * GET /api/test-plan-executions/:executionId/issues — what this run's failures already have.
 *
 * Matched by the same dedupe key the filing uses, so an issue opened by last night's run shows
 * against this morning's failure of the same test. A report that only knew about issues filed
 * from itself would invite the duplicate it is trying to prevent.
 */
router.get("/api/test-plan-executions/:executionId/issues", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  try {
    const links = await withTenantTransaction(async (tx) => {
      const [execution] = await tx
        .select({ id: testPlanExecutions.id, testPlanId: testPlanExecutions.testPlanId })
        .from(testPlanExecutions)
        .where(eq(testPlanExecutions.id, req.params.executionId))
        .limit(1);
      if (!execution) return null;

      const rows = await tx
        .select({ testName: reportTestCaseResults.testName, browser: reportTestCaseResults.browser })
        .from(reportTestCaseResults)
        .where(eq(reportTestCaseResults.testPlanExecutionId, execution.id));

      const keys = Array.from(
        new Set(
          rows.map((row) =>
            dedupeKeyFor({ planId: execution.testPlanId, testName: row.testName, browser: row.browser }),
          ),
        ),
      );
      if (keys.length === 0) return [];

      return tx
        .select({
          dedupeKey: issueLinks.dedupeKey,
          testName: issueLinks.testName,
          browser: issueLinks.browser,
          issueKey: issueLinks.issueKey,
          issueUrl: issueLinks.issueUrl,
          occurrences: issueLinks.occurrences,
          resolvedAt: issueLinks.resolvedAt,
          trackerId: issueLinks.trackerId,
        })
        .from(issueLinks)
        .where(inArray(issueLinks.dedupeKey, keys));
    });

    if (links === null) return res.status(404).json({ error: "Execution not found." });
    res.json(links);
  } catch (error: any) {
    logger.error({ message: 'Failed to list issues for an execution', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Could not load the filed issues." });
  }
});

export default router;

import { Router } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import { reportTestCaseResults, testPlanExecutions } from "@shared/schema";
import { getDashboardMetrics } from "../analytics";
import { summariseFlakiness } from "../flaky";
import { openQuarantinesOf, refKey } from "../test-quarantine";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import loggerPromise from "../logger";

const router = Router();
const logger = await loggerPromise;

/** How far back "sometimes" looks, unless the caller says otherwise. */
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;

/**
 * GET /api/analytics/dashboard — the figures the dashboard is built from.
 *
 * `getDashboardMetrics` existed and was never called: nothing mounted a route for it, so the
 * client's request fell through to the catch-all that serves index.html, `res.json()` threw
 * on the HTML, and the query failed. The dashboard then showed zeroes and empty panels for
 * every account — not because nothing had run, but because the page was not connected to
 * anything. An empty state is only honest when a full one is reachable.
 */
router.get("/api/analytics/dashboard", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const metrics = await getDashboardMetrics((req.user as { id: number }).id);
    res.json(metrics);
  } catch (e: any) {
    logger.error({ message: "Dashboard metrics failed", error: e.message });
    res.status(500).json({ error: "Failed to load dashboard metrics" });
  }
});

/**
 * GET /api/analytics/flaky — the tests that disagree with themselves.
 *
 * Every run was readable on its own and nothing looked across them, so a test that fails one
 * night and passes the next was investigated fresh each time — and eventually trusted less
 * than it should be, which is how a real failure gets waved through as "that one is flaky".
 *
 * Optional `planId` narrows it to one plan, `days` moves the window, and `minRuns`/`minFlips`
 * decide how much evidence counts as an opinion.
 */
router.get("/api/analytics/flaky", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const days = clampNumber(req.query.days, DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS);
  const minimumRuns = clampNumber(req.query.minRuns, 3, 2, 100);
  const minimumFlips = clampNumber(req.query.minFlips, 1, 1, 100);
  const limit = clampNumber(req.query.limit, 20, 1, 200);
  const planId = typeof req.query.planId === 'string' && req.query.planId !== '' ? req.query.planId : null;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    // No organization predicate: RLS supplies it on both tables, so this can only ever see
    // one tenant's history.
    const rows = await withTenantTransaction((tx) => {
      const conditions = [gte(reportTestCaseResults.startedAt, since)];
      if (planId) conditions.push(eq(testPlanExecutions.testPlanId, planId));
      return tx
        .select({
          testName: reportTestCaseResults.testName,
          browser: reportTestCaseResults.browser,
          status: reportTestCaseResults.status,
          startedAt: reportTestCaseResults.startedAt,
          testPlanExecutionId: reportTestCaseResults.testPlanExecutionId,
          durationMs: reportTestCaseResults.durationMs,
          // What separates a test that disagrees with itself from one somebody edited.
          testVersion: reportTestCaseResults.testVersion,
          uiTestId: reportTestCaseResults.uiTestId,
          apiTestId: reportTestCaseResults.apiTestId,
        })
        .from(reportTestCaseResults)
        .innerJoin(testPlanExecutions, eq(reportTestCaseResults.testPlanExecutionId, testPlanExecutions.id))
        .where(and(...conditions))
        .orderBy(desc(reportTestCaseResults.startedAt));
    });

    const summaries = summariseFlakiness(rows, { minimumRuns, minimumFlips }).slice(0, limit);
    // Which of them are already in quarantine, so the page offers releasing rather than quarantining.
    const refs = summaries.flatMap((s) => (s.test ? [s.test] : []));
    const open = await withTenantTransaction((tx) => openQuarantinesOf(tx, refs));
    res.json({
      window: { days, since: since.toISOString(), resultsExamined: rows.length },
      thresholds: { minimumRuns, minimumFlips },
      items: summaries.map((summary) => {
        const quarantine = summary.test ? open.get(refKey(summary.test)) : undefined;
        return {
          ...summary,
          quarantine: quarantine
            ? { id: quarantine.id, reason: quarantine.reason, since: quarantine.quarantinedAt.toISOString() }
            : null,
        };
      }),
    });
  } catch (e: any) {
    logger.error({ message: "Flaky analysis failed", error: e.message });
    res.status(500).json({ error: "Failed to analyse flaky tests" });
  }
});

/** A query parameter read as a number, or the default, and never outside the allowed range. */
function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export default router;

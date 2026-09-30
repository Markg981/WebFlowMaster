import { Router } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, reportTestCaseResults, testPlanExecutions } from "@shared/schema";
import {
  MANUAL_STEP_OUTCOMES,
  MANUAL_VERDICTS,
  VERDICT_STATUS,
  readManualLog,
  type ManualResultLog,
} from "@shared/manual-tests";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { auditActor, recordAudit } from "../audit";
import { failuresOf } from "../test-quarantine";
import loggerPromise from "../logger";

/**
 * A person's verdict on a manual test in a run (shared/manual-tests.ts).
 *
 * Given after the run has ended, because until then the runner is still writing the run's totals
 * and would overwrite whatever this wrote. The totals and the run's status are worked out again
 * from every result, with the rule the runner uses: a failure that is not quarantined fails the
 * run. A cancelled or timed-out run keeps its ending — the verdict does not undo a stop.
 */

const router = Router();
const logger = await loggerPromise;

/** A run the runner has finished with. */
const ENDED = new Set(["completed", "failed", "error", "cancelled", "timed_out"]);
/** Endings a verdict can change: the ones that are themselves verdicts on the results. */
const DECIDED_BY_RESULTS = new Set(["completed", "failed"]);

const bodySchema = z.object({
  outcome: z.enum(MANUAL_VERDICTS),
  notes: z.string().trim().max(2000).optional().nullable(),
  stepOutcomes: z
    .array(z.object({ outcome: z.enum(MANUAL_STEP_OUTCOMES), note: z.string().trim().max(1000).optional().nullable() }))
    .max(200)
    .optional(),
});

router.put(
  "/api/test-plan-executions/:executionId/results/:resultId/manual-verdict",
  requireRole("editor"),
  async (req, res) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
    const { executionId, resultId } = req.params;

    try {
      const outcome = await withTenantTransaction(async (tx) => {
        const [run] = await tx.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, executionId)).limit(1);
        if (!run) return { status: 404, error: "Run not found." } as const;
        const [result] = await tx
          .select()
          .from(reportTestCaseResults)
          .where(and(eq(reportTestCaseResults.id, resultId), eq(reportTestCaseResults.testPlanExecutionId, executionId)))
          .limit(1);
        if (!result) return { status: 404, error: "Result not found in this run." } as const;

        const log = readManualLog(result.detailedLog);
        // Only a manual test's result: an automated one is what the browser saw, and a person
        // overriding it would make the report say something nobody observed.
        if (!log) return { status: 409, error: "This result is an automated test's; only a manual test's result can be recorded by hand." } as const;
        if (!ENDED.has(run.status)) return { status: 409, error: "The run is still going. Record manual results once it has finished." } as const;

        const stepOutcomes = parsed.data.stepOutcomes ?? [];
        if (stepOutcomes.length > 0 && stepOutcomes.length !== log.steps.length) {
          return { status: 400, error: `The test has ${log.steps.length} step(s); ${stepOutcomes.length} outcome(s) were given.` } as const;
        }

        const notes = parsed.data.notes || null;
        const firstFailedNote = stepOutcomes.find((step) => step.outcome === "failed" && step.note)?.note ?? null;
        const nextLog: ManualResultLog = {
          ...log,
          verdict: {
            outcome: parsed.data.outcome,
            notes,
            stepOutcomes: stepOutcomes.map((step) => ({ outcome: step.outcome, note: step.note || null })),
            byUserId: req.user!.id,
            byUsername: req.user!.username,
            at: new Date().toISOString(),
          },
        };
        const status = VERDICT_STATUS[parsed.data.outcome];
        const [updated] = await tx
          .update(reportTestCaseResults)
          .set({
            status,
            reasonForFailure:
              parsed.data.outcome === "passed" ? null : notes ?? firstFailedNote ?? (parsed.data.outcome === "blocked" ? "Blocked" : "Failed"),
            detailedLog: JSON.stringify(nextLog),
            completedAt: new Date(),
          })
          .where(eq(reportTestCaseResults.id, resultId))
          .returning();

        // The run's totals, from every result as it now stands.
        const rows = await tx
          .select()
          .from(reportTestCaseResults)
          .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
        const totals = {
          totalTests: rows.length,
          passedTests: rows.filter((row) => row.status === "Passed").length,
          failedTests: rows.filter((row) => row.status === "Failed").length,
          skippedTests: rows.filter((row) => row.status === "Skipped").length,
          quarantinedFailures: failuresOf(rows).quarantined,
        };
        const runStatus = DECIDED_BY_RESULTS.has(run.status) ? (failuresOf(rows).holding > 0 ? "failed" : "completed") : run.status;
        await tx.update(testPlanExecutions).set({ ...totals, status: runStatus }).where(eq(testPlanExecutions.id, executionId));

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.RUN_MANUAL_RESULT_RECORDED,
          actor: auditActor(req),
          targetType: "run",
          targetId: executionId,
          metadata: { test: result.testName, outcome: parsed.data.outcome, previous: result.status, runStatus },
        });
        return { status: 200, result: updated, run: { ...totals, status: runStatus } } as const;
      });

      if ("error" in outcome) return res.status(outcome.status).json({ error: outcome.error });
      res.json({ result: outcome.result, run: outcome.run });
    } catch (error: any) {
      logger.error({ message: "Failed to record a manual result", error: error?.message ?? String(error), executionId, resultId });
      res.status(500).json({ error: "Failed to record the result." });
    }
  },
);

export default router;

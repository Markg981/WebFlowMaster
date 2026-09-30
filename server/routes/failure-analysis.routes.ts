import { Router } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, reportTestCaseResults, testPlanExecutions } from "@shared/schema";
import {
  ANALYSABLE_STATUSES,
  ANALYSIS_LANGUAGES,
  readFailureAnalysis,
  type FailureAnalysis,
} from "@shared/failure-analysis";
import type { NetworkSummary } from "@shared/network";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { auditActor, recordAudit } from "../audit";
import { aiService } from "../ai-automation-service";
import { buildFailurePrompt, evidenceSteps, parseFailureAnswer } from "../failure-analysis";
import { failedStepScreenshot, readScreenshot } from "../report-model";
import loggerPromise from "../logger";

/**
 * The AI's reading of a failed result, asked for from the report.
 *
 * On demand rather than on every failure: an analysis sends the test's evidence to the model and
 * costs a call, so it happens when somebody wants one. It is kept on the result and handed back
 * as it is until somebody asks for a fresh one. The model is called outside any transaction —
 * a slow answer must not hold a connection — and the result is read again before it is written.
 */

const router = Router();
const logger = await loggerPromise;

const bodySchema = z.object({
  language: z.enum(ANALYSIS_LANGUAGES).optional().default("en"),
  /** Ask again even though an analysis is kept. */
  refresh: z.boolean().optional().default(false),
});

const ANALYSABLE = new Set<string>(ANALYSABLE_STATUSES);

router.post(
  "/api/test-plan-executions/:executionId/results/:resultId/ai-analysis",
  requireRole("editor"),
  async (req, res) => {
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
    const { executionId, resultId } = req.params;
    const { language, refresh } = parsed.data;

    try {
      const found = await withTenantTransaction(async (tx) => {
        const [run] = await tx.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, executionId)).limit(1);
        if (!run) return null;
        const [result] = await tx
          .select()
          .from(reportTestCaseResults)
          .where(and(eq(reportTestCaseResults.id, resultId), eq(reportTestCaseResults.testPlanExecutionId, executionId)))
          .limit(1);
        return result ? { run, result } : null;
      });
      if (!found) return res.status(404).json({ error: "Result not found." });
      const { run, result } = found;

      if (!ANALYSABLE.has(result.status)) {
        return res.status(409).json({ error: "Only a failed result can be analysed." });
      }
      const kept = readFailureAnalysis(result.aiAnalysis);
      if (kept && !refresh) return res.json({ analysis: kept, cached: true });
      if (!aiService.isAvailable()) {
        return res.status(503).json({ error: "AI analysis is not configured on this server (GEMINI_API_KEY)." });
      }

      const screenshotPath = run.artifactsPurgedAt ? null : result.screenshotUrl ?? failedStepScreenshot(result.detailedLog);
      const screenshot = await readScreenshot({ planId: run.testPlanId, executionId }, screenshotPath);
      const prompt = buildFailurePrompt(
        {
          testName: result.testName,
          testType: result.testType,
          browser: result.browser,
          status: result.status,
          reason: result.reasonForFailure,
          detailedLog: result.detailedLog,
          network: (result.networkSummary as NetworkSummary | null) ?? null,
        },
        language,
        !!screenshot,
      );
      const answer = parseFailureAnswer(
        await aiService.explainFailure(prompt, screenshot),
        evidenceSteps(result.detailedLog).length,
      );
      if (!answer) return res.status(502).json({ error: "The AI gave no usable answer. Try again in a moment." });

      const analysis: FailureAnalysis = {
        ...answer,
        sawScreenshot: !!screenshot,
        language,
        model: aiService.analysisModel,
        byUsername: req.user!.username,
        at: new Date().toISOString(),
      };
      const saved = await withTenantTransaction(async (tx) => {
        const [updated] = await tx
          .update(reportTestCaseResults)
          .set({ aiAnalysis: analysis })
          .where(eq(reportTestCaseResults.id, resultId))
          .returning();
        if (!updated) return false;
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.RUN_FAILURE_ANALYSED,
          actor: auditActor(req),
          targetType: "run",
          targetId: executionId,
          metadata: { test: result.testName, category: analysis.category, model: analysis.model, screenshot: analysis.sawScreenshot },
        });
        return true;
      });
      if (!saved) return res.status(404).json({ error: "Result not found." });
      res.json({ analysis, cached: false });
    } catch (error: any) {
      logger.error({ message: "Failed to analyse a failure", error: error?.message ?? String(error), executionId, resultId });
      res.status(500).json({ error: "Failed to analyse the failure." });
    }
  },
);

export default router;

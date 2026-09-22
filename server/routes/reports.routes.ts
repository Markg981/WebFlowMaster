import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { reportTestCaseResults, testPlanExecutions, testPlans } from "@shared/schema";
import { reportingService } from "../reporting-service";
import { buildJUnitXml } from "../junit";
import { withTenantTransaction } from "../middleware/tenancy";
import loggerPromise from "../logger";
import { requireRole } from "../middleware/require-role";

const router = Router();
const logger = await loggerPromise;

/**
 * GET /api/test-plan-executions/:executionId/junit — the run as JUnit XML.
 *
 * Every CI system reads this format and none of them read ours, so without it a pipeline
 * could learn that a run failed and nothing more: which test, on which browser, and why all
 * stayed behind a login. With it, the failures appear in the build's own test report.
 */
router.get("/api/test-plan-executions/:executionId/junit", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

    const { executionId } = req.params;
    try {
        // No organization filter: RLS applies it, so another tenant's run is simply absent.
        const source = await withTenantTransaction(async (tx) => {
            const [execution] = await tx
                .select({
                    id: testPlanExecutions.id,
                    startedAt: testPlanExecutions.startedAt,
                    planName: testPlans.name,
                    testPlanId: testPlanExecutions.testPlanId,
                })
                .from(testPlanExecutions)
                .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
                .where(eq(testPlanExecutions.id, executionId))
                .limit(1);
            if (!execution) return null;

            const results = await tx
                .select()
                .from(reportTestCaseResults)
                .where(eq(reportTestCaseResults.testPlanExecutionId, executionId))
                .orderBy(asc(reportTestCaseResults.startedAt));
            return { execution, results };
        });

        if (!source) return res.status(404).json({ error: "Test plan execution not found." });

        const xml = buildJUnitXml({
            planName: source.execution.planName ?? source.execution.testPlanId,
            executionId,
            startedAt: source.execution.startedAt,
            results: source.results,
        });

        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        // Named after the run, because a pipeline that collects several of these needs them
        // to be different files.
        res.setHeader('Content-Disposition', `attachment; filename="junit-${executionId}.xml"`);
        res.send(xml);
    } catch (e: any) {
        logger.error({ message: "Failed to build JUnit report", executionId, error: e.message });
        res.status(500).json({ error: "Failed to build the JUnit report." });
    }
});

// POST /api/reports/generate - Generate Allure Report
router.post("/api/reports/generate", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    
    try {
        await reportingService.generateFinalHtmlReport();
        res.json({ success: true, message: "Report generated successfully" });
    } catch (e: any) {
        logger.error({ message: "Report handling failed", error: e.message });
        res.status(500).json({ error: "Failed to generate report" });
    }
});

export default router;

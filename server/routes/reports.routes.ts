import { Router } from "express";
import { junitReportFor } from "../junit-report";
import loggerPromise from "../logger";
import { requireRole } from "../middleware/require-role";
import { exportRun, isReportExportFormat, REPORT_EXPORT_FORMATS, ReportExportError, sendExport } from "../report-export";
import { z } from 'zod';
import { executionOrchestrator, ExecutionEnqueueError } from '../execution-orchestrator';
import { QuotaError, quotaErrorBody } from '../tenant-quotas';

const router = Router();
const logger = await loggerPromise;

router.post('/api/test-plan-executions/:executionId/replay', requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
    const id = z.string().uuid().safeParse(req.params.executionId);
    const body = z.object({ mode: z.literal('historical') }).strict().safeParse(req.body);
    const key = req.get('Idempotency-Key');
    if (!id.success || !body.success || (key !== undefined && (!key.trim() || key.length > 200)))
        return res.status(400).json({ error: 'Replay requires a valid execution id and mode historical.' });
    try {
        const execution = await executionOrchestrator.replay(id.data, req.user.id, key?.trim());
        // Returning the snapshot would expose retained auth parameters and dataset values.
        res.status(202).json({ id: execution.id, testPlanId: execution.testPlanId, status: execution.status });
    } catch (error) {
        if (error instanceof ExecutionEnqueueError) return res.status(error.status).json({ error: error.message, code: error.code });
        if (error instanceof QuotaError) return res.status(error.status).json(quotaErrorBody(error));
        logger.error({ message: 'Could not replay execution', executionId: id.data, error: (error as Error).message });
        res.status(500).json({ error: 'Could not replay execution' });
    }
});

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
        const xml = await junitReportFor(executionId);
        if (xml === null) return res.status(404).json({ error: "Test plan execution not found." });

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

/**
 * GET /api/test-plan-executions/:executionId/export/:format — the run as a file to hand on:
 * html (self-contained), pdf, or allure (a zip of Allure results). See server/report-export.ts.
 */
router.get("/api/test-plan-executions/:executionId/export/:format", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

    const { executionId, format } = req.params;
    if (!isReportExportFormat(format)) {
        return res.status(400).json({ error: `Unknown format "${format}". Use one of: ${REPORT_EXPORT_FORMATS.join(', ')}.` });
    }
    try {
        const exported = await exportRun(executionId, format);
        if (!exported) return res.status(404).json({ error: "Test plan execution not found." });
        sendExport(res, exported);
    } catch (e: any) {
        if (e instanceof ReportExportError) return res.status(e.status).json({ error: e.message, code: e.code });
        logger.error({ message: "Failed to export the report", executionId, format, error: e.message });
        res.status(500).json({ error: "Failed to export the report." });
    }
});

export default router;

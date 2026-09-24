import { Router, type Request } from "express";
import { z } from "zod";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { AUDIT_ACTIONS, testPlanExecutions, testPlans, type TestPlanExecution } from "@shared/schema";
import { auditActor, recordAudit } from "../audit";
import { EXECUTION_STATUSES } from "@shared/execution-status";
import { withTenantTransaction } from "../middleware/tenancy";
import { apiError, requireScope } from "../middleware/require-scope";
import { executionOrchestrator, ExecutionEnqueueError } from "../execution-orchestrator";
import { requestCancellation } from "../execution-state";
import { junitReportFor } from "../junit-report";
import { exportRun, isReportExportFormat, REPORT_EXPORT_FORMATS, ReportExportError, sendExport } from "../report-export";
import { openApiDocument } from "../api-v1/openapi";
import { ciContextSchema } from "@shared/ci";
import { reportUrlFor } from "../report-links";
import loggerPromise from "../logger";

/**
 * /api/v1 — the API a pipeline is meant to use, described by /api/v1/openapi.json.
 *
 * The rest of /api is the web application's own: shaped for its pages, changed whenever they
 * change, and reachable only with a session or a key from before scopes. This is the part that
 * promises to stay put. Its shapes are written out here rather than being whatever the table
 * holds, so a column added for a page does not become part of a contract; errors are always
 * `{ error: { code, message } }`; and every endpoint names the scope it needs, which the
 * OpenAPI test holds the document to.
 */

const router = Router();
const logger = await loggerPromise;

/** A run as the API describes it. Written out, so a new column is absent until chosen. */
function toRun(row: TestPlanExecution & { testPlanName?: string | null }) {
  return {
    id: row.id,
    planId: row.testPlanId,
    planName: row.testPlanName ?? null,
    status: row.status,
    trigger: row.triggeredBy,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationMs: row.executionDurationMs,
    tests: {
      total: row.totalTests,
      passed: row.passedTests,
      failed: row.failedTests,
      skipped: row.skippedTests,
      /** Of the failed, those of tests in quarantine: they did not decide the status. */
      quarantinedFailures: row.quarantinedFailures,
    },
    failure: row.failureCode ? { code: row.failureCode, message: row.failureMessage } : null,
    /** Which runner took it (host:pid:suffix); null while it waits. */
    runner: row.runnerId ?? null,
    /** The build that asked for it, as it was sent; null for a run no pipeline started. */
    ci: row.ciContext ?? null,
    links: {
      self: `/api/v1/runs/${row.id}`,
      junit: `/api/v1/runs/${row.id}/junit`,
      /** The report page, absolute, when the installation knows its own address (APP_BASE_URL). */
      report: reportUrlFor(row.testPlanId, row.id) ?? null,
    },
  };
}

function page(req: Request) {
  const limit = Math.min(Math.max(1, Number.parseInt(String(req.query.limit ?? ''), 10) || 20), 100);
  const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? ''), 10) || 0);
  return { limit, offset };
}

// The description of everything below. Public: it says what exists, never what anyone has.
router.get("/api/v1/openapi.json", (_req, res) => {
  res.json(openApiDocument);
});

router.get("/api/v1/plans", requireScope('plans:read'), async (req, res) => {
  const { limit, offset } = page(req);
  // No organization filter: RLS supplies it.
  const rows = await withTenantTransaction((tx) =>
    tx
      .select({ id: testPlans.id, name: testPlans.name, description: testPlans.description, createdAt: testPlans.createdAt })
      .from(testPlans)
      .orderBy(testPlans.name)
      .limit(limit)
      .offset(offset),
  );
  res.json({ items: rows, limit, offset });
});

const startRunSchema = z.object({
  environmentId: z.number().int().positive().optional(),
  updateBaselines: z.boolean().optional(),
  /** The build, commit and branch asking for the run. The CLI fills it in from the CI's environment. */
  ci: ciContextSchema.optional(),
}).strict();

router.post("/api/v1/plans/:planId/runs", requireScope('runs:write'), async (req, res) => {
  const parsed = startRunSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return apiError(res, 400, 'invalid_request', 'The body does not match the schema.', { details: parsed.error.flatten() });
  }
  const idempotencyKey = req.get('Idempotency-Key')?.trim() || undefined;
  if (idempotencyKey && idempotencyKey.length > 255) {
    return apiError(res, 400, 'invalid_request', 'Idempotency-Key must be at most 255 characters.');
  }

  // Looked up here, under RLS, before the orchestrator — whose own lookup is the privileged
  // one that finds the plan's organization. Without this, another organization's plan id
  // would come back 403 instead of 404, which says it exists.
  const [plan] = await withTenantTransaction((tx) =>
    tx.select({ id: testPlans.id, name: testPlans.name }).from(testPlans).where(eq(testPlans.id, req.params.planId)).limit(1),
  );
  if (!plan) return apiError(res, 404, 'plan_not_found', 'There is no such test plan in this organization.');

  try {
    const execution = await executionOrchestrator.enqueue({
      planId: plan.id,
      requestedByUserId: req.user!.id,
      trigger: 'api',
      environmentId: parsed.data.environmentId ?? null,
      updateBaselines: parsed.data.updateBaselines,
      idempotencyKey,
      ciContext: parsed.data.ci ?? null,
    });
    logger.info({ message: 'Run started through /api/v1', planId: plan.id, executionId: execution.id, userId: req.user!.id });
    // 202: the run is queued, not done. `Location` is where to ask how it is going.
    res.status(202).location(`/api/v1/runs/${execution.id}`).json(toRun({ ...execution, testPlanName: plan.name }));
  } catch (error: any) {
    if (error instanceof ExecutionEnqueueError) {
      return apiError(res, error.status, error.code, error.message, error.executionId ? { runId: error.executionId } : {});
    }
    logger.error({ message: 'Failed to start a run through /api/v1', planId: plan.id, error: error?.message ?? String(error) });
    return apiError(res, 500, 'internal_error', 'The run could not be started.');
  }
});

router.get("/api/v1/runs", requireScope('runs:read'), async (req, res) => {
  const { limit, offset } = page(req);
  const conditions: SQL[] = [];
  if (typeof req.query.planId === 'string' && req.query.planId) conditions.push(eq(testPlanExecutions.testPlanId, req.query.planId));
  if (typeof req.query.status === 'string' && req.query.status) {
    if (!(EXECUTION_STATUSES as readonly string[]).includes(req.query.status)) {
      return apiError(res, 400, 'invalid_request', `status must be one of: ${EXECUTION_STATUSES.join(', ')}.`);
    }
    conditions.push(eq(testPlanExecutions.status, req.query.status));
  }

  const rows = await withTenantTransaction((tx) => {
    let query = tx
      .select({ execution: testPlanExecutions, testPlanName: testPlans.name })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
      .$dynamic();
    if (conditions.length > 0) query = query.where(and(...conditions));
    return query
      .orderBy(desc(sql`coalesce(${testPlanExecutions.startedAt}, ${testPlanExecutions.queuedAt})`))
      .limit(limit)
      .offset(offset);
  });
  res.json({ items: rows.map((r) => toRun({ ...r.execution, testPlanName: r.testPlanName })), limit, offset });
});

router.get("/api/v1/runs/:runId", requireScope('runs:read'), async (req, res) => {
  const [row] = await withTenantTransaction((tx) =>
    tx
      .select({ execution: testPlanExecutions, testPlanName: testPlans.name })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
      .where(eq(testPlanExecutions.id, req.params.runId))
      .limit(1),
  );
  if (!row) return apiError(res, 404, 'run_not_found', 'There is no such run in this organization.');
  res.json(toRun({ ...row.execution, testPlanName: row.testPlanName }));
});

router.post("/api/v1/runs/:runId/cancel", requireScope('runs:write'), async (req, res) => {
  const who = req.user!.displayName ?? req.user!.username;
  const result = await requestCancellation(req.params.runId, `Cancelled by ${who} through the API.`, (tx, execution) =>
    recordAudit(tx, {
      action: AUDIT_ACTIONS.RUN_CANCELLED,
      actor: auditActor(req),
      targetType: 'run',
      targetId: execution.id,
      metadata: { planId: execution.testPlanId },
    }),
  );
  switch (result.outcome) {
    case 'not_found':
      return apiError(res, 404, 'run_not_found', 'There is no such run in this organization.');
    case 'already_ended':
      return apiError(res, 409, 'run_already_ended', `The run has already ended (${result.status}).`, { status: result.status });
    case 'cancelled':
      return res.status(200).json(toRun(result.execution));
    case 'cancelling':
      // Asked to stop; its worker ends it at the next step.
      return res.status(202).json(toRun(result.execution));
  }
});

router.get("/api/v1/runs/:runId/junit", requireScope('runs:read'), async (req, res) => {
  const xml = await junitReportFor(req.params.runId);
  if (xml === null) return apiError(res, 404, 'run_not_found', 'There is no such run in this organization.');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="junit-${req.params.runId}.xml"`);
  res.send(xml);
});

router.get("/api/v1/runs/:runId/export/:format", requireScope('runs:read'), async (req, res) => {
  const { runId, format } = req.params;
  if (!isReportExportFormat(format)) {
    return apiError(res, 400, 'invalid_format', `Unknown format "${format}". Use one of: ${REPORT_EXPORT_FORMATS.join(', ')}.`);
  }
  try {
    const exported = await exportRun(runId, format);
    if (!exported) return apiError(res, 404, 'run_not_found', 'There is no such run in this organization.');
    sendExport(res, exported);
  } catch (error) {
    if (error instanceof ReportExportError) return apiError(res, error.status, error.code, error.message);
    return apiError(res, 500, 'export_failed', 'The report could not be exported.');
  }
});

// Anything else under /api/v1 is an unknown endpoint, said in this API's own words rather
// than falling through to the web application's.
router.all(/^\/api\/v1(\/.*)?$/, (req, res) => {
  apiError(res, 404, 'not_found', `There is no ${req.method} ${req.path} in /api/v1. See /api/v1/openapi.json.`);
});

export default router;

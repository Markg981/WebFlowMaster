import type { Request, Response } from 'express';
import { and, asc, count, desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  AUDIT_ACTIONS,
  comparisonResults,
  comparisonRuns,
  reportTestCaseResults,
  testPlanExecutions,
  testPlans,
  type ComparisonResult,
  type ComparisonRun,
} from '@shared/schema';
import {
  COMPARISON_RESULT_VERDICTS,
  COMPARISON_REVIEW_STATUSES,
  COMPARISON_STATUSES,
  CreateComparisonSchema,
  type ComparisonDifference,
} from '@shared/comparison';
import { asyncRouter } from '../../platform/middleware/async-router';
import { withTenantTransaction, type TenantTx } from '../../platform/middleware/tenancy';
import logger from '../../platform/logger';
import { auditActor, recordAudit } from '../../tenancy/audit';
import { runArtifactAccess, type RunArtifactAccess } from '../../tenancy/artifact-access';
import { publicExecution } from '../../execution/execution-provenance';
import { ComparisonError } from '../../execution/comparison-orchestrator';
import { comparisonOrchestrator } from '../../execution/comparisons';
import { stepsOfLog, type ComparedStep } from '../../reporting/comparison/steps';
import { flattenZodError } from '../zod-error';
import { sessionRateLimit } from '../middleware/rate-limits';
import { requireRole } from '../middleware/require-role';
import { evidencePrincipalOf } from '../middleware/require-scope';
import { artifactUrl } from './artifacts.routes';

/**
 * Run comparisons: one plan run on two environments and the two runs compared
 * (docs/superpowers/specs/2026-11-12-run-comparison-design.md).
 *
 * Reading is a viewer's right, as reading a run report is; starting and cancelling are an
 * editor's. Row-level security decides which comparisons a caller finds; a test of a restricted
 * project the caller is not on keeps its verdict but not its differences or steps, as in the run
 * report (resultForViewer).
 */

const router = asyncRouter();

// Every route reads the database on each call: bounded per user, like every session route.
const comparisonsLimit = sessionRateLimit();

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const page = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
const listQuery = z.object({
  planId: z.string().min(1).max(200).optional(),
  status: z.enum(COMPARISON_STATUSES).optional(),
  ...page,
});
const resultsQuery = z.object({
  verdict: z.enum(COMPARISON_RESULT_VERDICTS).optional(),
  module: z.string().max(200).optional(),
  reviewStatus: z.enum(COMPARISON_REVIEW_STATUSES).optional(),
  ...page,
});

/** The comparison as the client sees it; the idempotency key is the caller's, not shown. */
function view(row: ComparisonRun, planName?: string | null) {
  return {
    id: row.id,
    planId: row.testPlanId,
    planName: planName ?? null,
    name: row.name,
    mode: row.mode,
    status: row.status,
    verdict: row.verdict,
    summary: row.summary,
    policy: row.policy,
    baseline: {
      environmentId: row.baselineEnvironmentId,
      environmentName: row.baselineEnvironmentName,
      executionId: row.baselineExecutionId,
    },
    candidate: {
      environmentId: row.candidateEnvironmentId,
      environmentName: row.candidateEnvironmentName,
      executionId: row.candidateExecutionId,
    },
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    requestedByUserId: row.requestedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function notFound(res: Response) {
  return res.status(404).json({ error: 'Comparison not found.', code: 'comparison_not_found' });
}

function invalid(res: Response, error: z.ZodError) {
  return res.status(400).json({ error: 'Invalid request', details: flattenZodError(error) });
}

async function readComparison(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({ comparison: comparisonRuns, planName: testPlans.name })
    .from(comparisonRuns)
    .leftJoin(testPlans, eq(testPlans.id, comparisonRuns.testPlanId))
    .where(eq(comparisonRuns.id, id))
    .limit(1);
  return row ?? null;
}

/** The caller's access to the files of each side's run; null for a side that has no run yet. */
async function accessOf(tx: TenantTx, req: Request, comparison: ComparisonRun) {
  const principal = evidencePrincipalOf(req);
  const side = (executionId: string | null) =>
    executionId
      ? runArtifactAccess(tx, {
          organizationId: comparison.organizationId,
          executionId,
          principal,
        })
      : Promise.resolve(null);
  return {
    baseline: await side(comparison.baselineExecutionId),
    candidate: await side(comparison.candidateExecutionId),
  };
}

/** A step of one side with its screenshot as a link the caller may open, or null. */
function stepView(step: ComparedStep, executionId: string, access: RunArtifactAccess) {
  return {
    key: step.key,
    index: step.index,
    stepId: step.stepId,
    name: step.name,
    status: step.status,
    screenshot: artifactUrl(executionId, step.screenshot, access.linkable),
    checkpoint: step.checkpoint,
  };
}

/** A visual difference names stored screenshots: they become links, or null when withheld. */
function differenceView(
  difference: ComparisonDifference,
  links: {
    baseline: (stored: string) => string | null;
    candidate: (stored: string) => string | null;
  },
): ComparisonDifference {
  if (difference.kind !== 'visual') return difference;
  const linked = (value: unknown, link: (stored: string) => string | null) => {
    const record = value as { screenshot?: unknown } | null;
    if (!record || typeof record.screenshot !== 'string') return value;
    return { ...record, screenshot: link(record.screenshot) };
  };
  return {
    ...difference,
    baseline: linked(difference.baseline, links.baseline),
    candidate: linked(difference.candidate, links.candidate),
  };
}

// The list leaves the differences out: they are read one test at a time.
const { differences: _differences, ...listColumns } = getTableColumns(comparisonResults);

function resultView(row: Omit<ComparisonResult, 'differences'>, differenceCount: number) {
  return {
    id: row.id,
    pairKey: row.pairKey,
    testType: row.testType,
    uiTestId: row.uiTestId,
    apiTestId: row.apiTestId,
    testName: row.testName,
    browser: row.browser,
    module: row.module,
    component: row.component,
    priority: row.priority,
    severity: row.severity,
    verdict: row.verdict,
    differenceCount,
    baselineResultId: row.baselineResultId,
    candidateResultId: row.candidateResultId,
    baselineDurationMs: row.baselineDurationMs,
    candidateDurationMs: row.candidateDurationMs,
    reviewStatus: row.reviewStatus,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
  };
}

// POST /api/test-plans/:planId/comparisons { baselineEnvironmentId, candidateEnvironmentId, mode?, name?, policy? }
router.post(
  '/api/test-plans/:planId/comparisons',
  comparisonsLimit,
  requireRole('editor'),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = CreateComparisonSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    // A pipeline that retries after a timeout sends the same key and gets the same comparison.
    const idempotencyKey = req.get('Idempotency-Key')?.trim() || null;
    if (idempotencyKey && idempotencyKey.length > 255)
      return res.status(400).json({ error: 'Idempotency-Key must be at most 255 characters.' });

    const input = parsed.data;
    try {
      const { comparison, created } = await comparisonOrchestrator.create({
        planId: req.params.planId,
        requestedByUserId: req.user.id,
        input,
        idempotencyKey,
        onCreated: (tx, row) =>
          recordAudit(tx, {
            action: AUDIT_ACTIONS.COMPARISON_CREATED,
            actor: auditActor(req),
            targetType: 'comparison',
            targetId: row.id,
            metadata: {
              planId: row.testPlanId,
              baselineEnvironmentId: input.baselineEnvironmentId,
              candidateEnvironmentId: input.candidateEnvironmentId,
              mode: input.mode,
            },
          }),
      });
      res.status(202).json({ id: comparison.id, status: comparison.status, created });
    } catch (error) {
      if (error instanceof ComparisonError)
        return res.status(error.status).json({ error: error.message, code: error.code });
      // Refused before anything ran (a full queue, a suspended subscription): the caller is told.
      const status = (error as { status?: unknown } | null)?.status;
      if (typeof status === 'number' && status >= 400 && status < 500)
        return res.status(status).json({ error: (error as Error).message });
      logger.error({ message: 'Failed to start a comparison', error: String(error) });
      res.status(500).json({ error: 'Failed to start the comparison.' });
    }
  },
);

// GET /api/comparisons?planId=&status=&page=&pageSize=
router.get('/api/comparisons', comparisonsLimit, requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return invalid(res, parsed.error);
  const query = parsed.data;
  const conditions: SQL[] = [];
  if (query.planId) conditions.push(eq(comparisonRuns.testPlanId, query.planId));
  if (query.status) conditions.push(eq(comparisonRuns.status, query.status));
  const where = conditions.length ? and(...conditions) : undefined;
  const { rows, total } = await withTenantTransaction(async (tx) => {
    const found = await tx
      .select({ comparison: comparisonRuns, planName: testPlans.name })
      .from(comparisonRuns)
      .leftJoin(testPlans, eq(testPlans.id, comparisonRuns.testPlanId))
      .where(where)
      .orderBy(desc(comparisonRuns.createdAt), desc(comparisonRuns.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [{ value }] = await tx.select({ value: count() }).from(comparisonRuns).where(where);
    return { rows: found, total: value };
  });
  res.json({
    rows: rows.map((r) => view(r.comparison, r.planName)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  });
});

// GET /api/comparisons/:id — the comparison and the two runs.
router.get('/api/comparisons/:id', comparisonsLimit, requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  if (!ID_PATTERN.test(req.params.id)) return notFound(res);
  const found = await withTenantTransaction(async (tx) => {
    const row = await readComparison(tx, req.params.id);
    if (!row) return null;
    const ids = [row.comparison.baselineExecutionId, row.comparison.candidateExecutionId].filter(
      (id): id is string => Boolean(id),
    );
    const runs = ids.length
      ? await tx.select().from(testPlanExecutions).where(inArray(testPlanExecutions.id, ids))
      : [];
    return { ...row, runs };
  });
  if (!found) return notFound(res);
  const run = (id: string | null) => {
    const execution = id ? found.runs.find((r) => r.id === id) : undefined;
    return execution ? publicExecution(execution) : null;
  };
  res.json({
    ...view(found.comparison, found.planName),
    baselineRun: run(found.comparison.baselineExecutionId),
    candidateRun: run(found.comparison.candidateExecutionId),
  });
});

// GET /api/comparisons/:id/results?verdict=&module=&reviewStatus=&page=&pageSize=
router.get(
  '/api/comparisons/:id/results',
  comparisonsLimit,
  requireRole('viewer'),
  async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    if (!ID_PATTERN.test(req.params.id)) return notFound(res);
    const parsed = resultsQuery.safeParse(req.query);
    if (!parsed.success) return invalid(res, parsed.error);
    const query = parsed.data;
    const found = await withTenantTransaction(async (tx) => {
      const row = await readComparison(tx, req.params.id);
      if (!row) return null;
      const conditions: SQL[] = [eq(comparisonResults.comparisonRunId, req.params.id)];
      if (query.verdict) conditions.push(eq(comparisonResults.verdict, query.verdict));
      // '' is how the summary names tests without a module.
      if (query.module !== undefined)
        conditions.push(
          query.module === ''
            ? sql`coalesce(${comparisonResults.module}, '') = ''`
            : eq(comparisonResults.module, query.module),
        );
      if (query.reviewStatus)
        conditions.push(eq(comparisonResults.reviewStatus, query.reviewStatus));
      const where = and(...conditions);
      const rows = await tx
        .select({
          ...listColumns,
          differenceCount: sql<number>`jsonb_array_length(${comparisonResults.differences})`,
        })
        .from(comparisonResults)
        .where(where)
        .orderBy(
          asc(comparisonResults.module),
          asc(comparisonResults.testName),
          asc(comparisonResults.id),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const [{ value }] = await tx.select({ value: count() }).from(comparisonResults).where(where);
      return { rows, total: value };
    });
    if (!found) return notFound(res);
    res.json({
      rows: found.rows.map(({ differenceCount, ...result }) =>
        resultView(result, Number(differenceCount)),
      ),
      total: found.total,
      page: query.page,
      pageSize: query.pageSize,
    });
  },
);

// GET /api/comparisons/:id/results/:resultId — the differences and the steps of both sides.
router.get(
  '/api/comparisons/:id/results/:resultId',
  comparisonsLimit,
  requireRole('viewer'),
  async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const { id, resultId } = req.params;
    if (!ID_PATTERN.test(id) || !ID_PATTERN.test(resultId)) return notFound(res);
    const found = await withTenantTransaction(async (tx) => {
      const row = await readComparison(tx, id);
      if (!row) return null;
      const [result] = await tx
        .select()
        .from(comparisonResults)
        .where(and(eq(comparisonResults.id, resultId), eq(comparisonResults.comparisonRunId, id)))
        .limit(1);
      if (!result) return null;
      const resultIds = [result.baselineResultId, result.candidateResultId].filter(
        (r): r is string => Boolean(r),
      );
      const logs = resultIds.length
        ? await tx
            .select({
              id: reportTestCaseResults.id,
              detailedLog: reportTestCaseResults.detailedLog,
            })
            .from(reportTestCaseResults)
            .where(inArray(reportTestCaseResults.id, resultIds))
        : [];
      return {
        comparison: row.comparison,
        result,
        logs,
        access: await accessOf(tx, req, row.comparison),
      };
    });
    if (!found)
      return res.status(404).json({ error: 'Result not found.', code: 'result_not_found' });

    const { comparison, result, logs, access } = found;
    const hidden =
      (access.baseline?.hiddenResult(result) ?? false) ||
      (access.candidate?.hiddenResult(result) ?? false);
    const base = resultView(result, result.differences.length);
    if (hidden) return res.json({ ...base, hidden: true, differences: [], steps: null });

    const sideOf = (side: 'baseline' | 'candidate') => {
      const executionId =
        side === 'baseline' ? comparison.baselineExecutionId : comparison.candidateExecutionId;
      const sideAccess = access[side];
      const resultRow = side === 'baseline' ? result.baselineResultId : result.candidateResultId;
      const log = logs.find((l) => l.id === resultRow)?.detailedLog ?? null;
      const link = (stored: string) =>
        executionId && sideAccess ? artifactUrl(executionId, stored, sideAccess.linkable) : null;
      const steps =
        executionId && sideAccess && resultRow
          ? stepsOfLog(log).map((step) => stepView(step, executionId, sideAccess))
          : null;
      return { link, steps };
    };
    const baseline = sideOf('baseline');
    const candidate = sideOf('candidate');
    res.json({
      ...base,
      hidden: false,
      differences: result.differences.map((d) =>
        differenceView(d, { baseline: baseline.link, candidate: candidate.link }),
      ),
      steps: { baseline: baseline.steps, candidate: candidate.steps },
    });
  },
);

// POST /api/comparisons/:id/cancel — stops the comparison and both its runs.
router.post(
  '/api/comparisons/:id/cancel',
  comparisonsLimit,
  requireRole('editor'),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!ID_PATTERN.test(req.params.id)) return notFound(res);
    const who = (req.user as { username?: string }).username ?? `user ${req.user.id}`;
    const result = await comparisonOrchestrator.cancel(
      req.params.id,
      `Comparison cancelled by ${who}.`,
      (tx, comparison) =>
        recordAudit(tx, {
          action: AUDIT_ACTIONS.COMPARISON_CANCELLED,
          actor: auditActor(req),
          targetType: 'comparison',
          targetId: comparison.id,
          metadata: { planId: comparison.testPlanId },
        }),
    );
    switch (result.outcome) {
      case 'not_found':
        return notFound(res);
      case 'already_ended':
        return res.status(409).json({
          error: `The comparison has already ended (${result.status}).`,
          status: result.status,
        });
      case 'cancelled':
        return res.json({ status: 'cancelled', comparison: view(result.comparison) });
    }
  },
);

export default router;

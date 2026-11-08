import { asyncRouter } from '../../platform/middleware/async-router';
import { stepListOf } from '@shared/mobile';

import { and, eq, sql } from 'drizzle-orm';
import {
  artifactStore,
  assertSafeKey,
  BASELINES_PREFIX,
  RESULTS_PREFIX,
} from '../../tenancy/artifact-store';
import { AUDIT_ACTIONS, reportTestCaseResults, testPlanExecutions, tests } from '@shared/schema';
import { auditActor, recordAudit } from '../../tenancy/audit';
import type { AccessibilityFinding } from '@shared/accessibility';
import type { LighthouseFinding, PerformanceFinding } from '@shared/web-performance';
import type { DownloadFinding } from '@shared/downloads';
import { withTenantTransaction } from '../../platform/middleware/tenancy';
import { relativeArtifactPath, runArtifactAccess } from '../../tenancy/artifact-access';
import { requireRole } from '../middleware/require-role';
import { evidencePrincipalOf } from '../middleware/require-scope';
import logger from '../../platform/logger';
import { isUnitId } from '@shared/execution-identity';
import { listRunUnits, runUnitDetail } from '../../reporting/unit-evidence';
import { sessionRateLimit } from '../middleware/rate-limits';

/**
 * Serving what a run produced: screenshots, and the three images of a visual comparison.
 *
 * Nothing served these before. Report rows have carried a `screenshotUrl` of `/results/…`
 * since they existed, and no route or static mount ever answered on that path, so every
 * "View Screenshot" link in the report went nowhere. Visual testing makes that worse rather
 * than better — a diff nobody can open is a failure message without its evidence.
 *
 * A static mount over `results/` would have been one line and would have published every
 * tenant's screenshots to anyone who could guess a path. These files belong to an execution,
 * and an execution belongs to an organization, so that is what is checked: the lookup runs
 * inside the tenant context, and RLS makes another organization's run simply absent.
 *
 * The file comes from the artifact store (server/tenancy/artifact-store.ts): the local disk, or a bucket
 * every worker writes to, so a screenshot taken on another machine is served from here too.
 */

const router = asyncRouter();

/**
 * The URL that serves a stored artifact path, or null when the path is not one.
 *
 * Stored paths are what `path.join` produced on the machine that ran the test — Windows
 * separators included — and rows written before this route existed hold `/results/…` URLs
 * from the same directory. Both reduce to the part below the run's own directory.
 */
export function artifactUrl(
  executionId: string,
  storedPath: string | null | undefined,
  available: (relative: string) => boolean = () => true,
): string | null {
  if (!storedPath || typeof storedPath !== 'string') return null;
  if (storedPath.startsWith('data:image')) return storedPath;

  const relative = relativeArtifactPath(executionId, storedPath);
  if (!relative) return null;
  if (!available(relative)) return null;
  return `/api/test-plan-executions/${executionId}/artifacts/${relative
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

/** One step as the report shows it: the runner's own record, with openable images. */
export interface ReportStep {
  name: string;
  type: string;
  /** The test's own id for the step, and the group call it came from, when recorded. */
  stepId?: string;
  calledFrom?: string;
  selector?: string | null;
  status: 'passed' | 'failed';
  details: string;
  error?: string;
  healed?: boolean;
  rca?: string;
  screenshot?: string | null;
  evidenceUnavailable?: boolean;
  visual?: {
    outcome: string;
    detail: string;
    diffRatio?: number;
    baselineImage?: string | null;
    actualImage?: string | null;
    diffImage?: string | null;
    /** A diff whose image this report can approve as the new baseline (R-1). */
    approvable?: boolean;
    approval?: { userId: number; username: string; at: string };
  };
  accessibility?: AccessibilityFinding;
  performance?: PerformanceFinding;
  lighthouse?: LighthouseFinding;
  download?: DownloadFinding;
}

/**
 * The steps stored on a result row, with every image turned into something a browser can open.
 *
 * `detailed_log` is the runner's step list as JSON text. It was written for every UI test and
 * displayed nowhere: the report's per-test button has always been a placeholder, so the only
 * way to see which step failed was the reason string on the row.
 */
export function stepsWithArtifactUrls(
  executionId: string,
  detailedLog: string | null | undefined,
  available: (relative: string) => boolean = () => true,
): ReportStep[] {
  if (!detailedLog) return [];
  let parsed: unknown;
  try {
    parsed = stepListOf(JSON.parse(detailedLog));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((step): step is Record<string, any> => !!step && typeof step === 'object')
    .map((step) => ({
      name: String(step.name ?? 'Unnamed step'),
      type: String(step.type ?? 'unknown'),
      stepId: typeof step.stepId === 'string' ? step.stepId : undefined,
      calledFrom: typeof step.calledFrom === 'string' ? step.calledFrom : undefined,
      selector: typeof step.selector === 'string' ? step.selector : null,
      status: step.status === 'failed' ? 'failed' : 'passed',
      details: String(step.details ?? ''),
      error: step.error ? String(step.error) : undefined,
      healed: step.healed === true,
      rca: step.rca ? String(step.rca) : undefined,
      screenshot: artifactUrl(executionId, step.screenshot, available),
      evidenceUnavailable: [
        step.screenshot,
        step.visual?.baselineImage,
        step.visual?.actualImage,
        step.visual?.diffImage,
        step.lighthouse?.reportUrl,
        step.download?.fileUrl,
      ].some(
        (value) => !!artifactUrl(executionId, value) && !artifactUrl(executionId, value, available),
      ),
      visual: step.visual
        ? {
            outcome: String(step.visual.outcome ?? 'skipped'),
            detail: String(step.visual.detail ?? ''),
            diffRatio:
              typeof step.visual.diffRatio === 'number' ? step.visual.diffRatio : undefined,
            baselineImage: artifactUrl(executionId, step.visual.baselineImage, available),
            actualImage: artifactUrl(executionId, step.visual.actualImage, available),
            diffImage: artifactUrl(executionId, step.visual.diffImage, available),
            approvable:
              step.visual.outcome === 'diff' &&
              typeof step.visual.baselineKey === 'string' &&
              !!artifactUrl(executionId, step.visual.actualImage, available) &&
              !step.visual.approval,
            approval:
              step.visual.approval && typeof step.visual.approval.at === 'string'
                ? {
                    userId: Number(step.visual.approval.userId),
                    username: String(step.visual.approval.username ?? ''),
                    at: step.visual.approval.at,
                  }
                : undefined,
          }
        : undefined,
      // Selectors and rule names, no images: passed through as the runner wrote it.
      accessibility:
        step.accessibility && Array.isArray(step.accessibility.violations)
          ? (step.accessibility as AccessibilityFinding)
          : undefined,
      // Numbers, and the Lighthouse report as a link like any other file of the run.
      performance:
        step.performance && step.performance.metrics
          ? (step.performance as PerformanceFinding)
          : undefined,
      lighthouse:
        step.lighthouse && step.lighthouse.scores
          ? {
              ...(step.lighthouse as LighthouseFinding),
              reportUrl:
                artifactUrl(executionId, step.lighthouse.reportUrl, available) ?? undefined,
            }
          : undefined,
      download:
        step.download && typeof step.download.name === 'string'
          ? {
              ...(step.download as DownloadFinding),
              fileUrl: artifactUrl(executionId, step.download.fileUrl, available) ?? undefined,
            }
          : undefined,
    }));
}

// GET /api/test-plan-executions/:executionId/artifacts/<path below the run directory>
router.get(
  '/api/test-plan-executions/:executionId/artifacts/*',
  requireRole('viewer'),
  async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });

    const { executionId } = req.params;
    const requestedPath = decodeURIComponent((req.params as Record<string, string>)[0] ?? '');

    // No organization predicate: RLS supplies it, so another tenant's execution is not found
    // rather than forbidden — the id itself tells the caller nothing.
    const found = await withTenantTransaction(async (tx) => {
      const [execution] = await tx
        .select({ testPlanId: testPlanExecutions.testPlanId })
        .from(testPlanExecutions)
        .where(eq(testPlanExecutions.id, executionId))
        .limit(1);
      if (!execution) return null;
      const access = await runArtifactAccess(tx, {
        organizationId: req.user!.organizationId,
        executionId,
        principal: evidencePrincipalOf(req),
      });
      return { execution, access };
    });
    if (!found) {
      return res.status(404).json({ error: 'Test plan execution not found.' });
    }

    // The key is the run's own directory and the path below it. The check is what decides that a
    // request for ../../../.env is not a screenshot, whichever store would be asked for it.
    const relative = requestedPath.replace(/\\/g, '/');
    let key: string;
    try {
      key = assertSafeKey(
        `${RESULTS_PREFIX}${found.execution.testPlanId}/${executionId}/${relative}`,
      );
    } catch {
      logger.warn({
        message: 'Rejected an artifact path outside its run directory',
        executionId,
        requestedPath,
      });
      return res.status(400).json({ error: 'Invalid artifact path.' });
    }

    // Decided before the store is asked: a refusal says nothing about whether the file exists.
    const decision = found.access.decide(relative);
    if (!decision.allowed) {
      if (decision.reason === 'hidden')
        return res.status(404).json({ error: 'Artifact not found.' });
      logger.info({
        message: 'Refused raw run evidence to a caller without the permission',
        executionId,
        kind: decision.classification.kind,
        reason: decision.reason,
        userId: req.user?.id,
      });
      return res.status(403).json({
        error: 'Forbidden',
        code: decision.reason,
        message: 'Traces, HAR files and unrecognised run files need the editor role.',
      });
    }

    let artifact;
    try {
      artifact = await artifactStore().open(key);
    } catch (error: any) {
      logger.error({
        message: 'The artifact store could not be read',
        executionId,
        key,
        error: error?.message,
      });
      return res.status(502).json({ error: 'The artifact store could not be reached.' });
    }
    if (!artifact) return res.status(404).json({ error: 'Artifact not found.' });

    // These are immutable once written: a run's screenshots are never rewritten, and the report
    // is read far more often than it is produced.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Type', artifact.contentType);
    // An HTML artifact (a Lighthouse report) runs its own inline scripts. Sandboxed without
    // allow-same-origin it gets an opaque origin: it cannot read this application's cookies or call
    // its API, whatever the audited page put into it.
    if (/^text\/html/i.test(artifact.contentType)) {
      res.setHeader(
        'Content-Security-Policy',
        "sandbox allow-scripts allow-popups; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:",
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    if (artifact.size !== undefined) res.setHeader('Content-Length', String(artifact.size));
    artifact.stream.on('error', (error) => {
      logger.error({ message: 'Artifact stream failed', executionId, key, error: error.message });
      res.destroy(error);
    });
    artifact.stream.pipe(res);
  },
);

// POST /api/test-plan-executions/:executionId/results/:resultId/steps/:stepIndex/visual/approve
// Accepts the failed run's image as the step's new baseline (R-1). The editor role, and the
// project's own access when it is restricted; the next run compares against this image.
const approveLimit = sessionRateLimit();

/** A stored step, as far as an approval reads and writes it. */
interface StoredStep {
  visual?: {
    outcome?: string;
    baselineKey?: unknown;
    actualImage?: unknown;
    diffRatio?: unknown;
    approval?: { userId: number; username: string; at: string };
  };
}
router.post(
  '/api/test-plan-executions/:executionId/results/:resultId/steps/:stepIndex/visual/approve',
  approveLimit,
  requireRole('editor'),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { executionId, resultId } = req.params;
    const stepIndex = Number(req.params.stepIndex);
    if (!Number.isInteger(stepIndex) || stepIndex < 0) {
      return res.status(400).json({ error: 'Invalid step.', code: 'invalid_step' });
    }
    const organizationId = req.user.organizationId;

    try {
      const checked = await withTenantTransaction(async (tx) => {
        // RLS answers for another organization's run: absent, not forbidden.
        const [row] = await tx
          .select({
            id: reportTestCaseResults.id,
            detailedLog: reportTestCaseResults.detailedLog,
            testPlanId: testPlanExecutions.testPlanId,
            testId: reportTestCaseResults.uiTestId,
            projectId: tests.projectId,
            editable: sql<boolean>`app_project_editable(${tests.projectId})`,
          })
          .from(reportTestCaseResults)
          .innerJoin(
            testPlanExecutions,
            eq(testPlanExecutions.id, reportTestCaseResults.testPlanExecutionId),
          )
          .leftJoin(tests, eq(tests.id, reportTestCaseResults.uiTestId))
          .where(
            and(
              eq(reportTestCaseResults.id, resultId),
              eq(reportTestCaseResults.testPlanExecutionId, executionId),
            ),
          )
          .limit(1);
        if (!row) return { status: 404, code: 'result_not_found' } as const;
        // A test without a project (or one since deleted) has no project to restrict.
        if (row.projectId !== null && !row.editable) {
          return { status: 403, code: 'project_read_only' } as const;
        }

        let steps: StoredStep[];
        try {
          const parsed = stepListOf(JSON.parse(row.detailedLog ?? '[]'));
          steps = (Array.isArray(parsed) ? parsed : []).filter(
            (step): step is StoredStep => !!step && typeof step === 'object',
          );
        } catch {
          return { status: 404, code: 'step_not_found' } as const;
        }
        const visual = steps[stepIndex]?.visual;
        if (!visual) return { status: 404, code: 'step_not_found' } as const;
        if (visual.outcome !== 'diff' || typeof visual.baselineKey !== 'string') {
          return { status: 409, code: 'not_a_visual_diff' } as const;
        }
        if (visual.approval) return { status: 409, code: 'already_approved' } as const;

        // The baseline must be this organization's own: never trust a key stored in a row alone.
        let baselineKey: string;
        let actualKey: string;
        try {
          baselineKey = assertSafeKey(visual.baselineKey);
          if (!baselineKey.startsWith(`${BASELINES_PREFIX}org_${organizationId}/`)) {
            return { status: 409, code: 'not_a_visual_diff' } as const;
          }
          const relative = relativeArtifactPath(
            executionId,
            typeof visual.actualImage === 'string' ? visual.actualImage : null,
          );
          if (!relative) return { status: 409, code: 'image_unavailable' } as const;
          actualKey = assertSafeKey(
            `${RESULTS_PREFIX}${row.testPlanId}/${executionId}/${relative}`,
          );
        } catch {
          return { status: 409, code: 'image_unavailable' } as const;
        }

        return {
          status: 200,
          baselineKey,
          actualKey,
          testId: row.testId,
          diffRatio: typeof visual.diffRatio === 'number' ? visual.diffRatio : null,
        } as const;
      });

      if (checked.status !== 200) {
        return res.status(checked.status).json({ error: checked.code, code: checked.code });
      }

      // Outside the transaction: a metered store opens its own to count the bytes it keeps.
      const store = artifactStore();
      const image = await store.read(checked.actualKey);
      if (!image)
        return res.status(409).json({ error: 'image_unavailable', code: 'image_unavailable' });
      await store.write(checked.baselineKey, image, 'image/png');

      const actor = auditActor(req);
      const approval = { userId: actor.id, username: actor.username, at: new Date().toISOString() };
      const recorded = await withTenantTransaction(async (tx) => {
        const [current] = await tx
          .select({ detailedLog: reportTestCaseResults.detailedLog })
          .from(reportTestCaseResults)
          .where(eq(reportTestCaseResults.id, resultId))
          .for('update');
        const steps = stepListOf(JSON.parse(current?.detailedLog ?? '[]')) as StoredStep[];
        const visual = steps[stepIndex]?.visual;
        if (!visual) return false;
        visual.approval = approval;
        await tx
          .update(reportTestCaseResults)
          .set({ detailedLog: JSON.stringify(steps) })
          .where(eq(reportTestCaseResults.id, resultId));
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.VISUAL_BASELINE_APPROVED,
          actor,
          targetType: 'test_plan_execution',
          targetId: executionId,
          metadata: {
            resultId,
            testId: checked.testId,
            stepIndex,
            baselineKey: checked.baselineKey,
            diffRatio: checked.diffRatio,
          },
        });
        return true;
      });
      if (!recorded)
        return res.status(404).json({ error: 'step_not_found', code: 'step_not_found' });
      res.json({ approval });
    } catch (error) {
      logger.error({
        message: 'Failed to approve a visual baseline',
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Failed to approve the baseline.' });
    }
  },
);

// The drill-down reads a run's manifest and attempts on every call: bounded per user, like every
// session route, and said here so the limit travels with the route.
const unitsLimit = sessionRateLimit();

// GET /api/test-plan-executions/:executionId/units — the run's units, in plan order (P08).
router.get(
  '/api/test-plan-executions/:executionId/units',
  unitsLimit,
  requireRole('viewer'),
  async (req, res) => {
    const units = await listRunUnits(req.params.executionId, evidencePrincipalOf(req));
    if (!units) return res.status(404).json({ error: 'Test plan execution not found.' });
    res.json({ items: units });
  },
);

// GET /api/test-plan-executions/:executionId/units/:unitId — every attempt and dataset row of
// one unit, with the evidence of each that this caller may open (server/reporting/unit-evidence.ts).
router.get(
  '/api/test-plan-executions/:executionId/units/:unitId',
  unitsLimit,
  requireRole('viewer'),
  async (req, res) => {
    const { executionId, unitId } = req.params;
    const detail = isUnitId(unitId)
      ? await runUnitDetail(executionId, unitId, evidencePrincipalOf(req), 'session')
      : null;
    if (!detail) return res.status(404).json({ error: 'Unit not found.' });
    res.json(detail);
  },
);

export default router;

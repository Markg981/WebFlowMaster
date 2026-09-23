import { Router } from "express";
import { eq } from "drizzle-orm";
import { artifactStore, assertSafeKey, RESULTS_PREFIX } from "../artifact-store";
import { testPlanExecutions } from "@shared/schema";
import type { AccessibilityFinding } from "@shared/accessibility";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import loggerPromise from "../logger";

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
 * The file comes from the artifact store (server/artifact-store.ts): the local disk, or a bucket
 * every worker writes to, so a screenshot taken on another machine is served from here too.
 */

const router = Router();
const logger = await loggerPromise;

/**
 * The URL that serves a stored artifact path, or null when the path is not one.
 *
 * Stored paths are what `path.join` produced on the machine that ran the test — Windows
 * separators included — and rows written before this route existed hold `/results/…` URLs
 * from the same directory. Both reduce to the part below the run's own directory.
 */
export function artifactUrl(executionId: string, storedPath: string | null | undefined): string | null {
  if (!storedPath || typeof storedPath !== 'string') return null;
  if (storedPath.startsWith('data:image')) return storedPath;

  const normalized = storedPath.replace(/\\/g, '/');
  const marker = `/${executionId}/`;
  const index = normalized.indexOf(marker);
  if (index === -1) return null;

  const relative = normalized.slice(index + marker.length);
  if (!relative || relative.includes('..')) return null;
  return `/api/test-plan-executions/${executionId}/artifacts/${relative
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

/** One step as the report shows it: the runner's own record, with openable images. */
export interface ReportStep {
  name: string;
  type: string;
  status: 'passed' | 'failed';
  details: string;
  error?: string;
  healed?: boolean;
  rca?: string;
  screenshot?: string | null;
  visual?: {
    outcome: string;
    detail: string;
    diffRatio?: number;
    baselineImage?: string | null;
    actualImage?: string | null;
    diffImage?: string | null;
  };
  accessibility?: AccessibilityFinding;
}

/**
 * The steps stored on a result row, with every image turned into something a browser can open.
 *
 * `detailed_log` is the runner's step list as JSON text. It was written for every UI test and
 * displayed nowhere: the report's per-test button has always been a placeholder, so the only
 * way to see which step failed was the reason string on the row.
 */
export function stepsWithArtifactUrls(executionId: string, detailedLog: string | null | undefined): ReportStep[] {
  if (!detailedLog) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(detailedLog);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((step): step is Record<string, any> => !!step && typeof step === 'object')
    .map((step) => ({
      name: String(step.name ?? 'Unnamed step'),
      type: String(step.type ?? 'unknown'),
      status: step.status === 'failed' ? 'failed' : 'passed',
      details: String(step.details ?? ''),
      error: step.error ? String(step.error) : undefined,
      healed: step.healed === true,
      rca: step.rca ? String(step.rca) : undefined,
      screenshot: artifactUrl(executionId, step.screenshot),
      visual: step.visual
        ? {
            outcome: String(step.visual.outcome ?? 'skipped'),
            detail: String(step.visual.detail ?? ''),
            diffRatio: typeof step.visual.diffRatio === 'number' ? step.visual.diffRatio : undefined,
            baselineImage: artifactUrl(executionId, step.visual.baselineImage),
            actualImage: artifactUrl(executionId, step.visual.actualImage),
            diffImage: artifactUrl(executionId, step.visual.diffImage),
          }
        : undefined,
      // Selectors and rule names, no images: passed through as the runner wrote it.
      accessibility: step.accessibility && Array.isArray(step.accessibility.violations) ? (step.accessibility as AccessibilityFinding) : undefined,
    }));
}

// GET /api/test-plan-executions/:executionId/artifacts/<path below the run directory>
router.get("/api/test-plan-executions/:executionId/artifacts/*", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const { executionId } = req.params;
  const requestedPath = decodeURIComponent((req.params as Record<string, string>)[0] ?? '');

  // No organization predicate: RLS supplies it, so another tenant's execution is not found
  // rather than forbidden — the id itself tells the caller nothing.
  const execution = await withTenantTransaction((tx) =>
    tx
      .select({ testPlanId: testPlanExecutions.testPlanId })
      .from(testPlanExecutions)
      .where(eq(testPlanExecutions.id, executionId))
      .limit(1),
  );
  if (execution.length === 0) {
    return res.status(404).json({ error: "Test plan execution not found." });
  }

  // The key is the run's own directory and the path below it. The check is what decides that a
  // request for ../../../.env is not a screenshot, whichever store would be asked for it.
  let key: string;
  try {
    key = assertSafeKey(`${RESULTS_PREFIX}${execution[0].testPlanId}/${executionId}/${requestedPath.replace(/\\/g, '/')}`);
  } catch {
    logger.warn({ message: "Rejected an artifact path outside its run directory", executionId, requestedPath });
    return res.status(400).json({ error: "Invalid artifact path." });
  }

  let artifact;
  try {
    artifact = await artifactStore().open(key);
  } catch (error: any) {
    logger.error({ message: "The artifact store could not be read", executionId, key, error: error?.message });
    return res.status(502).json({ error: "The artifact store could not be reached." });
  }
  if (!artifact) return res.status(404).json({ error: "Artifact not found." });

  // These are immutable once written: a run's screenshots are never rewritten, and the report
  // is read far more often than it is produced.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Type', artifact.contentType);
  if (artifact.size !== undefined) res.setHeader('Content-Length', String(artifact.size));
  artifact.stream.on('error', (error) => {
    logger.error({ message: "Artifact stream failed", executionId, key, error: error.message });
    res.destroy(error);
  });
  artifact.stream.pipe(res);
});

export default router;

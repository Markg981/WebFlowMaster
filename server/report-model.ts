import { asc, eq } from 'drizzle-orm';
import { reportTestCaseResults, testPlanExecutions, testPlans } from '@shared/schema';
import type { AccessibilityFinding } from '@shared/accessibility';
import type { NetworkSummary } from '@shared/network';
import type { CiContext } from '@shared/ci';
import { withTenantTransaction } from './middleware/tenancy';
import { artifactStore, assertSafeKey, contentTypeFor, RESULTS_PREFIX } from './artifact-store';

/**
 * A run as the exported reports describe it: HTML, PDF and Allure all read this one shape.
 *
 * The report page is live, behind a login, and gone for anyone outside the organization. A run
 * is also something people hand on: attached to a release ticket, sent to a supplier whose API
 * failed, filed for an audit, loaded into the Allure server a QA team already uses. Those readers
 * get a file. Three files that agreed on nothing would be three reports, so they share this.
 */

export interface ReportStepModel {
  name: string;
  type: string;
  status: 'passed' | 'failed';
  message: string;
  accessibility?: AccessibilityFinding;
}

export interface ReportResultModel {
  id: string;
  testName: string;
  testType: string;
  browser: string | null;
  status: string;
  attempts: number;
  quarantined: boolean;
  reason: string | null;
  testVersion: number | null;
  module: string | null;
  component: string | null;
  priority: string | null;
  severity: string | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  steps: ReportStepModel[];
  network: NetworkSummary | null;
  /** The stored path of the result's screenshot, for an export that embeds it. */
  screenshotPath: string | null;
}

export interface ReportModel {
  executionId: string;
  planId: string;
  planName: string;
  status: string;
  trigger: string;
  environment: string | null;
  runner: string | null;
  attempt: number;
  maxAttempts: number;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  failureMessage: string | null;
  evidencePurged: boolean;
  /** The build that asked for the run, when a pipeline did. */
  ci: CiContext | null;
  counts: { total: number; passed: number; failed: number; errors: number; skipped: number; quarantinedFailures: number; flaky: number };
  results: ReportResultModel[];
}

function stepsOf(detailedLog: string | null): ReportStepModel[] {
  if (!detailedLog) return [];
  try {
    const parsed = JSON.parse(detailedLog);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((step): step is Record<string, any> => !!step && typeof step === 'object')
      .map((step) => ({
        name: String(step.name ?? 'Unnamed step'),
        type: String(step.type ?? 'unknown'),
        status: step.status === 'failed' ? 'failed' : 'passed',
        message: String(step.error || step.details || ''),
        accessibility: step.accessibility && Array.isArray(step.accessibility.violations) ? step.accessibility : undefined,
      }));
  } catch {
    return [];
  }
}

/** The run, or null when there is no such run in the caller's organization (RLS decides). */
export async function loadReportModel(executionId: string): Promise<ReportModel | null> {
  const source = await withTenantTransaction(async (tx) => {
    const [row] = await tx
      .select({ execution: testPlanExecutions, planName: testPlans.name })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlans.id, testPlanExecutions.testPlanId))
      .where(eq(testPlanExecutions.id, executionId))
      .limit(1);
    if (!row) return null;
    const results = await tx
      .select()
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, executionId))
      .orderBy(asc(reportTestCaseResults.startedAt));
    return { ...row, results };
  });
  if (!source) return null;

  const { execution, planName, results } = source;
  const count = (status: string) => results.filter((r) => r.status === status).length;
  return {
    executionId: execution.id,
    planId: execution.testPlanId,
    planName: planName ?? execution.testPlanId,
    status: execution.status,
    trigger: execution.triggeredBy,
    environment: execution.environment ?? null,
    runner: execution.runnerId ?? null,
    attempt: execution.attempt,
    maxAttempts: execution.maxAttempts,
    queuedAt: execution.queuedAt,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    durationMs: execution.executionDurationMs,
    failureMessage: execution.failureMessage,
    evidencePurged: !!execution.artifactsPurgedAt,
    ci: execution.ciContext ?? null,
    counts: {
      total: results.length,
      passed: count('Passed'),
      failed: count('Failed'),
      errors: count('Error'),
      skipped: count('Skipped') + count('Pending'),
      quarantinedFailures: results.filter((r) => r.quarantined && (r.status === 'Failed' || r.status === 'Error')).length,
      flaky: results.filter((r) => r.status === 'Passed' && (r.attempts ?? 1) > 1).length,
    },
    results: results.map((r) => ({
      id: r.id,
      testName: r.testName,
      testType: r.testType,
      browser: r.browser,
      status: r.status,
      attempts: r.attempts ?? 1,
      quarantined: r.quarantined === true,
      reason: r.reasonForFailure,
      testVersion: r.testVersion,
      module: r.module,
      component: r.component,
      priority: r.priority,
      severity: r.severity,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      durationMs: r.durationMs,
      steps: stepsOf(r.detailedLog),
      network: (r.networkSummary as NetworkSummary | null) ?? null,
      screenshotPath: execution.artifactsPurgedAt ? null : r.screenshotUrl,
    })),
  };
}

/** Largest image an export embeds; a bigger one is left out rather than bloating the file. */
export const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Reads a result's screenshot out of the artifact store, or null.
 *
 * Stored paths are what the runner's filesystem produced, relative to the run's directory once
 * the part up to the execution id is cut off — the same reading the artifacts route does.
 */
export async function readScreenshot(model: Pick<ReportModel, 'planId' | 'executionId'>, storedPath: string | null): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!storedPath || storedPath.startsWith('data:')) return null;
  const normalized = storedPath.replace(/\\/g, '/');
  const marker = `/${model.executionId}/`;
  const index = normalized.indexOf(marker);
  if (index === -1) return null;
  try {
    const key = assertSafeKey(`${RESULTS_PREFIX}${model.planId}/${model.executionId}/${normalized.slice(index + marker.length)}`);
    const bytes = await artifactStore().read(key);
    if (!bytes || bytes.length > MAX_EMBEDDED_IMAGE_BYTES) return null;
    return { bytes, contentType: contentTypeFor(key) };
  } catch {
    return null;
  }
}

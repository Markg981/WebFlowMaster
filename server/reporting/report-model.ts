import { stepListOf } from '@shared/mobile';
import { readMatrixEvidence, type MatrixEvidence } from '@shared/matrix-evidence';
import { asc, eq } from 'drizzle-orm';
import { reportTestCaseResults, testPlanExecutions, testPlans } from '@shared/schema';
import type { AccessibilityFinding } from '@shared/accessibility';
import type { NetworkSummary } from '@shared/network';
import type { CiContext } from '@shared/ci';
import type { ReproducibilitySummary } from '@shared/execution-provenance';
import { reproducibilitySummary } from '../execution/execution-provenance';
import { readExecutionSnapshot } from '../execution/execution-snapshot';
import { readAttempts } from '../execution/execution-units';
import { withTenantTransaction } from '../platform/middleware/tenancy';
import {
  artifactStore,
  assertSafeKey,
  contentTypeFor,
  RESULTS_PREFIX,
} from '../tenancy/artifact-store';
import {
  classifyArtifact,
  relativeArtifactPath,
  runArtifactAccess,
  type RunArtifactAccess,
} from '../tenancy/artifact-access';

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
  /**
   * Why the step's visual comparison could not run, when that is what stopped it: the step was
   * not verified, which is not the application failing (server/web/playwright/visual-verdict.ts).
   */
  visualError?: string;
}

export interface ReportResultModel {
  matrixEvidence?: MatrixEvidence[];
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
  /**
   * Every try at the result's unit, and the dataset rows of each, when the run kept a manifest
   * (P08). Part of this one result: an export shows them under it and never counts them as tests.
   */
  unitAttempts: ReportAttemptModel[];
}

export interface ReportAttemptModel {
  attempt: number;
  status: string | null;
  reason: string | null;
  /** The attempt the result stands on. */
  deciding: boolean;
  rows: Array<{ datasetRow: number; status: string; error: string | null }>;
}

export interface ReportModel {
  reproducibility?: ReproducibilitySummary;
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
  evidenceStorageStatus?: 'quota_exceeded' | 'error' | null;
  /** The build that asked for the run, when a pipeline did. */
  ci: CiContext | null;
  counts: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
    quarantinedFailures: number;
    flaky: number;
  };
  results: ReportResultModel[];
}

function stepsOf(detailedLog: string | null): ReportStepModel[] {
  if (!detailedLog) return [];
  try {
    const parsed = stepListOf(JSON.parse(detailedLog));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((step): step is Record<string, any> => !!step && typeof step === 'object')
      .map((step) => ({
        name: String(step.name ?? 'Unnamed step'),
        type: String(step.type ?? 'unknown'),
        status: step.status === 'failed' ? 'failed' : 'passed',
        message: String(step.error || step.details || ''),
        accessibility:
          step.accessibility && Array.isArray(step.accessibility.violations)
            ? step.accessibility
            : undefined,
        ...(step.status === 'failed' && step.visual?.outcome === 'error'
          ? { visualError: String(step.visual.cause ?? 'comparison-failed') }
          : {}),
      }));
  } catch {
    return [];
  }
}

/** The screenshot the last failed step kept, when the runner recorded one. */
export function failedStepScreenshot(detailedLog: string | null): string | null {
  if (!detailedLog) return null;
  try {
    const parsed = stepListOf(JSON.parse(detailedLog));
    if (!Array.isArray(parsed)) return null;
    for (let i = parsed.length - 1; i >= 0; i -= 1) {
      const step = parsed[i];
      if (
        step &&
        step.status === 'failed' &&
        typeof step.screenshot === 'string' &&
        step.screenshot
      )
        return step.screenshot;
    }
  } catch {
    // Not a step list: no screenshot to offer.
  }
  return null;
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
    // No permission is needed for what an export embeds — screenshots only — but the caller's
    // visibility still is: a test of a restricted project they are not on keeps its picture.
    const access = await runArtifactAccess(tx, {
      organizationId: row.execution.organizationId,
      executionId,
      principal: null,
    });
    const attempts = await readAttempts(tx, executionId);
    return { ...row, results, access, attempts };
  });
  if (!source) return null;

  const { execution, planName, results, access, attempts } = source;
  const attemptsOf = (r: (typeof results)[number]): ReportAttemptModel[] =>
    (r.executionUnitId ? (attempts.get(r.executionUnitId) ?? []) : []).map((a) => ({
      attempt: a.attempt,
      status: a.status ?? null,
      reason: a.failureReason ?? null,
      deciding: a.attempt === r.unitAttempt,
      rows: (a.evidence?.rows ?? []).map((row) => ({
        datasetRow: row.datasetRow,
        status: row.status,
        error: row.error ?? null,
      })),
    }));
  const count = (status: string) => results.filter((r) => r.status === status).length;
  return {
    executionId: execution.id,
    planId: execution.testPlanId,
    planName:
      readExecutionSnapshot(execution.configurationSnapshot)?.plan.name ??
      planName ??
      execution.testPlanId,
    reproducibility: reproducibilitySummary(execution.configurationSnapshot),
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
    evidenceStorageStatus: execution.artifactStorageStatus,
    ci: execution.ciContext ?? null,
    counts: {
      total: results.length,
      passed: count('Passed'),
      failed: count('Failed'),
      errors: count('Error'),
      skipped: count('Skipped') + count('Pending'),
      quarantinedFailures: results.filter(
        (r) => r.quarantined && (r.status === 'Failed' || r.status === 'Error'),
      ).length,
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
      matrixEvidence: readMatrixEvidence(r.detailedLog),
      network: (r.networkSummary as NetworkSummary | null) ?? null,
      // The result's own screenshot, else the one its failed step kept: either way the picture of
      // where it broke, for the export that embeds it.
      screenshotPath: execution.artifactsPurgedAt
        ? null
        : embeddableScreenshot(
            execution.id,
            r.screenshotUrl ?? failedStepScreenshot(r.detailedLog),
            access,
          ),
      unitAttempts: attemptsOf(r),
    })),
  };
}

/**
 * The stored path when an export may embed it: a recognised screenshot of a test the caller can
 * see. A stored path that names a trace or anything unrecognised is not a picture, whatever the
 * column it sits in says, and is left out (server/tenancy/artifact-access.ts).
 */
function embeddableScreenshot(
  executionId: string,
  storedPath: string | null,
  access: RunArtifactAccess,
): string | null {
  const relative = relativeArtifactPath(executionId, storedPath);
  if (!relative) return null;
  if (classifyArtifact(relative).kind !== 'screenshot' || !access.linkable(relative)) return null;
  return storedPath;
}

/** Largest image an export embeds; a bigger one is left out rather than bloating the file. */
export const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Reads a result's screenshot out of the artifact store, or null.
 *
 * Stored paths are what the runner's filesystem produced, relative to the run's directory once
 * the part up to the execution id is cut off — the same reading the artifacts route does.
 */
export async function readScreenshot(
  model: Pick<ReportModel, 'planId' | 'executionId'>,
  storedPath: string | null,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const relative = relativeArtifactPath(model.executionId, storedPath);
  if (!relative || classifyArtifact(relative).kind !== 'screenshot') return null;
  try {
    const key = assertSafeKey(`${RESULTS_PREFIX}${model.planId}/${model.executionId}/${relative}`);
    const bytes = await artifactStore().read(key);
    if (!bytes || bytes.length > MAX_EMBEDDED_IMAGE_BYTES) return null;
    return { bytes, contentType: contentTypeFor(key) };
  } catch {
    return null;
  }
}

import { asc, eq, inArray } from 'drizzle-orm';
import {
  comparisonResults,
  comparisonRuns,
  testPlanExecutions,
  testPlans,
  users,
} from '@shared/schema';
import {
  comparisonPolicyOf,
  type ComparisonDifference,
  type ComparisonPolicy,
  type ComparisonResultVerdict,
  type ComparisonReviewStatus,
  type ComparisonStatus,
  type ComparisonSummary,
  type ComparisonVerdict,
} from '@shared/comparison';
import { withTenantTransaction } from '../../platform/middleware/tenancy';
import { runArtifactAccess, type EvidencePrincipal } from '../../tenancy/artifact-access';
import { chromiumPdf, type ExportedReport, type PdfRenderer } from '../report-export';
import { renderComparisonReportHtml } from './comparison-report-html';

/**
 * The parity report: a comparison as a file to hand on, for the record of a migration
 * (docs/superpowers/specs/2026-11-12-run-comparison-design.md). It says what was compared, with
 * which tolerances, what the verdict was, and who accepted each difference and why.
 *
 * It holds no screenshot, no link and no stored path: a visual difference keeps its ratio, not its
 * image. A test of a restricted project the caller is not on keeps its verdict and loses its
 * differences and its review note, as on the report page.
 */

export const COMPARISON_EXPORT_FORMATS = ['html', 'pdf'] as const;
export type ComparisonExportFormat = (typeof COMPARISON_EXPORT_FORMATS)[number];

export function isComparisonExportFormat(value: unknown): value is ComparisonExportFormat {
  return (
    typeof value === 'string' && (COMPARISON_EXPORT_FORMATS as readonly string[]).includes(value)
  );
}

/** The most results a report lists; a larger comparison says how many it left out. */
export const MAX_REPORT_RESULTS = 5000;
/** The most differences listed under one test; the rest are counted. */
export const MAX_REPORT_DIFFERENCES_PER_TEST = 25;

export interface ComparisonReportSide {
  environmentName: string;
  executionId: string | null;
  status: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface ComparisonReportResult {
  testName: string;
  testType: string | null;
  browser: string | null;
  module: string | null;
  component: string | null;
  verdict: ComparisonResultVerdict;
  reviewStatus: ComparisonReviewStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  baselineDurationMs: number | null;
  candidateDurationMs: number | null;
  /** True when the caller may not see this test's details. */
  hidden: boolean;
  differenceCount: number;
  /** At most MAX_REPORT_DIFFERENCES_PER_TEST, with no stored path in them. */
  differences: ComparisonDifference[];
}

export interface ComparisonReportModel {
  comparisonId: string;
  name: string | null;
  planId: string;
  planName: string | null;
  mode: string;
  status: ComparisonStatus;
  verdict: ComparisonVerdict | null;
  failureMessage: string | null;
  policy: ComparisonPolicy;
  summary: ComparisonSummary | null;
  requestedBy: string | null;
  createdAt: Date;
  completedAt: Date | null;
  baseline: ComparisonReportSide;
  candidate: ComparisonReportSide;
  results: ComparisonReportResult[];
  /** Results beyond MAX_REPORT_RESULTS, not listed. */
  omittedResults: number;
}

/** A visual difference names stored screenshots; the report keeps what was measured, not where. */
export function withoutStoredPaths(difference: ComparisonDifference): ComparisonDifference {
  if (difference.kind !== 'visual') return difference;
  const strip = (value: unknown) => {
    if (!value || typeof value !== 'object') return value;
    const {
      screenshot: _screenshot,
      diffScreenshot: _diff,
      ...rest
    } = value as Record<string, unknown>;
    return rest;
  };
  return {
    ...difference,
    baseline: strip(difference.baseline),
    candidate: strip(difference.candidate),
  };
}

/** The comparison as its report, or null when the caller's organization has no such comparison. */
export async function loadComparisonReportModel(
  comparisonId: string,
  principal: EvidencePrincipal | null,
): Promise<ComparisonReportModel | null> {
  return withTenantTransaction(async (tx) => {
    const [row] = await tx
      .select({ comparison: comparisonRuns, planName: testPlans.name, requestedBy: users.username })
      .from(comparisonRuns)
      .leftJoin(testPlans, eq(testPlans.id, comparisonRuns.testPlanId))
      .leftJoin(users, eq(users.id, comparisonRuns.requestedByUserId))
      .where(eq(comparisonRuns.id, comparisonId))
      .limit(1);
    if (!row) return null;
    const comparison = row.comparison;

    const executionIds = [comparison.baselineExecutionId, comparison.candidateExecutionId].filter(
      (id): id is string => Boolean(id),
    );
    const runs = executionIds.length
      ? await tx
          .select({
            id: testPlanExecutions.id,
            status: testPlanExecutions.status,
            startedAt: testPlanExecutions.startedAt,
            completedAt: testPlanExecutions.completedAt,
          })
          .from(testPlanExecutions)
          .where(inArray(testPlanExecutions.id, executionIds))
      : [];
    const side = (environmentName: string, executionId: string | null): ComparisonReportSide => {
      const run = runs.find((r) => r.id === executionId);
      return {
        environmentName,
        executionId,
        status: run?.status ?? null,
        startedAt: run?.startedAt ?? null,
        completedAt: run?.completedAt ?? null,
      };
    };
    const accessOf = (executionId: string | null) =>
      executionId
        ? runArtifactAccess(tx, {
            organizationId: comparison.organizationId,
            executionId,
            principal,
          })
        : Promise.resolve(null);
    const access = [
      await accessOf(comparison.baselineExecutionId),
      await accessOf(comparison.candidateExecutionId),
    ];

    const rows = await tx
      .select({ result: comparisonResults, reviewedBy: users.username })
      .from(comparisonResults)
      .leftJoin(users, eq(users.id, comparisonResults.reviewedByUserId))
      .where(eq(comparisonResults.comparisonRunId, comparisonId))
      .orderBy(
        asc(comparisonResults.module),
        asc(comparisonResults.testName),
        asc(comparisonResults.id),
      )
      .limit(MAX_REPORT_RESULTS + 1);
    const listed = rows.slice(0, MAX_REPORT_RESULTS);

    const results = listed.map(({ result, reviewedBy }): ComparisonReportResult => {
      const hidden = access.some((a) => a?.hiddenResult(result) ?? false);
      return {
        testName: result.testName ?? 'Unnamed test',
        testType: result.testType,
        browser: result.browser,
        module: result.module,
        component: result.component,
        verdict: result.verdict,
        reviewStatus: result.reviewStatus,
        reviewedBy: hidden ? null : reviewedBy,
        reviewedAt: result.reviewedAt,
        reviewNote: hidden ? null : result.reviewNote,
        baselineDurationMs: result.baselineDurationMs,
        candidateDurationMs: result.candidateDurationMs,
        hidden,
        differenceCount: result.differences.length,
        differences: hidden
          ? []
          : result.differences.slice(0, MAX_REPORT_DIFFERENCES_PER_TEST).map(withoutStoredPaths),
      };
    });

    let omittedResults = 0;
    if (rows.length > MAX_REPORT_RESULTS) {
      const total = comparison.summary?.total ?? rows.length;
      omittedResults = Math.max(total - MAX_REPORT_RESULTS, 1);
    }

    return {
      comparisonId: comparison.id,
      name: comparison.name,
      planId: comparison.testPlanId,
      planName: row.planName,
      mode: comparison.mode,
      status: comparison.status,
      verdict: comparison.verdict,
      failureMessage: comparison.failureMessage,
      policy: comparisonPolicyOf(comparison.policy),
      summary: comparison.summary,
      requestedBy: row.requestedBy,
      createdAt: comparison.createdAt,
      completedAt: comparison.completedAt,
      baseline: side(comparison.baselineEnvironmentName, comparison.baselineExecutionId),
      candidate: side(comparison.candidateEnvironmentName, comparison.candidateExecutionId),
      results,
      omittedResults,
    };
  });
}

function fileStem(model: ComparisonReportModel): string {
  const base =
    (model.name || model.planName || 'comparison')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .toLowerCase() || 'comparison';
  return `parity-${base}-${model.comparisonId.slice(0, 8)}`;
}

/** The comparison's parity report in the asked format, or null when there is no such comparison. */
export async function exportComparison(
  comparisonId: string,
  format: ComparisonExportFormat,
  principal: EvidencePrincipal | null,
  renderPdf: PdfRenderer = chromiumPdf,
): Promise<ExportedReport | null> {
  const model = await loadComparisonReportModel(comparisonId, principal);
  if (!model) return null;
  const html = renderComparisonReportHtml(model);
  const stem = fileStem(model);
  if (format === 'html')
    return {
      body: Buffer.from(html, 'utf8'),
      contentType: 'text/html; charset=utf-8',
      filename: `${stem}.html`,
    };
  return { body: await renderPdf(html), contentType: 'application/pdf', filename: `${stem}.pdf` };
}

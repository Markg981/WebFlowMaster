import { eq, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  apiTests,
  comparisonKnownDifferences,
  comparisonResults,
  executionUnits,
  reportTestCaseResults,
  tests,
  type ComparisonRun,
  type ReportTestCaseResult,
} from '@shared/schema';
import {
  comparisonPolicyOf,
  emptyVerdictCounts,
  MAX_DIFFERENCES_PER_TEST,
  type ComparisonDifference,
  type ComparisonPolicy,
  type ComparisonSummary,
} from '@shared/comparison';
import type { UnitCoordinates } from '@shared/execution-identity';
import type { TenantTx } from '../../platform/middleware/tenancy';
import type { ComparisonEngine } from '../../execution/comparison-orchestrator';
import { artifactStore, assertSafeKey, RESULTS_PREFIX } from '../../tenancy/artifact-store';
import { relativeArtifactPath } from '../../tenancy/artifact-access';
import { pairResults } from './pairing';
import { stepsOfLog } from './steps';
import { diffOutcome } from './diff-outcome';
import { diffText } from './diff-text';
import { diffTable } from './diff-table';
import { diffChart } from './diff-chart';
import { diffNetwork } from './diff-network';
import { diffPerformance } from './diff-performance';
import { diffVisual, type ScreenshotLoader } from './diff-visual';
import { markKnownDifferences, type KnownDifferenceScope } from './known-differences';
import { overallVerdict, testVerdict } from './verdict';

/** Rows inserted per statement: a large plan's results go in a few round trips, not one. */
const INSERT_CHUNK = 200;

type Side = 'baseline' | 'candidate';

/**
 * The screenshot loader of a stored run: a data URI is the image itself; a file path is read
 * from the artifact store under the run's own directory, as the artifact route reads it.
 */
export function storedScreenshotLoader(
  runs: Record<Side, { executionId: string; planId: string }>,
): ScreenshotLoader {
  return async (side, stored) => {
    if (stored.startsWith('data:image/png;base64,'))
      return Buffer.from(stored.slice('data:image/png;base64,'.length), 'base64');
    const run = runs[side];
    const relative = relativeArtifactPath(run.executionId, stored);
    if (!relative) return null;
    const key = assertSafeKey(`${RESULTS_PREFIX}${run.planId}/${run.executionId}/${relative}`);
    return artifactStore().read(key);
  };
}

export interface CompareRunsOptions {
  /** Where screenshots come from; tests pass their own. */
  loadScreenshot?: (comparison: ComparisonRun) => ScreenshotLoader;
}

async function resultsOf(tx: TenantTx, executionId: string) {
  return tx
    .select()
    .from(reportTestCaseResults)
    .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
}

async function coordinatesOf(tx: TenantTx, executionIds: string[]) {
  const rows = await tx
    .select({
      executionId: executionUnits.executionId,
      unitId: executionUnits.unitId,
      coordinates: executionUnits.coordinates,
    })
    .from(executionUnits)
    .where(inArray(executionUnits.executionId, executionIds));
  const byRun = new Map<string, Map<string, UnitCoordinates>>();
  for (const row of rows) {
    const units = byRun.get(row.executionId) ?? new Map<string, UnitCoordinates>();
    units.set(row.unitId, row.coordinates);
    byRun.set(row.executionId, units);
  }
  return (executionId: string) => (unitId: string) => byRun.get(executionId)?.get(unitId);
}

async function differencesOf(
  baseline: ReportTestCaseResult,
  candidate: ReportTestCaseResult,
  policy: ComparisonPolicy,
  load: ScreenshotLoader,
): Promise<ComparisonDifference[]> {
  const left = stepsOfLog(baseline.detailedLog);
  const right = stepsOfLog(candidate.detailedLog);
  return [
    ...diffOutcome(left, right),
    ...diffText(left, right, policy),
    ...diffTable(left, right, policy),
    ...diffChart(left, right, policy),
    ...diffNetwork(left, right, policy),
    ...(await diffVisual(left, right, policy, load)),
    ...diffPerformance(
      left,
      right,
      { baseline: baseline.durationMs ?? null, candidate: candidate.durationMs ?? null },
      policy,
    ),
  ];
}

/** The organization's known differences; expired ones are left to the matcher to skip. */
async function knownDifferencesOf(tx: TenantTx) {
  return tx
    .select({
      id: comparisonKnownDifferences.id,
      projectId: comparisonKnownDifferences.projectId,
      uiTestId: comparisonKnownDifferences.uiTestId,
      checkpointName: comparisonKnownDifferences.checkpointName,
      kind: comparisonKnownDifferences.kind,
      pathPattern: comparisonKnownDifferences.pathPattern,
      expiresAt: comparisonKnownDifferences.expiresAt,
    })
    .from(comparisonKnownDifferences);
}

/** The project of each compared test, so a known difference scoped to a project finds it. */
async function scopesOf(
  tx: TenantTx,
  results: ReportTestCaseResult[],
): Promise<(result: ReportTestCaseResult) => KnownDifferenceScope> {
  const uiIds = [...new Set(results.flatMap((r) => (r.uiTestId ? [r.uiTestId] : [])))];
  const apiIds = [...new Set(results.flatMap((r) => (r.apiTestId ? [r.apiTestId] : [])))];
  const [ui, api] = await Promise.all([
    uiIds.length > 0
      ? tx
          .select({ id: tests.id, projectId: tests.projectId })
          .from(tests)
          .where(inArray(tests.id, uiIds))
      : [],
    apiIds.length > 0
      ? tx
          .select({ id: apiTests.id, projectId: apiTests.projectId })
          .from(apiTests)
          .where(inArray(apiTests.id, apiIds))
      : [],
  ]);
  const uiProject = new Map(ui.map((row) => [row.id, row.projectId]));
  const apiProject = new Map(api.map((row) => [row.id, row.projectId]));
  return (result) => ({
    projectId: result.uiTestId
      ? (uiProject.get(result.uiTestId) ?? null)
      : result.apiTestId
        ? (apiProject.get(result.apiTestId) ?? null)
        : null,
    uiTestId: result.uiTestId ?? null,
  });
}

/**
 * The comparison engine: pairs the results of the two ended runs, compares each pair, and writes
 * one `comparison_results` row per pair in the caller's transaction — the one that completes the
 * comparison, so it is completed with all its results or has none.
 */
export function createCompareRuns(options: CompareRunsOptions = {}): ComparisonEngine {
  return async (tx, comparison) => {
    const baselineId = comparison.baselineExecutionId;
    const candidateId = comparison.candidateExecutionId;
    if (!baselineId || !candidateId) throw new Error('The comparison has lost one of its runs.');

    const policy = comparisonPolicyOf(comparison.policy);
    const load =
      options.loadScreenshot?.(comparison) ??
      storedScreenshotLoader({
        baseline: { executionId: baselineId, planId: comparison.testPlanId },
        candidate: { executionId: candidateId, planId: comparison.testPlanId },
      });

    const [baselineResults, candidateResults, coordinates] = await Promise.all([
      resultsOf(tx, baselineId),
      resultsOf(tx, candidateId),
      coordinatesOf(tx, [baselineId, candidateId]),
    ]);
    const [rules, scopeOf] = await Promise.all([
      knownDifferencesOf(tx),
      scopesOf(tx, [...baselineResults, ...candidateResults]),
    ]);
    const markKnown = markKnownDifferences(rules);
    const pairs = pairResults(
      baselineResults,
      candidateResults,
      coordinates(baselineId),
      coordinates(candidateId),
    );

    const summary: ComparisonSummary = {
      total: 0,
      byVerdict: emptyVerdictCounts(),
      byModule: [],
      droppedDifferences: 0,
    };
    const modules = new Map<string, ComparisonSummary['byModule'][number]>();
    const rows: Array<typeof comparisonResults.$inferInsert> = [];

    for (const pair of pairs) {
      const { baseline, candidate } = pair;
      const either = (baseline ?? candidate)!;
      const all =
        baseline && candidate
          ? markKnown(await differencesOf(baseline, candidate, policy, load), scopeOf(either))
          : [];
      const verdict = testVerdict(baseline?.status ?? null, candidate?.status ?? null, all);
      const kept = all.slice(0, MAX_DIFFERENCES_PER_TEST);
      summary.droppedDifferences += all.length - kept.length;

      const module = either.module ?? '';
      const area = modules.get(module) ?? { module, total: 0, byVerdict: emptyVerdictCounts() };
      area.total += 1;
      area.byVerdict[verdict] += 1;
      modules.set(module, area);
      summary.total += 1;
      summary.byVerdict[verdict] += 1;

      rows.push({
        id: uuidv4(),
        organizationId: comparison.organizationId,
        comparisonRunId: comparison.id,
        pairKey: pair.key,
        uiTestId: either.uiTestId,
        apiTestId: either.apiTestId,
        testType: either.testType,
        testName: either.testName,
        browser: either.browser,
        module: either.module,
        component: either.component,
        priority: either.priority,
        severity: either.severity,
        baselineResultId: baseline?.id ?? null,
        candidateResultId: candidate?.id ?? null,
        verdict,
        differences: kept,
        baselineDurationMs: baseline?.durationMs ?? null,
        candidateDurationMs: candidate?.durationMs ?? null,
      });
    }

    // A comparison whose earlier computation was taken over may have left rows behind only if
    // that transaction committed, which would have completed it too; clearing first keeps a
    // retried computation from colliding with its own earlier attempt all the same.
    await tx.delete(comparisonResults).where(eq(comparisonResults.comparisonRunId, comparison.id));
    for (let i = 0; i < rows.length; i += INSERT_CHUNK)
      await tx.insert(comparisonResults).values(rows.slice(i, i + INSERT_CHUNK));

    summary.byModule = [...modules.values()].sort((a, b) => a.module.localeCompare(b.module));
    return { verdict: overallVerdict(summary.byVerdict), summary };
  };
}

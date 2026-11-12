import { eq, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import {
  comparisonResults,
  executionUnits,
  reportTestCaseResults,
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
import { diffVisual, type ScreenshotLoader } from './diff-visual';
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
    ...(await diffVisual(left, right, policy, load)),
  ];
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
      const all =
        baseline && candidate ? await differencesOf(baseline, candidate, policy, load) : [];
      const verdict = testVerdict(baseline?.status ?? null, candidate?.status ?? null, all);
      const kept = all.slice(0, MAX_DIFFERENCES_PER_TEST);
      summary.droppedDifferences += all.length - kept.length;

      const either = (baseline ?? candidate)!;
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

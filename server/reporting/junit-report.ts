import { asc, eq } from 'drizzle-orm';
import { reportTestCaseResults, testPlanExecutions, testPlans } from '@shared/schema';
import { buildJUnitXml } from './junit';
import { withTenantTransaction } from '../platform/middleware/tenancy';
import { reproducibilitySummary } from '../execution/execution-provenance';
import { readExecutionSnapshot } from '../execution/execution-snapshot';
import { readMatrixEvidence } from '@shared/matrix-evidence';
import { readAttempts } from '../execution/execution-units';

/**
 * A run as JUnit XML, or null when there is no such run in the caller's organization.
 *
 * Shared by the route the application has always had and by /api/v1, so the two can never
 * describe the same run differently. No organization filter: RLS applies it, so another
 * tenant's run is simply absent.
 */
export async function junitReportFor(executionId: string): Promise<string | null> {
  const source = await withTenantTransaction(async (tx) => {
    const [execution] = await tx
      .select({
        id: testPlanExecutions.id,
        startedAt: testPlanExecutions.startedAt,
        status: testPlanExecutions.status,
        failureMessage: testPlanExecutions.failureMessage,
        planName: testPlans.name,
        testPlanId: testPlanExecutions.testPlanId,
        configurationSnapshot: testPlanExecutions.configurationSnapshot,
      })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
      .where(eq(testPlanExecutions.id, executionId))
      .limit(1);
    if (!execution) return null;

    const results = await tx
      .select()
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, executionId))
      .orderBy(asc(reportTestCaseResults.startedAt));
    return { execution, results, attempts: await readAttempts(tx, executionId) };
  });

  if (!source) return null;
  const reproducibility = reproducibilitySummary(source.execution.configurationSnapshot);
  // The tries and dataset rows behind each test case (P08), as a property: one testcase per
  // result, whatever it took to get there, so a re-run or a row never counts as a test of its own.
  const attempts = source.results
    .filter((r) => r.executionUnitId && source.attempts.has(r.executionUnitId))
    .map((r) => ({
      test: r.testName,
      browser: r.browser,
      attempts: source.attempts.get(r.executionUnitId!)!.map((a) => ({
        attempt: a.attempt,
        status: a.status,
        ...(a.evidence?.rows?.length
          ? { rows: a.evidence.rows.map((row) => ({ row: row.datasetRow, status: row.status })) }
          : {}),
      })),
    }))
    .filter((r) => r.attempts.length > 1 || r.attempts.some((a) => 'rows' in a));
  return buildJUnitXml({
    planName:
      readExecutionSnapshot(source.execution.configurationSnapshot)?.plan.name ??
      source.execution.planName ??
      source.execution.testPlanId,
    properties: {
      'wfm.reproducibility': JSON.stringify(reproducibility),
      'wfm.matrix': JSON.stringify(
        source.results.map((r) => ({
          test: r.testName,
          browser: r.browser,
          evidence: readMatrixEvidence(r.detailedLog),
        })),
      ),
      ...(attempts.length ? { 'wfm.attempts': JSON.stringify(attempts) } : {}),
    },
    executionId,
    startedAt: source.execution.startedAt,
    results: source.results,
    run: { status: source.execution.status, failureMessage: source.execution.failureMessage },
  });
}

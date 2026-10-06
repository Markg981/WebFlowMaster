import { asc, eq } from 'drizzle-orm';
import { reportTestCaseResults, testPlanExecutions, testPlans } from '@shared/schema';
import { buildJUnitXml } from './junit';
import { withTenantTransaction } from './middleware/tenancy';
import { reproducibilitySummary } from './execution-provenance';
import { readExecutionSnapshot } from './execution-snapshot';

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
    return { execution, results };
  });

  if (!source) return null;
  const reproducibility = reproducibilitySummary(source.execution.configurationSnapshot);
  return buildJUnitXml({
    planName: readExecutionSnapshot(source.execution.configurationSnapshot)?.plan.name ?? source.execution.planName ?? source.execution.testPlanId,
    properties: { 'wfm.reproducibility': JSON.stringify(reproducibility) },
    executionId,
    startedAt: source.execution.startedAt,
    results: source.results,
  });
}

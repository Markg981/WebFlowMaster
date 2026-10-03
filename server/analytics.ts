import { withTenantTransaction } from './middleware/tenancy';
import { testPlanExecutions, testPlans, projects, testPlanSchedules } from '@shared/schema';
import { eq, desc, asc, sql, gte, and } from 'drizzle-orm';
import type { DashboardWidget } from '@shared/dashboard-layout';

/** Plans and reports have tenant RLS, but their test references need project RLS as well.
 * Exclude mixed runs rather than expose a hidden project's status/duration in totals. */
export const visiblePlan = sql`NOT EXISTS (
  SELECT 1 FROM test_plan_selected_tests s WHERE s.test_plan_id = ${testPlans.id} AND (
    (s.test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tests t WHERE t.id = s.test_id)) OR
    (s.api_test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api_tests t WHERE t.id = s.api_test_id)) OR
    (s.mobile_test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = s.mobile_test_id))
  )
)`;
const snapshotTests = sql`jsonb_array_elements(case when jsonb_typeof(${testPlanExecutions.configurationSnapshot}->'selectedTests') = 'array' then ${testPlanExecutions.configurationSnapshot}->'selectedTests' else '[]'::jsonb end)`;
const visibleRun = sql`NOT EXISTS (
  SELECT 1 FROM report_test_case_results r WHERE r.test_plan_execution_id = ${testPlanExecutions.id} AND (
    (r.ui_test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tests t WHERE t.id = r.ui_test_id)) OR
    (r.api_test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api_tests t WHERE t.id = r.api_test_id)) OR
    (r.mobile_test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = r.mobile_test_id)) OR
    (r.ui_test_id IS NULL AND r.api_test_id IS NULL AND r.mobile_test_id IS NULL AND NOT app_principal_sees_everything())
  )
) AND NOT EXISTS (
  SELECT 1 FROM ${snapshotTests} reference WHERE
    (reference->>'testId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tests t WHERE t.id::text = reference->>'testId')) OR
    (reference->>'apiTestId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api_tests t WHERE t.id::text = reference->>'apiTestId')) OR
    (reference->>'mobileTestId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id::text = reference->>'mobileTestId')) OR
    (reference->>'testId' IS NULL AND reference->>'apiTestId' IS NULL AND reference->>'mobileTestId' IS NULL AND NOT app_principal_sees_everything())
)`;
function planProject(projectId: number) {
  return sql`EXISTS (SELECT 1 FROM test_plan_selected_tests s WHERE s.test_plan_id = ${testPlans.id} AND (
    EXISTS (SELECT 1 FROM tests t WHERE t.id = s.test_id AND t.project_id = ${projectId}) OR
    EXISTS (SELECT 1 FROM api_tests t WHERE t.id = s.api_test_id AND t.project_id = ${projectId}) OR
    EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = s.mobile_test_id AND t.project_id = ${projectId})
  ))`;
}
function runProject(projectId: number) {
  return sql`(EXISTS (SELECT 1 FROM report_test_case_results r WHERE r.test_plan_execution_id = ${testPlanExecutions.id} AND (
    EXISTS (SELECT 1 FROM tests t WHERE t.id = r.ui_test_id AND t.project_id = ${projectId}) OR
    EXISTS (SELECT 1 FROM api_tests t WHERE t.id = r.api_test_id AND t.project_id = ${projectId}) OR
    EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = r.mobile_test_id AND t.project_id = ${projectId})
  )) OR (NOT EXISTS (SELECT 1 FROM report_test_case_results r WHERE r.test_plan_execution_id = ${testPlanExecutions.id}) AND (
    CASE WHEN jsonb_typeof(${testPlanExecutions.configurationSnapshot}->'selectedTests') = 'array'
    THEN EXISTS (SELECT 1 FROM ${snapshotTests} reference WHERE
      EXISTS (SELECT 1 FROM tests t WHERE t.id::text = reference->>'testId' AND t.project_id = ${projectId}) OR
      EXISTS (SELECT 1 FROM api_tests t WHERE t.id::text = reference->>'apiTestId' AND t.project_id = ${projectId}) OR
      EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id::text = reference->>'mobileTestId' AND t.project_id = ${projectId})
    ) ELSE ${planProject(projectId)} END
  )))`;
}
export async function getDashboardMetrics(_userId: number, config: DashboardWidget['config'] = {}) {
  return withTenantTransaction(async tx => {
    if (config.projectId && !(await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, config.projectId)))[0]) return { unavailable: true };
    const days = config.days ?? 30;
    const since = new Date(); since.setUTCHours(0, 0, 0, 0); since.setUTCDate(since.getUTCDate() - days + 1);
    const conditions = [visiblePlan, visibleRun, gte(sql<Date>`coalesce(${testPlanExecutions.startedAt}, ${testPlanExecutions.queuedAt})`, since)];
    if (config.projectId) conditions.push(runProject(config.projectId));
    const [stats] = await tx.select({
      total: sql<number>`count(*)`, passed: sql<number>`count(*) filter (where ${testPlanExecutions.status} = 'completed')`,
      failed: sql<number>`count(*) filter (where ${testPlanExecutions.status} in ('failed', 'error'))`,
      avgDuration: sql<number>`coalesce(avg(${testPlanExecutions.executionDurationMs}), 0)`,
    }).from(testPlanExecutions).innerJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id)).where(and(...conditions));
    const trends = await tx.select({ date: sql<string>`to_char(${testPlanExecutions.startedAt}, 'YYYY-MM-DD')`,
      passed: sql<number>`count(*) filter (where ${testPlanExecutions.status} = 'completed')`, failed: sql<number>`count(*) filter (where ${testPlanExecutions.status} in ('failed', 'error'))`,
    }).from(testPlanExecutions).innerJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id)).where(and(...conditions)).groupBy(sql`to_char(${testPlanExecutions.startedAt}, 'YYYY-MM-DD')`);
    const recent = await tx.select({ id: testPlanExecutions.id, planName: testPlans.name, status: testPlanExecutions.status, startedAt: testPlanExecutions.startedAt, queuedAt: testPlanExecutions.queuedAt, duration: testPlanExecutions.executionDurationMs }).from(testPlanExecutions).innerJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id)).where(and(...conditions)).orderBy(desc(sql`coalesce(${testPlanExecutions.startedAt}, ${testPlanExecutions.queuedAt})`)).limit(config.limit ?? 5);
    const totalRuns = Number(stats.total), passedRuns = Number(stats.passed), failedRuns = Number(stats.failed);
    const trend = Array.from({ length: days }, (_, i) => {
      const date = new Date(since); date.setUTCDate(date.getUTCDate() + i);
      const day = date.toISOString().slice(0, 10), found = trends.find(row => row.date === day);
      const passed = Number(found?.passed ?? 0), failed = Number(found?.failed ?? 0);
      return { date: day, passed, failed, total: passed + failed };
    });
    return { kpis: { totalRuns, successRate: totalRuns ? Math.round(passedRuns / totalRuns * 100) : 0, avgDuration: Number(stats.avgDuration), lastRun: recent[0] ?? null }, trend, distribution: [{ status: 'passed', value: passedRuns }, { status: 'failed', value: failedRuns }, { status: 'pending', value: totalRuns - passedRuns - failedRuns }], recent };
  });
}
export async function getDashboardSchedules(config: DashboardWidget['config'] = {}) {
  return withTenantTransaction(async tx => {
    if (config.projectId && !(await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, config.projectId)))[0]) return { unavailable: true };
    const conditions = [visiblePlan, eq(testPlanSchedules.isActive, true)];
    if (config.projectId) conditions.push(planProject(config.projectId));
    if (config.environment) conditions.push(eq(testPlanSchedules.environment, config.environment));
    const schedules = await tx.select({ id: testPlanSchedules.id, testPlanId: testPlanSchedules.testPlanId, testPlanName: testPlans.name, scheduleName: testPlanSchedules.scheduleName, frequency: testPlanSchedules.frequency, environment: testPlanSchedules.environment, nextRunAt: testPlanSchedules.nextRunAt, isActive: testPlanSchedules.isActive }).from(testPlanSchedules).innerJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id)).where(and(...conditions)).orderBy(asc(testPlanSchedules.nextRunAt)).limit(config.limit ?? 5);
    return { schedules };
  });
}

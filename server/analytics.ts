import { db } from './db';
import { testPlanExecutions, testPlans } from '@shared/schema';
import { eq, desc, sql, gte, and } from 'drizzle-orm';
import resolveLogger from './logger';

export async function getDashboardMetrics(userId: number) {
  const resolvedLogger = await resolveLogger;
  
  try {
    // We only fetch executions belonging to the user's test plans.
    // For this, we join testPlanExecutions with testPlans.
    
    // Total Runs & Stats
    const statsQuery = await db
      .select({
        total: sql<number>`count(*)`,
        passed: sql<number>`sum(case when ${testPlanExecutions.status} = 'completed' then 1 else 0 end)`,
        failed: sql<number>`sum(case when ${testPlanExecutions.status} = 'failed' or ${testPlanExecutions.status} = 'error' then 1 else 0 end)`,
        avgDuration: sql<number>`avg(case when ${testPlanExecutions.executionDurationMs} is not null then ${testPlanExecutions.executionDurationMs} else 0 end)`,
      })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
      .where(eq(testPlans.userId, userId));
      
    const stats = statsQuery[0];
    const totalRuns = Number(stats.total) || 0;
    const passedRuns = Number(stats.passed) || 0;
    const avgDuration = Number(stats.avgDuration) || 0;
    const successRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 0;

    // Trend Data (Last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const trendQuery = await db
      .select({
        date: sql<string>`date(${testPlanExecutions.startedAt})`,
        passed: sql<number>`sum(case when ${testPlanExecutions.status} = 'completed' then 1 else 0 end)`,
        failed: sql<number>`sum(case when ${testPlanExecutions.status} = 'failed' or ${testPlanExecutions.status} = 'error' then 1 else 0 end)`,
      })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
      .where(and(eq(testPlans.userId, userId), gte(testPlanExecutions.startedAt, thirtyDaysAgo)))
      .groupBy(sql`date(${testPlanExecutions.startedAt})`)
      .orderBy(sql`date(${testPlanExecutions.startedAt})`);

    // Fill missing days
    const trendData = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const found = trendQuery.find((t: any) => t.date === dateStr);
      trendData.push({
        date: dateStr,
        passed: found ? Number(found.passed) : 0,
        failed: found ? Number(found.failed) : 0,
        total: found ? Number(found.passed) + Number(found.failed) : 0
      });
    }

    // Pie Chart Data
    const pieData = [
      { name: 'Passed', value: passedRuns, fill: '#10b981' }, // green-500
      { name: 'Failed', value: Number(stats.failed) || 0, fill: '#ef4444' }, // red-500
      { name: 'Running/Pending', value: totalRuns - passedRuns - (Number(stats.failed) || 0), fill: '#eab308' } // yellow-500
    ];

    // Recent Executions
    const recentExecutions = await db
      .select({
        id: testPlanExecutions.id,
        planName: testPlans.name,
        status: testPlanExecutions.status,
        startedAt: testPlanExecutions.startedAt,
        duration: testPlanExecutions.executionDurationMs
      })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
      .where(eq(testPlans.userId, userId))
      .orderBy(desc(testPlanExecutions.startedAt))
      .limit(5);

    return {
      kpis: {
        totalRuns,
        successRate,
        avgDuration,
        lastRun: recentExecutions.length > 0 ? recentExecutions[0] : null
      },
      trend: trendData,
      distribution: pieData,
      recent: recentExecutions
    };

  } catch (error: any) {
    resolvedLogger.error(`Error in getDashboardMetrics: ${error.message}`);
    throw error;
  }
}

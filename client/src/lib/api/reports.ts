// client/src/lib/api/reports.ts
import type { TestPlanExecutionReport } from '@/pages/TestReportPage'; // Import the type from the page itself or a shared types file

export async function fetchTestExecutionReport(executionId: string): Promise<TestPlanExecutionReport> {
  const response = await fetch(`/api/test-plan-executions/${executionId}/report`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Failed to fetch test execution report and parse error response.' }));
    throw new Error(errorData.error || errorData.message || 'Failed to fetch test execution report');
  }
  return response.json();
}

import type { TestPlan, TestPlanExecution } from '@shared/schema';
import { apiRequest, ApiError } from '@/lib/queryClient';

// Summary type for Test Plan selection in wizards/dropdowns
export interface TestPlanSummary {
  id: string;
  name: string;
}

// Fetch all test plans (summary view)
export const fetchTestPlansAPI = async (): Promise<TestPlanSummary[]> => {
  const response = await fetch('/api/test-plans');
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to fetch test plans');
  }
  return response.json();
};

// Fetch all test plans (full view)
export const fetchFullTestPlansAPI = async (): Promise<TestPlan[]> => {
  const response = await fetch('/api/test-plans');
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to fetch test plans');
  }
  return response.json();
};


// Fetch a single test plan by ID (full details)
// Through apiRequest, like the page's other calls: the same credentials and headers, so the plan
// and its contents cannot disagree about whether it exists. The server says why in `error`.
export const fetchTestPlanByIdAPI = async (id: string): Promise<TestPlan> => {
  try {
    const response = await apiRequest('GET', `/api/test-plans/${encodeURIComponent(id)}`);
    return response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      const body = error.body as { error?: string; message?: string } | null;
      throw new Error(body?.error || body?.message || `Failed to fetch test plan ${id} (HTTP ${error.status})`);
    }
    throw error;
  }
};


// This type might need to be more specific based on the actual backend response structure
// For now, assuming it returns the TestPlanRun object which might have a 'data' wrapper from the route.
interface RunTestPlanResponse {
  success: boolean;
  data?: TestPlanExecution;
  error?: string;
}

export const runTestPlanAPI = async (testPlanId: string): Promise<RunTestPlanResponse> => {
  const response = await fetch(`/api/run-test-plan/${testPlanId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // If authentication tokens are needed, they should be added here.
      // e.g., 'Authorization': `Bearer ${getToken()}`
    },
  });

  if (!response.ok) {
    // Try to parse error response from backend if available
    let errorData;
    try {
      errorData = await response.json();
    } catch (e) {
      // Ignore if error response is not JSON
    }
    const errorMessage = errorData?.error || errorData?.message || `HTTP error ${response.status}`;
    throw new Error(errorMessage);
  }
  // The backend /api/run-test-plan/:id directly returns { success: true, data: TestPlanRun } or { success: false, error: ... }
  // So the casting to RunTestPlanResponse should be fine.
  return response.json() as Promise<RunTestPlanResponse>;
};

// Note: CreateTestPlan and UpdateTestPlan API functions would also go here
// if they were part of this task. They are currently handled by CreateTestPlanWizard.tsx's internal logic.

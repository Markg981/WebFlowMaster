import type { TestPlan, TestPlanRun } from '@shared/schema';

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
  // Assuming the backend returns full TestPlan objects, we map to summary
  const fullTestPlans: TestPlan[] = await response.json();
  return fullTestPlans.map(plan => ({ id: plan.id, name: plan.name }));
};


// Fetch a single test plan by ID (full details)
export const fetchTestPlanByIdAPI = async (id: string): Promise<TestPlan> => {
  const response = await fetch(`/api/test-plans/${id}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to fetch test plan ${id}`);
  }
  return response.json();
};


// This type might need to be more specific based on the actual backend response structure
// For now, assuming it returns the TestPlanRun object which might have a 'data' wrapper from the route.
interface RunTestPlanResponse {
  success: boolean;
  data?: TestPlanRun;
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

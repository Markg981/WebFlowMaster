// This type might need to be more specific based on the actual backend response structure
// For now, assuming it returns the TestPlanRun object which might have a 'data' wrapper from the route.
interface RunTestPlanResponse {
  success: boolean;
  data?: any; // Should be TestPlanRun from shared/schema eventually, but using 'any' for now
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
  return response.json() as Promise<RunTestPlanResponse>;
};

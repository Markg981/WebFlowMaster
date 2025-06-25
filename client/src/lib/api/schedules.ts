import type { TestPlanSchedule, InsertTestPlanSchedule } from '@shared/schema'; // Assuming these are exported

const BASE_URL = '/api/test-plan-schedules';

// Type for the schedule object returned by GET endpoints (includes testPlanName)
export interface TestPlanScheduleWithPlanName extends TestPlanSchedule {
  testPlanName?: string;
}

// Type for creating a schedule (client-side might handle Date objects for nextRunAt)
export interface CreateSchedulePayload extends Omit<InsertTestPlanSchedule, 'id' | 'createdAt' | 'updatedAt' | 'nextRunAt'> {
  nextRunAt: Date | number; // Client can provide Date, will be converted to timestamp before sending
  // Browsers might be an array of strings on the client
  browsers?: string[] | null;
}

// Type for updating a schedule
export interface UpdateSchedulePayload extends Partial<CreateSchedulePayload> {
  isActive?: boolean;
}


export const fetchSchedulesByPlanId = async (planId: string): Promise<TestPlanScheduleWithPlanName[]> => {
  const response = await fetch(`${BASE_URL}/plan/${planId}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    throw new Error(errorData.message || 'Failed to fetch schedules for plan');
  }
  return response.json();
};

export const fetchAllSchedules = async (): Promise<TestPlanScheduleWithPlanName[]> => {
  const response = await fetch(BASE_URL);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    throw new Error(errorData.message || 'Failed to fetch all schedules');
  }
  return response.json();
};

export const createSchedule = async (scheduleData: CreateSchedulePayload): Promise<TestPlanScheduleWithPlanName> => {
  const payload: InsertTestPlanSchedule = {
    ...scheduleData,
    testPlanId: scheduleData.testPlanId!, // Assuming testPlanId is always present from form
    scheduleName: scheduleData.scheduleName!,
    frequency: scheduleData.frequency!,
    nextRunAt: scheduleData.nextRunAt instanceof Date ? Math.floor(scheduleData.nextRunAt.getTime() / 1000) : scheduleData.nextRunAt,
    // Drizzle schema expects JSON strings for these, but client might send arrays/objects
    // The server handler for POST /api/test-plan-schedules will handle stringification
    browsers: scheduleData.browsers as any, // Server will stringify
    notificationConfigOverride: scheduleData.notificationConfigOverride as any, // Server will stringify
    executionParameters: scheduleData.executionParameters as any, // Server will stringify
  };

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    throw new Error(errorData.message || 'Failed to create schedule');
  }
  return response.json();
};

export const updateSchedule = async (id: string, scheduleData: UpdateSchedulePayload): Promise<TestPlanScheduleWithPlanName> => {
  const payload: Partial<InsertTestPlanSchedule> = { // Use InsertTestPlanSchedule for backend compatibility
    ...scheduleData,
    // Convert Date to timestamp if present
    ...(scheduleData.nextRunAt && {
        nextRunAt: scheduleData.nextRunAt instanceof Date ? Math.floor(scheduleData.nextRunAt.getTime() / 1000) : scheduleData.nextRunAt
    }),
    // Server will handle stringification for JSON fields if they are part of `scheduleData`
    ...(scheduleData.browsers && { browsers: scheduleData.browsers as any }),
    ...(scheduleData.notificationConfigOverride && { notificationConfigOverride: scheduleData.notificationConfigOverride as any }),
    ...(scheduleData.executionParameters && { executionParameters: scheduleData.executionParameters as any }),
  };

  const response = await fetch(`${BASE_URL}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    throw new Error(errorData.message || 'Failed to update schedule');
  }
  return response.json();
};

export const deleteSchedule = async (id: string): Promise<void> => {
  const response = await fetch(`${BASE_URL}/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    // For 204 No Content, response.ok might be true but response.json() will fail.
    // However, for other errors (404, 500), response.ok will be false.
    if (response.status === 204) return; // Successfully deleted
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    throw new Error(errorData.message || 'Failed to delete schedule');
  }
  // If response.ok is true and status is not 204, it's unexpected.
  if (response.status !== 204) {
    console.warn('Delete schedule responded with OK but status was not 204:', response.status);
  }
};

export const toggleScheduleActiveStatus = async (id: string, isActive: boolean): Promise<TestPlanScheduleWithPlanName> => {
  return updateSchedule(id, { isActive });
};

// API for Test Plan Executions
const EXECUTIONS_BASE_URL = '/api/test-plan-executions';

export interface TestPlanExecutionWithNames extends TestPlanExecution {
  testPlanName?: string;
  scheduleName?: string;
}

export interface FetchExecutionsParams {
  planId?: string;
  scheduleId?: string;
  limit?: number;
  offset?: number;
  status?: string;
  triggeredBy?: string;
}

export interface FetchExecutionsResponse {
  items: TestPlanExecutionWithNames[];
  limit: number;
  offset: number;
  // totalRecords?: number; // If server starts sending total
}


export const fetchTestPlanExecutions = async (params: FetchExecutionsParams): Promise<FetchExecutionsResponse> => {
  const queryParams = new URLSearchParams();
  if (params.planId) queryParams.append('planId', params.planId);
  if (params.scheduleId) queryParams.append('scheduleId', params.scheduleId);
  if (params.limit) queryParams.append('limit', params.limit.toString());
  if (params.offset) queryParams.append('offset', params.offset.toString());
  if (params.status) queryParams.append('status', params.status);
  if (params.triggeredBy) queryParams.append('triggeredBy', params.triggeredBy);

  const response = await fetch(`${EXECUTIONS_BASE_URL}?${queryParams.toString()}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    throw new Error(errorData.message || 'Failed to fetch test plan executions');
  }
  return response.json() as Promise<FetchExecutionsResponse>; // Ensure type matches the expected paginated structure
};

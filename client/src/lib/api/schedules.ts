import type { TestPlanSchedule, InsertTestPlanSchedule, TestPlanExecution } from '@shared/schema';

const BASE_URL = '/api/test-plan-schedules';

// Type for the schedule object returned by GET endpoints (includes testPlanName)
// Also ensures that fields that might be JSON strings from DB are correctly typed after server parsing
export interface TestPlanScheduleEnhanced extends TestPlanSchedule {
  testPlanName?: string; // Joined in by the server
  // Fields below are expected to be parsed by the server from JSON strings to appropriate types
  browsers: string[] | null;
  notificationConfigOverride: Record<string, any> | null;
  executionParameters: Record<string, any> | null;
  // Ensure nextRunAt is consistently a Date object on the client-side after fetch
  nextRunAt: Date;
}

// Payload for creating a schedule. Client uses Date for nextRunAt.
export type CreateScheduleClientPayload = Omit<InsertTestPlanSchedule, 'id' | 'createdAt' | 'updatedAt' | 'nextRunAt' | 'testPlanId' | 'scheduleName' | 'frequency'> & {
  testPlanId: string; // Ensure these are not optional for creation
  scheduleName: string;
  frequency: string;
  nextRunAt: Date; // Client provides Date, will be converted to timestamp before sending
};

// Payload for updating a schedule. All fields are optional. Client uses Date for nextRunAt.
export type UpdateScheduleClientPayload = Partial<Omit<InsertTestPlanSchedule, 'id' | 'createdAt' | 'updatedAt' | 'nextRunAt'>> & {
  nextRunAt?: Date;
};

// Helper to prepare payload for POST/PUT: converts Date to timestamp for nextRunAt
const prepareSchedulePayloadForServer = (data: CreateScheduleClientPayload | UpdateScheduleClientPayload): any => {
  const payload: any = { ...data };
  if (data.nextRunAt && data.nextRunAt instanceof Date) {
    payload.nextRunAt = Math.floor(data.nextRunAt.getTime() / 1000);
  }
  // The server route handlers for POST/PUT on /api/test-plan-schedules
  // already expect 'browsers', 'notificationConfigOverride', 'executionParameters'
  // as direct JSON-compatible objects/arrays if they are provided in the request body.
  // JSON.stringify(payload) in the fetch call will handle the overall conversion.
  // The server will then stringify these specific fields before DB insertion if needed.
  return payload;
};

// Helper to parse response from server: converts timestamp to Date for nextRunAt
// and ensures other fields are correctly typed.
const parseServerScheduleResponse = (schedule: TestPlanSchedule): TestPlanScheduleEnhanced => {
  // The server's GET /api/test-plan-schedules route already parses
  // browsers, notificationConfigOverride, and executionParameters from JSON strings.
  return {
    ...schedule,
    testPlanName: (schedule as any).testPlanName, // testPlanName is joined by server
    nextRunAt: new Date(schedule.nextRunAt * 1000), // Convert timestamp to Date
    browsers: schedule.browsers as string[] | null,
    notificationConfigOverride: schedule.notificationConfigOverride as Record<string, any> | null,
    executionParameters: schedule.executionParameters as Record<string, any> | null,
  };
};

export const fetchSchedulesByPlanId = async (planId: string): Promise<TestPlanScheduleEnhanced[]> => {
  const response = await fetch(`${BASE_URL}/plan/${planId}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    throw new Error(errorData.error || errorData.message || 'Failed to fetch schedules for plan');
  }
  const schedules: TestPlanSchedule[] = await response.json();
  return schedules.map(parseServerScheduleResponse);
};

export const fetchAllSchedules = async (): Promise<TestPlanScheduleEnhanced[]> => {
  const response = await fetch(BASE_URL);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    throw new Error(errorData.error || errorData.message || 'Failed to fetch all schedules');
  }
  const schedules: TestPlanSchedule[] = await response.json();
  return schedules.map(parseServerScheduleResponse);
};

export const createSchedule = async (scheduleData: CreateScheduleClientPayload): Promise<TestPlanScheduleEnhanced> => {
  const payload = prepareSchedulePayloadForServer(scheduleData);
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    // Extract Zod error messages if available from server response
    const zodError = errorData.details?.body?._errors?.[0] || errorData.details?.fieldErrors;
    if (zodError) throw new Error(typeof zodError === 'string' ? zodError : JSON.stringify(zodError));
    throw new Error(errorData.error || errorData.message || 'Failed to create schedule');
  }
  const createdSchedule: TestPlanSchedule = await response.json();
  return parseServerScheduleResponse(createdSchedule);
};

export const updateSchedule = async (id: string, scheduleData: UpdateScheduleClientPayload): Promise<TestPlanScheduleEnhanced> => {
  const payload = prepareSchedulePayloadForServer(scheduleData);
  const response = await fetch(`${BASE_URL}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    const zodError = errorData.details?.body?._errors?.[0] || errorData.details?.fieldErrors;
    if (zodError) throw new Error(typeof zodError === 'string' ? zodError : JSON.stringify(zodError));
    throw new Error(errorData.error || errorData.message || 'Failed to update schedule');
  }
  const updatedSchedule: TestPlanSchedule = await response.json();
  return parseServerScheduleResponse(updatedSchedule);
};

export const deleteSchedule = async (id: string): Promise<void> => {
  const response = await fetch(`${BASE_URL}/${id}`, {
    method: 'DELETE',
  });
  // response.ok is true for 204. If not ok and not 204, then it's an actual error.
  if (!response.ok && response.status !== 204) {
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    throw new Error(errorData.error || errorData.message || 'Failed to delete schedule');
  }
};

// --- Test Plan Executions API ---
const EXECUTIONS_BASE_URL = '/api/test-plan-executions';

// Enhanced type for executions, ensuring Date objects for timestamps
export interface TestPlanExecutionEnhanced extends TestPlanExecution {
  testPlanName?: string;
  scheduleName?: string;
  startedAt: Date; // Ensure this is a Date object
  completedAt?: Date | null; // Ensure this is a Date object or null
  // Server already parses results and browsers JSON
  results: Record<string, any> | null;
  browsers: string[] | null;
}

export interface FetchExecutionsParams {
  planId?: string;
  scheduleId?: string;
  limit?: number;
  offset?: number;
  status?: TestPlanExecution['status'];
  triggeredBy?: TestPlanExecution['triggeredBy'];
}

export interface FetchExecutionsResponse {
  items: TestPlanExecutionEnhanced[];
  limit: number;
  offset: number;
  // totalItems?: number; // Server doesn't currently send this
  // totalPages?: number;
}

// Helper to parse execution response from server
const parseServerExecutionResponse = (execution: TestPlanExecution): TestPlanExecutionEnhanced => {
  // Server GET /api/test-plan-executions already parses 'results' and 'browsers' JSON.
  // It also joins testPlanName and scheduleName.
  return {
    ...execution,
    testPlanName: (execution as any).testPlanName,
    scheduleName: (execution as any).scheduleName,
    startedAt: new Date(execution.startedAt * 1000), // Convert timestamp to Date
    completedAt: execution.completedAt ? new Date(execution.completedAt * 1000) : null,
    results: execution.results as Record<string, any> | null,
    browsers: execution.browsers as string[] | null,
  };
};

export const fetchTestPlanExecutions = async (params: FetchExecutionsParams): Promise<FetchExecutionsResponse> => {
  const queryParams = new URLSearchParams();
  if (params.planId) queryParams.append('planId', params.planId);
  if (params.scheduleId) queryParams.append('scheduleId', params.scheduleId);
  if (params.limit !== undefined) queryParams.append('limit', String(params.limit));
  if (params.offset !== undefined) queryParams.append('offset', String(params.offset));
  if (params.status) queryParams.append('status', params.status);
  if (params.triggeredBy) queryParams.append('triggeredBy', params.triggeredBy);

  const response = await fetch(`${EXECUTIONS_BASE_URL}?${queryParams.toString()}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    throw new Error(errorData.error || errorData.message || 'Failed to fetch test plan executions');
  }
  // Server returns { items: TestPlanExecution[], limit: number, offset: number }
  const rawResponse: { items: TestPlanExecution[], limit: number, offset: number } = await response.json();
  return {
    items: rawResponse.items.map(parseServerExecutionResponse),
    limit: rawResponse.limit,
    offset: rawResponse.offset,
  };
};

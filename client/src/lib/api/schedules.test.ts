import {
  fetchAllSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  fetchSchedulesByPlanId,
  type CreateScheduleClientPayload,
  type UpdateScheduleClientPayload,
} from './schedules';
import type { TestPlanSchedule } from '@shared/schema';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// `nextRunAt`/`createdAt` are Postgres `timestamp` columns and `browsers` is `jsonb`, so
// over the wire they arrive as ISO strings and a real array — not unix seconds and not a
// JSON-encoded string. The mocks below mirror that; they used to encode the older shape,
// which is why the parsed dates came out as 1970.
const mockBaseScheduleFromServer = {
  id: 'sched1',
  scheduleName: 'Test Schedule 1',
  testPlanId: 'plan1',
  frequency: 'daily',
  nextRunAt: new Date('2024-01-01T10:00:00Z').toISOString(),
  environment: 'QA',
  browsers: ['chromium'],
  isActive: true,
  retryOnFailure: 'none',
  notificationConfigOverride: null,
  executionParameters: null,
  createdAt: new Date('2024-01-01T00:00:00Z').toISOString(),
  updatedAt: null,
} as unknown as TestPlanSchedule;

// Server often joins testPlanName
const mockScheduleWithPlanNameFromServer = {
  ...mockBaseScheduleFromServer,
  testPlanName: 'Awesome Test Plan',
};


describe('Schedule API Client', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('fetchAllSchedules', () => {
    it('should fetch all schedules and parse them correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockScheduleWithPlanNameFromServer],
      });

      const result = await fetchAllSchedules();

      expect(mockFetch).toHaveBeenCalledWith('/api/test-plan-schedules');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('sched1');
      expect(result[0].scheduleName).toBe('Test Schedule 1');
      expect(result[0].testPlanName).toBe('Awesome Test Plan');
      expect(result[0].nextRunAt).toEqual(new Date('2024-01-01T10:00:00Z'));
      expect(result[0].browsers).toEqual(['chromium']);
    });

    it('should throw an error if fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Failed to fetch' }),
      });
      await expect(fetchAllSchedules()).rejects.toThrow('Failed to fetch');
    });
  });

  describe('fetchSchedulesByPlanId', () => {
    it('should fetch schedules by plan ID and parse them', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => [mockScheduleWithPlanNameFromServer],
        });
        const planId = 'planXYZ';
        const result = await fetchSchedulesByPlanId(planId);

        expect(mockFetch).toHaveBeenCalledWith(`/api/test-plan-schedules/plan/${planId}`);
        expect(result.length).toBe(1);
        expect(result[0].id).toBe(mockScheduleWithPlanNameFromServer.id);
        expect(result[0].nextRunAt).toEqual(new Date('2024-01-01T10:00:00Z'));
    });
  });

  describe('createSchedule', () => {
    it('should send correct payload and parse response for createSchedule', async () => {
      const newSchedulePayload: CreateScheduleClientPayload = {
        scheduleName: 'New Daily Run',
        testPlanId: 'plan2',
        frequency: 'daily',
        nextRunAt: new Date('2024-02-01T12:00:00Z'),
        environment: 'Dev',
        browsers: ['firefox'],
        isActive: true,
        retryOnFailure: 'once',
        notificationConfigOverride: { emails: ['dev@example.com'] },
        executionParameters: { tag: 'nightly' },
      };

      const expectedServerResponse = {
        ...mockBaseScheduleFromServer, // Use as a base
        id: 'schedNew', // Assume server returns a new ID
        scheduleName: newSchedulePayload.scheduleName,
        testPlanId: newSchedulePayload.testPlanId,
        frequency: newSchedulePayload.frequency,
        nextRunAt: newSchedulePayload.nextRunAt.toISOString(),
        environment: newSchedulePayload.environment,
        browsers: newSchedulePayload.browsers,
        isActive: newSchedulePayload.isActive,
        retryOnFailure: newSchedulePayload.retryOnFailure,
        notificationConfigOverride: newSchedulePayload.notificationConfigOverride,
        executionParameters: newSchedulePayload.executionParameters,
        createdAt: new Date().toISOString(), // Assume server sets this
      } as unknown as TestPlanSchedule;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => expectedServerResponse,
      });

      const result = await createSchedule(newSchedulePayload);

      expect(mockFetch).toHaveBeenCalledWith('/api/test-plan-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // prepareSchedulePayloadForServer keeps the Date, and JSON.stringify renders it
        // as an ISO string — which is what the server's timestamp column expects.
        body: JSON.stringify(newSchedulePayload),
      });
      expect(result.id).toBe('schedNew');
      expect(result.scheduleName).toBe(newSchedulePayload.scheduleName);
      expect(result.nextRunAt).toEqual(newSchedulePayload.nextRunAt); // Parsed back to Date
      expect(result.browsers).toEqual(newSchedulePayload.browsers);
      expect(result.notificationConfigOverride).toEqual(newSchedulePayload.notificationConfigOverride);
      expect(result.executionParameters).toEqual(newSchedulePayload.executionParameters);
    });

     it('should throw extracted Zod error message on createSchedule failure', async () => {
      const newSchedulePayload: CreateScheduleClientPayload = { /* ... */ } as any; // Incomplete for test
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: "Invalid request payload",
          details: { body: { _errors: ["Schedule name is required"] } }
        }),
      });

      await expect(createSchedule(newSchedulePayload)).rejects.toThrow("Schedule name is required");
    });
  });

  describe('updateSchedule', () => {
    it('should send correct partial payload for updateSchedule', async () => {
      const scheduleIdToUpdate = 'sched1';
      const updatePayload: UpdateScheduleClientPayload = {
        scheduleName: 'Updated Daily Run',
        isActive: false,
        nextRunAt: new Date('2024-03-01T14:00:00Z'),
      };

      const expectedServerResponse = {
        ...mockBaseScheduleFromServer,
        id: scheduleIdToUpdate,
        scheduleName: updatePayload.scheduleName!,
        isActive: updatePayload.isActive!,
        nextRunAt: updatePayload.nextRunAt!.toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as TestPlanSchedule;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => expectedServerResponse,
      });

      const result = await updateSchedule(scheduleIdToUpdate, updatePayload);

      expect(mockFetch).toHaveBeenCalledWith(`/api/test-plan-schedules/${scheduleIdToUpdate}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });
      expect(result.scheduleName).toBe('Updated Daily Run');
      expect(result.isActive).toBe(false);
      expect(result.nextRunAt).toEqual(updatePayload.nextRunAt);
    });
  });

  describe('deleteSchedule', () => {
    it('should call correct endpoint for deleteSchedule', async () => {
      const scheduleIdToDelete = 'schedToDelete';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204, // No content for successful delete
        // No json method for 204
      });

      await deleteSchedule(scheduleIdToDelete);

      expect(mockFetch).toHaveBeenCalledWith(`/api/test-plan-schedules/${scheduleIdToDelete}`, {
        method: 'DELETE',
      });
    });

    it('should throw error if delete fails with non-204 status', async () => {
      const scheduleIdToDelete = 'schedToDelete';
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server Error' }),
      });
      await expect(deleteSchedule(scheduleIdToDelete)).rejects.toThrow('Server Error');
    });
  });
});

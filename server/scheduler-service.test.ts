import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import cron from 'node-cron';
import { db } from './db';
import { testPlanSchedules, testPlans, testPlanExecutions, type InsertTestPlanSchedule, type TestPlan } from '@shared/schema';
import schedulerService, {
  addScheduleJob,
  removeScheduleJob,
  updateScheduleJob,
  initializeScheduler,
  frequencyToCronPatternForTest, // Use new name
  executeScheduledPlanForTest // Use new name
} from './scheduler-service';
import * as testExecutionService from './test-execution-service'; // To mock runTestPlan
import { eq } from 'drizzle-orm';

// Mock node-cron
vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((pattern, func, options) => ({ // Return a mock job object
      stop: vi.fn(),
      start: vi.fn(),
      // pattern and func can be accessed for assertions if needed
      _pattern: pattern,
      _func: func,
      _options: options,
    })),
    validate: vi.fn(pattern => !!pattern && pattern.split(' ').length >= 5 && pattern.split(' ').length <=6 ), // Basic validation mock
  },
}));

// Mock db calls
vi.mock('./db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([{id: 'mock-inserted-id'}]), // Default mock for insert
    returning: vi.fn().mockResolvedValue([{id: 'mock-returned-id'}]), // Default mock for returning
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(), // For joins if used directly in service
    $dynamic: vi.fn().mockReturnThis(), // If using dynamic queries
    and: vi.fn(), // If using complex conditions
  }
}));

// Mock test-execution-service's runTestPlan
vi.mock('./test-execution-service', async (importOriginal) => {
    const actual = await importOriginal<typeof testExecutionService>();
    return {
        ...actual, // Import and retain all other exports
        runTestPlan: vi.fn(), // Mock only runTestPlan
    };
});


// Mock logger (optional, if its calls interfere or need verification)
vi.mock('./logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    http: vi.fn(),
  },
  updateLogLevel: vi.fn(),
}));


describe('Scheduler Service', () => {
  let mockScheduleActive: InsertTestPlanSchedule;
  let mockScheduleOnce: InsertTestPlanSchedule;
  let mockTestPlan: TestPlan;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTestPlan = {
      id: 'plan-1', name: 'Test Plan 1', description: 'A plan',
      testMachinesConfig: null, captureScreenshots: 'on_failed_steps', visualTestingEnabled: false,
      pageLoadTimeout: 30000, elementTimeout: 30000, onMajorStepFailure: 'abort_and_run_next_test_case',
      onAbortedTestCase: 'delete_cookies_and_reuse_session', onTestSuitePreRequisiteFailure: 'stop_execution',
      onTestCasePreRequisiteFailure: 'stop_execution', onTestStepPreRequisiteFailure: 'abort_and_run_next_test_case',
      reRunOnFailure: 'none', notificationSettings: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    };

    mockScheduleActive = {
      id: 'sched-active', testPlanId: mockTestPlan.id, scheduleName: 'Active Daily',
      frequency: 'daily', nextRunAt: Math.floor(Date.now() / 1000) + 3600, // In 1 hour
      environment: 'QA', browsers: JSON.stringify(['chromium']), isActive: true, retryOnFailure: 'none',
      createdAt: Math.floor(Date.now() / 1000),
    };
    mockScheduleOnce = {
      id: 'sched-once', testPlanId: mockTestPlan.id, scheduleName: 'Once Off',
      frequency: 'once', nextRunAt: Math.floor(Date.now() / 1000) + 600, // In 10 mins
      isActive: true, retryOnFailure: 'none', createdAt: Math.floor(Date.now() / 1000),
    };

    // Setup default mock implementations for db calls if needed for specific tests
    (db.select as any).mockImplementation(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn(() => Promise.resolve([mockTestPlan])), // For fetching plan by ID
      limit: vi.fn(() => Promise.resolve([mockTestPlan])), // For fetching plan by ID
    }));
    (testExecutionService.runTestPlan as any).mockResolvedValue({ status: 'completed', results: { summary: 'OK' } });
  });

  describe('frequencyToCronPatternForTest', () => {
    it('should convert "daily" with nextRunAt to cron pattern', () => {
      const date = new Date('2023-01-01T10:30:00Z'); // 10:30 UTC
      expect(frequencyToCronPattern('daily', date)).toBe('30 10 * * *');
    });
    it('should convert "weekly" with nextRunAt to cron pattern', () => {
      const date = new Date('2023-01-01T10:30:00Z'); // Sunday (0)
      expect(frequencyToCronPattern('weekly', date)).toBe('30 10 * * 0');
    });
    it('should return null for "once"', () => {
      expect(frequencyToCronPattern('once', new Date())).toBeNull();
    });
    it('should return cron string for "cron:..."', () => {
      expect(frequencyToCronPattern('cron:0 0 * * *', new Date())).toBe('0 0 * * *');
    });
    it('should handle "every_X_minutes/hours/days"', () => {
        expect(frequencyToCronPattern('every_30_minutes', new Date())).toBe('*/30 * * * *');
        expect(frequencyToCronPattern('every_2_hours', new Date())).toBe('0 */2 * * *');
        const date = new Date('2023-01-01T08:15:00Z');
        expect(frequencyToCronPattern('every_3_days', date)).toBe('0 8 */3 * *');
    });
  });

  describe('addScheduleJob', () => {
    it('should schedule a job if active and pattern is valid', async () => {
      (db.select as any).mockImplementationOnce(() => ({ // Mock for plan fetch
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockTestPlan]),
        limit: vi.fn().mockResolvedValue([mockTestPlan]),
      }));
      await addScheduleJob(mockScheduleActive as TestPlanSchedule); // Cast as it has all fields for this test
      expect(cron.schedule).toHaveBeenCalledTimes(1);
      expect((cron.schedule as any).mock.calls[0][0]).toBe(frequencyToCronPattern(mockScheduleActive.frequency, new Date(mockScheduleActive.nextRunAt * 1000)));
    });

    it('should not schedule if not active', async () => {
      await addScheduleJob({ ...mockScheduleActive, isActive: false } as TestPlanSchedule);
      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it('should schedule a "once" job correctly if nextRunAt is in future', async () => {
        (db.select as any).mockImplementationOnce(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([mockTestPlan]),
            limit: vi.fn().mockResolvedValue([mockTestPlan]),
        }));
        const futureOnceSchedule = { ...mockScheduleOnce, nextRunAt: Math.floor(Date.now() / 1000) + 3600 };
        await addScheduleJob(futureOnceSchedule as TestPlanSchedule);
        expect(cron.schedule).toHaveBeenCalledTimes(1);
        const runAtDate = new Date(futureOnceSchedule.nextRunAt * 1000);
        const expectedCronTime = `${runAtDate.getUTCMinutes()} ${runAtDate.getUTCHours()} ${runAtDate.getUTCDate()} ${runAtDate.getUTCMonth() + 1} *`;
        expect((cron.schedule as any).mock.calls[0][0]).toBe(expectedCronTime);
    });
  });

  describe('removeScheduleJob', () => {
    it('should stop and remove a job if it exists', async () => {
      // First, add a job to simulate it being active
      (db.select as any).mockImplementationOnce(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockTestPlan]),
        limit: vi.fn().mockResolvedValue([mockTestPlan]),
      }));
      await addScheduleJob(mockScheduleActive as TestPlanSchedule);
      const mockJob = (cron.schedule as any).mock.results[0].value; // Get the mock job object

      removeScheduleJob(mockScheduleActive.id);
      expect(mockJob.stop).toHaveBeenCalledTimes(1);
      // Check internal map (not directly possible without exporting, but can check subsequent adds)
    });
  });

  describe('updateScheduleJob', () => {
    it('should remove old job and add new if active', async () => {
      // Add initial job
      (db.select as any).mockImplementation(() => ({ // Mock for plan fetch in add/update
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockTestPlan]),
        limit: vi.fn().mockResolvedValue([mockTestPlan]),
      }));
      await addScheduleJob(mockScheduleActive as TestPlanSchedule);
      const initialMockJob = (cron.schedule as any).mock.results[0].value;
      vi.clearAllMocks(); // Clear cron.schedule mocks but keep the job in internal map (conceptual)

      // Simulate internal map having the job for removal by addScheduleJob's own logic
      // This part is tricky as internal map `activeCronJobs` is not exported.
      // We rely on `removeScheduleJob` being called by `updateScheduleJob`.
      // The test for `removeScheduleJob` already covers `job.stop()`.

      // Re-mock db.select for the addScheduleJob call within updateScheduleJob
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockTestPlan]),
        limit: vi.fn().mockResolvedValue([mockTestPlan]),
      }));

      await updateScheduleJob({ ...mockScheduleActive, frequency: 'weekly' } as TestPlanSchedule);
      expect(initialMockJob.stop).toHaveBeenCalledTimes(1); // Assuming removeScheduleJob calls stop
      expect(cron.schedule).toHaveBeenCalledTimes(1); // For the new job
      expect((cron.schedule as any).mock.calls[0][0]).toContain('* * 0'); // weekly pattern part
    });

    it('should remove job if updated to inactive', async () => {
      (db.select as any).mockImplementationOnce(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockTestPlan]),
        limit: vi.fn().mockResolvedValue([mockTestPlan]),
      }));
      await addScheduleJob(mockScheduleActive as TestPlanSchedule);
      const mockJob = (cron.schedule as any).mock.results[0].value;
      vi.clearAllMocks(); // Clear cron.schedule mocks

      await updateScheduleJob({ ...mockScheduleActive, isActive: false } as TestPlanSchedule);
      expect(mockJob.stop).toHaveBeenCalledTimes(1);
      expect(cron.schedule).not.toHaveBeenCalled(); // No new job added
    });
  });

  describe('initializeScheduler', () => {
    it('should load active schedules and add jobs', async () => {
      const schedulesToLoad = [mockScheduleActive, { ...mockScheduleOnce, nextRunAt: Math.floor(Date.now() / 1000) + 3600 }];
      (db.select as any).mockImplementationOnce(() => ({ // Mock for the main schedule load
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(schedulesToLoad),
      }));
       // Mock for plan fetch inside addScheduleJob for each schedule
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockTestPlan]),
        limit: vi.fn().mockResolvedValue([mockTestPlan]),
      }));


      await initializeScheduler();
      expect(cron.schedule).toHaveBeenCalledTimes(schedulesToLoad.length);
    });

    it('should deactivate and skip past "once" schedules', async () => {
        const pastOnceSchedule = { ...mockScheduleOnce, nextRunAt: Math.floor(Date.now() / 1000) - 3600 };
        (db.select as any).mockImplementationOnce(() => ({ // Mock for the main schedule load
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([pastOnceSchedule]),
        }));
        (db.update as any).mockImplementationOnce(() => ({ // Mock for the update to deactivate
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([]), // .returning() not used here
        }));

        await initializeScheduler();
        expect(db.update).toHaveBeenCalledWith(testPlanSchedules);
        expect((db.update as any).mock.calls[0][0]).toEqual(testPlanSchedules); // Check table
        // Further check on .set({ isActive: false }) would require deeper mock inspection or specific return from .set().where()
        expect(cron.schedule).not.toHaveBeenCalled(); // No job should be scheduled for the past 'once'
    });
  });

  describe('executeScheduledPlan', () => {
    // This is an internal function called by cron jobs. Testing it directly.
    beforeEach(() => {
      // Reset mocks for db.insert and db.update for this specific test suite
      (db.insert as any).mockClear().mockImplementation(() => ({
        values: vi.fn().mockResolvedValue([{id: 'exec-id-123'}]), // Mock for inserting execution
      }));
      (db.update as any).mockClear().mockImplementation(() => ({ // Mock for updating execution/schedule
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{id: 'updated-id'}]),
      }));
    });

    it('should create execution record, call runTestPlan, and update execution', async () => {
      await executeScheduledPlan(mockScheduleActive as TestPlanSchedule, mockTestPlan);

      expect(db.insert).toHaveBeenCalledWith(testPlanExecutions);
      expect((db.insert as any).mock.calls[0][0]).toEqual(testPlanExecutions); // Check table for insert
      // Check values for insert
      const insertValues = (db.insert(testPlanExecutions).values as any).mock.calls[0][0];
      expect(insertValues.scheduleId).toBe(mockScheduleActive.id);
      expect(insertValues.testPlanId).toBe(mockTestPlan.id);
      expect(insertValues.status).toBe('pending');
      expect(insertValues.triggeredBy).toBe('scheduled');

      expect(testExecutionService.runTestPlan).toHaveBeenCalledTimes(1);
      expect(testExecutionService.runTestPlan).toHaveBeenCalledWith(mockTestPlan.id, 1, expect.any(Object));

      expect(db.update).toHaveBeenCalledWith(testPlanExecutions); // For updating execution status
      // Check values for update
      const updateValues = (db.update(testPlanExecutions).set as any).mock.calls[0][0];
      expect(updateValues.status).toBe('completed'); // From mockResolvedValue of runTestPlan
    });

    it('should handle "once" schedule by deactivating and removing job', async () => {
      const onceScheduleInstance = { ...mockScheduleOnce, id: 'once-exec-test' };
      // Mock removeScheduleJob as it's part of the default export of schedulerService
      const removeJobSpy = vi.spyOn(schedulerService, 'removeScheduleJob');

      await executeScheduledPlan(onceScheduleInstance as TestPlanSchedule, mockTestPlan);

      expect(db.update).toHaveBeenCalledWith(testPlanSchedules); // For deactivating
      const updateCall = (db.update as any).mock.calls.find((call: any[]) => call[0] === testPlanSchedules);
      expect((updateCall[1] as any)._operations[0].value.isActive).toBe(false); // Check isActive is set to false

      expect(removeJobSpy).toHaveBeenCalledWith(onceScheduleInstance.id);
      removeJobSpy.mockRestore();
    });
  });

});

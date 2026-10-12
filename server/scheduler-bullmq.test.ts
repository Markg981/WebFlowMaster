import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The BullMQ backend only talks to the queue + DB; mock those so the wiring is
// verifiable without a running Redis. (End-to-end firing must be validated in a
// Redis environment — see the E2E checklist in the PR/commit.)
vi.mock('./queue', () => ({
  TEST_EXECUTION_QUEUE_NAME: 'test-queue',
  testExecutionQueue: {
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    removeJobScheduler: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    getJobSchedulers: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('./test-execution-service', () => ({ runTestPlan: vi.fn() }));
vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('./db', () => ({
  privilegedDb: {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
  },
}));

import schedulerService, {
  bullmqAddScheduleJob,
  bullmqRemoveScheduleJob,
  bullmqUpdateScheduleJob,
  resolveSchedulerBackend,
  SCHEDULER_BACKEND,
  TRIGGER_SCHEDULE_JOB,
} from './scheduler-service';
import { testExecutionQueue } from './queue';

const q = testExecutionQueue as unknown as {
  upsertJobScheduler: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
  removeJobScheduler: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

const baseSchedule = {
  id: 'sched-1',
  testPlanId: 'plan-1',
  userId: 1,
  scheduleName: 'S',
  frequency: 'daily',
  nextRunAt: new Date('2023-01-01T10:30:00Z'),
  environment: null,
  browsers: null,
  notificationConfigOverride: null,
  executionParameters: null,
  isActive: true,
  retryOnFailure: 'none',
  createdAt: new Date(),
  updatedAt: null,
} as any;

describe('BullMQ scheduler backend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts a recurring job scheduler with the derived cron pattern', async () => {
    await bullmqAddScheduleJob(baseSchedule);

    expect(q.upsertJobScheduler).toHaveBeenCalledWith(
      'sched-1',
      { pattern: '30 10 * * *', tz: 'UTC' },
      { name: TRIGGER_SCHEDULE_JOB, data: { scheduleId: 'sched-1' } },
    );
    expect(q.add).not.toHaveBeenCalled();
  });

  it('adds a delayed one-time job for a future "once" schedule', async () => {
    const runAt = new Date(Date.now() + 3_600_000);
    await bullmqAddScheduleJob({ ...baseSchedule, frequency: 'once', nextRunAt: runAt });

    expect(q.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = q.add.mock.calls[0];
    expect(name).toBe(TRIGGER_SCHEDULE_JOB);
    expect(data).toEqual({ scheduleId: 'sched-1' });
    expect(opts.jobId).toBe('once-sched-1');
    expect(opts.delay).toBeGreaterThan(0);
    expect(q.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('does not enqueue anything for an inactive schedule', async () => {
    await bullmqAddScheduleJob({ ...baseSchedule, isActive: false });
    expect(q.upsertJobScheduler).not.toHaveBeenCalled();
    expect(q.add).not.toHaveBeenCalled();
  });

  it('removes both the recurring scheduler and any one-time job', async () => {
    await bullmqRemoveScheduleJob('sched-1');
    expect(q.removeJobScheduler).toHaveBeenCalledWith('sched-1');
    expect(q.remove).toHaveBeenCalledWith('once-sched-1');
  });

  it('update = remove then re-add for an active schedule', async () => {
    await bullmqUpdateScheduleJob(baseSchedule);
    expect(q.removeJobScheduler).toHaveBeenCalledWith('sched-1');
    expect(q.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });
});

describe('scheduler backend selection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is BullMQ unless SCHEDULER_BACKEND names cron', () => {
    expect(resolveSchedulerBackend(undefined)).toBe('bullmq');
    expect(resolveSchedulerBackend('')).toBe('bullmq');
    expect(resolveSchedulerBackend('bullmq')).toBe('bullmq');
    expect(resolveSchedulerBackend('cron')).toBe('cron');
    expect(resolveSchedulerBackend(' CRON ')).toBe('cron');
    // A value that names no backend is not a reason to fall back to the per-process engine.
    expect(resolveSchedulerBackend('something-else')).toBe('bullmq');
  });

  it('resolves to BullMQ in this process, where nothing sets SCHEDULER_BACKEND', () => {
    expect(process.env.SCHEDULER_BACKEND).toBeUndefined();
    expect(SCHEDULER_BACKEND).toBe('bullmq');
  });

  it('dispatches the public API to the BullMQ backend by default', async () => {
    await schedulerService.removeScheduleJob('sched-1');
    expect(q.removeJobScheduler).toHaveBeenCalledWith('sched-1');
    expect(q.remove).toHaveBeenCalledWith('once-sched-1');

    await schedulerService.addScheduleJob(baseSchedule);
    expect(q.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });

  it('keeps the in-process cron engine as an explicit opt-in', async () => {
    // The variable is read once at import, so the module is loaded again under the stub — and
    // with it a fresh instance of the mocked queue, which is the one it would talk to.
    vi.stubEnv('SCHEDULER_BACKEND', 'cron');
    vi.resetModules();
    const fresh = await import('./scheduler-service');
    const freshQueue = (await import('./queue')).testExecutionQueue as unknown as typeof q;
    expect(fresh.SCHEDULER_BACKEND).toBe('cron');

    // The cron backend's removal touches its own in-memory map, never the queue.
    await fresh.default.removeScheduleJob('sched-1');
    expect(freshQueue.removeJobScheduler).not.toHaveBeenCalled();
    expect(freshQueue.remove).not.toHaveBeenCalled();
  });
});

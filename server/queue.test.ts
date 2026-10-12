import { describe, it, expect, vi } from 'vitest';

/**
 * The queue's defaults. A failed job used to be kept for ever (`removeOnFail: false`), which
 * made Redis grow by every run that never started; a bounded retention keeps the recent ones
 * to read and lets the rest go.
 */

const constructed: Array<{ name: string; options: Record<string, unknown> }> = [];
vi.mock('./redis', () => ({ connection: { status: 'wait' } }));
vi.mock('./observability/queue', () => ({
  TracedQueue: class {
    constructor(name: string, options: Record<string, unknown>) {
      constructed.push({ name, options });
    }
  },
}));

const { TEST_EXECUTION_JOB_OPTIONS, TEST_EXECUTION_QUEUE_NAME } = await import('./queue');

describe('the test execution queue', () => {
  it('keeps failed jobs for a bounded time and count, and does not retry on its own', () => {
    expect(TEST_EXECUTION_JOB_OPTIONS).toEqual({
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
    });
    expect(constructed).toEqual([
      {
        name: TEST_EXECUTION_QUEUE_NAME,
        options: expect.objectContaining({ defaultJobOptions: TEST_EXECUTION_JOB_OPTIONS }),
      },
    ]);
  });
});

import { describe, it, expect } from 'vitest';
import { closeConsumers } from './worker-shutdown';

/**
 * Shutting the worker's queue consumers down.
 *
 * What these hold: while one consumer is still finishing a long job, the others have already
 * stopped taking new ones; shutdown waits for every active job; and a consumer whose close fails
 * does not cut short the wait for the rest.
 */

/** A consumer shaped like a BullMQ Worker: close() stops fetching, then waits for the job in hand. */
function fakeConsumer() {
  let closing = false;
  let finishActive: (() => void) | undefined;
  let active: Promise<void> | undefined;
  const taken: string[] = [];
  return {
    taken,
    /** A job reaches the queue: taken unless close() was already called. */
    offer(jobId: string): boolean {
      if (closing) return false;
      taken.push(jobId);
      return true;
    },
    /** Takes a job that runs until finish() is called. */
    startLongJob(jobId: string) {
      taken.push(jobId);
      active = new Promise<void>((resolve) => (finishActive = resolve));
    },
    finish() {
      finishActive?.();
    },
    get closing() {
      return closing;
    },
    close(): Promise<void> {
      closing = true;
      return active ?? Promise.resolve();
    },
  };
}

describe('closeConsumers', () => {
  it('stops every consumer taking jobs while the first is still finishing a long one', async () => {
    const plans = fakeConsumer();
    const browserTasks = fakeConsumer();
    const loadRuns = fakeConsumer();
    plans.startLongJob('plan-1');

    let closed = false;
    const shutdown = closeConsumers([plans, browserTasks, loadRuns]).then(() => (closed = true));

    // The plan is still running, yet the other queues no longer take work.
    expect(plans.closing).toBe(true);
    expect(browserTasks.closing).toBe(true);
    expect(loadRuns.closing).toBe(true);
    expect(browserTasks.offer('browser-task-1')).toBe(false);
    expect(loadRuns.offer('load-run-1')).toBe(false);
    expect(browserTasks.taken).toEqual([]);
    expect(loadRuns.taken).toEqual([]);

    // Shutdown waits for the job in hand.
    await Promise.resolve();
    expect(closed).toBe(false);
    plans.finish();
    await shutdown;
    expect(closed).toBe(true);
    expect(plans.taken).toEqual(['plan-1']);
  });

  it('waits for the other consumers before rethrowing a failed close', async () => {
    const failing = { close: () => Promise.reject(new Error('connection lost')) };
    const busy = fakeConsumer();
    busy.startLongJob('plan-1');

    let settled = false;
    const shutdown = closeConsumers([failing, busy]).finally(() => (settled = true));
    shutdown.catch(() => undefined);

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    busy.finish();
    await expect(shutdown).rejects.toThrow('connection lost');
  });

  it('resolves at once with no consumers', async () => {
    await expect(closeConsumers([])).resolves.toBeUndefined();
  });
});

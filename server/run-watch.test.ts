import { describe, it, expect, vi } from 'vitest';
import { watchRun } from './run-watch';

/** What a worker hears while it runs: a cancellation, its own time limit, or that the run is gone. */

const quietInterval = 3_600_000; // the tests call check() themselves

describe('watchRun', () => {
  it('keeps going while the run is running and within its time', async () => {
    const heartbeat = vi.fn(async () => 'running' as const);
    const watch = watchRun('run-1', { heartbeat, intervalMs: quietInterval, maxDurationMs: 60_000, startedAt: 0, now: () => 30_000 });

    await watch.check();

    expect(heartbeat).toHaveBeenCalledWith('run-1');
    expect(watch.cause).toBeNull();
    expect(watch.signal.aborted).toBe(false);
    watch.stop();
  });

  it('stops when somebody asked to cancel, and aborts the test in progress', async () => {
    const onStop = vi.fn();
    const watch = watchRun('run-1', { heartbeat: async () => 'cancelling', intervalMs: quietInterval, onStop });

    await watch.check();

    expect(watch.cause).toBe('cancelled');
    expect(watch.stopReason).toMatch(/cancelled/);
    expect(watch.signal.aborted).toBe(true);
    expect(onStop).toHaveBeenCalledWith('cancelled', watch.stopReason);
    watch.stop();
  });

  it('stops at its time limit', async () => {
    let clock = 0;
    const watch = watchRun('run-1', { heartbeat: async () => 'running', intervalMs: quietInterval, maxDurationMs: 60_000, startedAt: 0, now: () => clock });

    clock = 59_000;
    await watch.check();
    expect(watch.cause).toBeNull();
    clock = 61_000;
    await watch.check();

    expect(watch.cause).toBe('timed_out');
    expect(watch.stopReason).toMatch(/limit of 1 minutes/);
    watch.stop();
  });

  it('stops when the run was ended elsewhere, and stops asking', async () => {
    const heartbeat = vi.fn(async () => null);
    const watch = watchRun('run-1', { heartbeat, intervalMs: quietInterval });

    await watch.check();
    await watch.check();

    expect(watch.cause).toBe('lost');
    expect(heartbeat).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it('does not stop a run because one heartbeat could not be written', async () => {
    const watch = watchRun('run-1', {
      heartbeat: async () => {
        throw new Error('connection reset');
      },
      intervalMs: quietInterval,
    });

    await watch.check();

    expect(watch.cause).toBeNull();
    watch.stop();
  });

  it('beats on its own, every interval', async () => {
    vi.useFakeTimers();
    try {
      const heartbeat = vi.fn(async () => 'running' as const);
      const watch = watchRun('run-1', { heartbeat, intervalMs: 1_000 });

      await vi.advanceTimersByTimeAsync(3_500);

      expect(heartbeat).toHaveBeenCalledTimes(3);
      watch.stop();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(heartbeat).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

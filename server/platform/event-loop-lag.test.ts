import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveEventLoopLagMs, startEventLoopLagMonitor } from './event-loop-lag';

describe('event loop lag monitor', () => {
  afterEach(() => vi.useRealTimers());

  it('is healthy while the heartbeat runs and unhealthy once it lags past the threshold', () => {
    vi.useFakeTimers();
    const monitor = startEventLoopLagMonitor(2000);
    vi.advanceTimersByTime(5000);
    expect(monitor.healthy()).toBe(true);
    // A blocked loop: the clock moves, the heartbeat timer cannot run.
    vi.setSystemTime(Date.now() + 5000);
    expect(monitor.lagMs()).toBeGreaterThan(2000);
    expect(monitor.healthy()).toBe(false);
    monitor.stop();
  });

  it('validates WORKER_EVENT_LOOP_LAG_MS', () => {
    expect(resolveEventLoopLagMs({})).toBe(10_000);
    expect(resolveEventLoopLagMs({ WORKER_EVENT_LOOP_LAG_MS: '3000' })).toBe(3000);
    expect(() => resolveEventLoopLagMs({ WORKER_EVENT_LOOP_LAG_MS: '5' })).toThrow(/1000/);
    expect(() => resolveEventLoopLagMs({ WORKER_EVENT_LOOP_LAG_MS: 'abc' })).toThrow();
  });
});

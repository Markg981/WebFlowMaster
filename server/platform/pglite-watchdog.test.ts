import { describe, expect, it } from 'vitest';
import { pgliteWatchdogThreshold, watchPgliteLocks } from './pglite-watchdog';

describe('watchPgliteLocks', () => {
  it('reports a call held past the threshold once, with where it came from', async () => {
    let clock = 0;
    let release!: () => void;
    const client = {
      query: async () => 'rows',
      exec: async () => undefined,
      transaction: () => new Promise<void>((resolve) => (release = resolve)),
    };
    const reports: Array<{ message: string; details: Record<string, unknown> }> = [];
    const watchdog = watchPgliteLocks(client, {
      thresholdMs: 1_000,
      now: () => clock,
      report: (message, details) => reports.push({ message, details }),
    });
    try {
      const held = client.transaction();
      await expect(client.query()).resolves.toBe('rows');
      clock = 999;
      expect(watchdog.check()).toBe(0);
      clock = 1_000;
      expect(watchdog.check()).toBe(1);
      expect(watchdog.check()).toBe(0);
      expect(reports).toHaveLength(1);
      expect(reports[0].message).toContain('(transaction) pending for 1s');
      expect(String(reports[0].details.stack)).toContain('pglite-watchdog.test');
      release();
      await held;
      expect(watchdog.pendingCount()).toBe(0);
    } finally {
      watchdog.stop();
    }
  });

  it('is on by default and off with 0', () => {
    expect(pgliteWatchdogThreshold({})).toBe(60_000);
    expect(pgliteWatchdogThreshold({ PGLITE_LOCK_WATCHDOG_MS: '0' })).toBe(0);
    expect(pgliteWatchdogThreshold({ PGLITE_LOCK_WATCHDOG_MS: '5000' })).toBe(5_000);
  });
});

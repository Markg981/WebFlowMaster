import { describe, expect, it, vi } from 'vitest';
import { ADVISORY_KEYS, withAdvisoryLock, withBlockingAdvisoryLock } from './advisory-lock';

describe('withAdvisoryLock', () => {
  it('lets only one of two concurrent ticks run, then frees the lock', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = vi.fn(() => gate.then(() => 'done'));
    const first = withAdvisoryLock(ADVISORY_KEYS.runRecovery, fn);
    const second = await withAdvisoryLock(ADVISORY_KEYS.runRecovery, fn);
    expect(second).toEqual({ ran: false });
    release();
    expect(await first).toEqual({ ran: true, value: 'done' });
    expect(await withAdvisoryLock(ADVISORY_KEYS.runRecovery, async () => 1)).toEqual({
      ran: true,
      value: 1,
    });
  });

  it('releases the lock when the work throws', async () => {
    await expect(
      withAdvisoryLock(ADVISORY_KEYS.artifactRetention, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await withAdvisoryLock(ADVISORY_KEYS.artifactRetention, async () => 1)).ran).toBe(true);
  });
});

describe('withBlockingAdvisoryLock', () => {
  it('runs the work directly without a Postgres connection (PGlite)', async () => {
    expect(await withBlockingAdvisoryLock(ADVISORY_KEYS.migrator, './data', async () => 7)).toBe(7);
  });

  it('takes pg_advisory_lock and releases it on one connection (Postgres)', async () => {
    const queries: string[] = [];
    vi.resetModules();
    vi.doMock('pg', () => ({
      Pool: class {},
      Client: class {
        connect = async () => undefined;
        query = async (q: string) => void queries.push(q);
        end = async () => undefined;
      },
    }));
    const mod = await import('./advisory-lock');
    await mod.withBlockingAdvisoryLock(3, 'postgres://x', async () => queries.push('work'));
    expect(queries).toEqual([
      'SELECT pg_advisory_lock($1,$2)',
      'work',
      'SELECT pg_advisory_unlock($1,$2)',
    ]);
    vi.doUnmock('pg');
  });
});

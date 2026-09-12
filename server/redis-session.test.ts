import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Booting without Redis.
 *
 * Both defects these tests pin down only appear *after* `connect()` has been called —
 * which is why they survived a suite that never called it. Nothing listens on port 1,
 * so every connection attempt here is refused immediately.
 */

const UNREACHABLE = 'redis://127.0.0.1:1';

// `vi.resetModules()` below rebuilds the module graph on every import, and the real logger
// binds a fresh database on construction to read its level from `system_settings` — a table
// that per-file database has no migrations for. Stubbing it keeps the run's output to the
// assertions rather than a Postgres stack per test.
vi.mock('./logger', () => {
  const noop = () => undefined;
  return {
    default: Promise.resolve({
      error: noop, warn: noop, info: noop, http: noop, verbose: noop, debug: noop,
    }),
  };
});

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    REDIS_URL: process.env.REDIS_URL,
    NODE_ENV: process.env.NODE_ENV,
  };
  vi.resetModules();
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

describe('connectSessionRedis with an unreachable Redis', () => {
  it('rejects instead of staying pending forever', async () => {
    process.env.REDIS_URL = UNREACHABLE;
    const { connectSessionRedis } = await import('./redis');

    // The failure mode being pinned: the promise never settles, so `await` in index.ts
    // never returns and server.listen() is never reached.
    const settled = await Promise.race([
      connectSessionRedis().then(() => 'resolved' as const).catch(() => 'rejected' as const),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 15_000)),
    ]);

    expect(settled).toBe('rejected');
  }, 30_000);

  it('lets a later call retry rather than caching the failure', async () => {
    process.env.REDIS_URL = UNREACHABLE;
    const { connectSessionRedis } = await import('./redis');

    await expect(connectSessionRedis()).rejects.toThrow();
    // A second attempt must reach the driver again, not hand back the settled rejection.
    await expect(connectSessionRedis()).rejects.toThrow();
  }, 30_000);
});

describe('reconnectDecision', () => {
  it('gives up on the initial connection so connect() can reject', async () => {
    const { reconnectDecision } = await import('./redis');

    expect(reconnectDecision(0, false)).toEqual(expect.any(Number));
    expect(reconnectDecision(99, false)).toBeInstanceOf(Error);
  });

  it('never gives up once a connection has been established', async () => {
    const { reconnectDecision } = await import('./redis');

    // Losing Redis at runtime must not kill the process, so there is no attempt ceiling
    // here — only a capped backoff.
    expect(reconnectDecision(99, true)).toEqual(expect.any(Number));
    expect(reconnectDecision(10_000, true)).toEqual(expect.any(Number));
  });

  it('backs off progressively but stays bounded', async () => {
    const { reconnectDecision } = await import('./redis');

    const first = reconnectDecision(0, true) as number;
    const later = reconnectDecision(5, true) as number;
    const muchLater = reconnectDecision(500, true) as number;

    expect(later).toBeGreaterThan(first);
    expect(muchLater).toBeLessThanOrEqual(5_000);
  });
});

describe('createSessionStore after a failed Redis connection', () => {
  it('falls back to the in-memory store in development', async () => {
    process.env.REDIS_URL = UNREACHABLE;
    process.env.NODE_ENV = 'development';

    const { connectSessionRedis, sessionRedis } = await import('./redis');
    await connectSessionRedis().catch(() => {});

    const { createSessionStore } = await import('./auth');
    const store = createSessionStore();

    // `isOpen` is true here — node-redis sets it on entry to connect(), before a socket
    // exists — so a store chosen on `isOpen` would be the Redis one, and every session
    // write would hang.
    expect(sessionRedis.isReady).toBe(false);
    expect(store.constructor.name).not.toBe('RedisStore');
  }, 30_000);

  it('refuses to start in production rather than serving a broken store', async () => {
    process.env.REDIS_URL = UNREACHABLE;
    process.env.NODE_ENV = 'production';

    const { connectSessionRedis } = await import('./redis');
    await connectSessionRedis().catch(() => {});

    const { createSessionStore } = await import('./auth');

    expect(() => createSessionStore()).toThrow(/shared session store/i);
  }, 30_000);
});

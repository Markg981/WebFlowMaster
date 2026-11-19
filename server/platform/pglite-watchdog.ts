/**
 * PGlite has one connection and a client-wide mutex: a transaction whose callback awaits a query
 * sent outside it waits forever, and every later request with it. Nothing is logged and the
 * process sits idle, so the wedge is invisible. This records where each pending call came from and
 * logs the ones held longer than the threshold, once each: the oldest is the holder, the others
 * are waiting behind it.
 */
type Method = 'query' | 'exec' | 'transaction';

interface Pending {
  method: Method;
  startedAt: number;
  sql?: string;
  stack?: string;
  reported?: boolean;
}

export interface WatchedClient {
  query: (...args: never[]) => Promise<unknown>;
  exec: (...args: never[]) => Promise<unknown>;
  transaction: (...args: never[]) => Promise<unknown>;
}

export interface WatchdogOptions {
  thresholdMs: number;
  report: (message: string, details: Record<string, unknown>) => void;
  now?: () => number;
}

export function pgliteWatchdogThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PGLITE_LOCK_WATCHDOG_MS;
  if (raw === undefined || raw === '') return 60_000;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function callerStack(): string | undefined {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 30;
  try {
    return new Error('pending PGlite call').stack?.split('\n').slice(3).join('\n');
  } finally {
    Error.stackTraceLimit = limit;
  }
}

/** Wraps the client's entry points in place; returns a check (run on a timer) and its stop. */
export function watchPgliteLocks(client: WatchedClient, options: WatchdogOptions) {
  const now = options.now ?? Date.now;
  const pending = new Map<number, Pending>();
  let next = 0;
  for (const method of ['query', 'exec', 'transaction'] as const) {
    const original = client[method].bind(client) as (...args: unknown[]) => Promise<unknown>;
    (client as unknown as Record<Method, (...args: unknown[]) => Promise<unknown>>)[method] = (
      ...args: unknown[]
    ) => {
      const id = ++next;
      pending.set(id, {
        method,
        startedAt: now(),
        sql: typeof args[0] === 'string' ? args[0].slice(0, 300) : undefined,
        stack: callerStack(),
      });
      let result: Promise<unknown>;
      try {
        result = Promise.resolve(original(...args));
      } catch (error) {
        pending.delete(id);
        throw error;
      }
      return result.finally(() => pending.delete(id));
    };
  }

  const check = () => {
    const at = now();
    const stuck = [...pending.entries()].filter(
      ([, call]) => at - call.startedAt >= options.thresholdMs,
    );
    const fresh = stuck.filter(([, call]) => !call.reported);
    if (fresh.length === 0) return 0;
    for (const [id, call] of stuck) {
      options.report(
        `PGlite call ${id} (${call.method}) pending for ${Math.round((at - call.startedAt) / 1000)}s${
          call.reported ? ' (still)' : ''
        }`,
        { id, method: call.method, sql: call.sql, stack: call.stack },
      );
      call.reported = true;
    }
    return fresh.length;
  };
  const timer = setInterval(check, Math.max(1_000, options.thresholdMs / 2));
  timer.unref?.();
  return { check, stop: () => clearInterval(timer), pendingCount: () => pending.size };
}

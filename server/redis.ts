import { Redis } from 'ioredis';
import { createClient } from 'redis';
import loggerPromise from './logger';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

/** Attempts allowed before the *first* successful connection, after which connect() rejects. */
const INITIAL_CONNECT_ATTEMPTS = 3;
/** Ceiling on the reconnect backoff, so a long outage doesn't stretch to minutes. */
const MAX_RECONNECT_DELAY_MS = 5_000;

/**
 * How long to wait before the next connection attempt, or an Error to stop trying.
 *
 * The distinction that matters is whether a connection has ever succeeded. Before the
 * first one, retrying forever is what kept `connect()` pending and stopped the server
 * from ever reaching `listen()` — so it gives up and lets the caller decide. After one,
 * giving up would mean a transient Redis outage kills a running process, so it retries
 * indefinitely on a capped backoff.
 */
export function reconnectDecision(retries: number, hasConnectedBefore: boolean): number | Error {
  if (!hasConnectedBefore && retries >= INITIAL_CONNECT_ATTEMPTS) {
    return new Error(
      `Redis at ${redisUrl} did not accept a connection after ${INITIAL_CONNECT_ATTEMPTS} attempts.`,
    );
  }
  return Math.min(50 * 2 ** retries, MAX_RECONNECT_DELAY_MS);
}

/**
 * Logs the first occurrence of a repeated error and counts the rest.
 *
 * A refused Redis connection produces one multi-line AggregateError per attempt, and the
 * reconnect loop produced hundreds of identical ones — enough to bury the line saying what
 * the server actually decided to do.
 */
function throttledErrorLogger(prefix: string, windowMs = 30_000) {
  let lastKey: string | undefined;
  let lastAt = 0;
  let suppressed = 0;

  return async (error: Error) => {
    const logger = await loggerPromise;
    const detail = describeError(error);
    const key = `${error.name}:${detail}`;
    const now = Date.now();

    if (key === lastKey && now - lastAt < windowMs) {
      suppressed++;
      return;
    }

    if (suppressed > 0) {
      logger.warn(`${prefix}: previous error repeated ${suppressed} more time(s).`);
      suppressed = 0;
    }
    lastKey = key;
    lastAt = now;
    logger.error(`${prefix}: ${detail}`);
  };
}

/**
 * A one-line description of a connection error.
 *
 * A refused TCP connection arrives as an AggregateError — one sub-error per resolved
 * address — whose own `message` is the empty string. Reading `.message` alone produced
 * log lines that said only "Redis connection error:" and named neither the cause nor
 * the host.
 */
function describeError(error: Error): string {
  const aggregate = error as AggregateError & { code?: string };
  if (Array.isArray(aggregate.errors) && aggregate.errors.length > 0) {
    const causes = aggregate.errors
      .map((e: any) => (e?.address ? `${e.code} ${e.address}:${e.port}` : e?.message || String(e)))
      .join('; ');
    return `${aggregate.code ?? error.name}: ${causes}`;
  }
  return error.message || aggregate.code || error.name;
}

export const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  // Connect on first command rather than at import time, so modules that import
  // this (e.g. auth for sessions) don't force a Redis connection when none is used
  // (e.g. tests using an in-memory session store).
  lazyConnect: true,
  // Deliberately unbounded, unlike the session client below. Nothing awaits this client
  // during startup — it is lazy and BullMQ drives it — so giving up buys no unblocking,
  // and it costs plenty: ioredis then rejects the queued commands, and an enqueue nobody
  // awaited becomes an unhandled rejection that takes the whole process (or, in CI, a
  // whole test file) down. A queue waiting for Redis to come back is the wanted
  // behaviour; only the capped backoff is worth borrowing.
  retryStrategy: (retries) => reconnectDecision(retries, true) as number,
});

connection.on('error', throttledErrorLogger('Redis connection error'));

connection.on('ready', async () => {
  const logger = await loggerPromise;
  logger.info('Redis connection established successfully.');
});

// Separate client for the express-session store: connect-redis targets node-redis
// (peer dep `redis` >= 5) and calls set(key, val, {EX}), mGet() and scanIterator(),
// which ioredis does not implement — passing the ioredis client makes Redis reject the
// malformed SET with "ERR syntax error" and every login fails. BullMQ, in turn, requires
// ioredis, so the two clients coexist against the same server.
let sessionEverConnected = false;

export const sessionRedis = createClient({
  url: redisUrl,
  socket: {
    reconnectStrategy: (retries) => reconnectDecision(retries, sessionEverConnected),
  },
});

sessionRedis.on('error', throttledErrorLogger('Session Redis connection error'));

sessionRedis.on('ready', () => {
  sessionEverConnected = true;
});

let sessionRedisConnecting: Promise<void> | null = null;

/**
 * Connects the session client once; safe to call repeatedly.
 *
 * Bounded on two independent levels. `reconnectStrategy` makes the driver give up on the
 * initial connection, and `timeoutMs` guards against a driver that doesn't — because the
 * caller in index.ts awaits this before `server.listen()`, and a pending promise there is
 * indistinguishable from a hung process.
 */
export function connectSessionRedis(timeoutMs = 5_000): Promise<void> {
  if (!sessionRedisConnecting) {
    sessionRedisConnecting = (async () => {
      let guard: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          sessionRedis.connect().then(() => undefined),
          new Promise<never>((_, reject) => {
            guard = setTimeout(
              () => reject(new Error(`Session Redis did not connect within ${timeoutMs}ms.`)),
              timeoutMs,
            );
          }),
        ]);
        const logger = await loggerPromise;
        logger.info('Session Redis connection established successfully.');
      } catch (error) {
        // Leave the client closed so the next call starts a fresh attempt rather than
        // hitting "Socket already opened" — reachable when the timeout wins the race.
        try {
          sessionRedis.destroy();
        } catch {
          /* already closed */
        }
        sessionRedisConnecting = null; // allow a later retry
        throw error;
      } finally {
        if (guard) clearTimeout(guard);
      }
    })();
  }
  return sessionRedisConnecting;
}

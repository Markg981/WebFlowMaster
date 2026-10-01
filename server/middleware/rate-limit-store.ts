import { MemoryStore, type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit';
import type Redis from 'ioredis';

/**
 * Rate-limit counts kept in Redis, so every web process behind a load balancer counts against one
 * budget. Each process used to count in its own memory, which made the effective limit that many
 * times the declared one.
 *
 * Redis is used only while it answers: a client that is not ready, or a command slower than
 * REDIS_TIMEOUT_MS, falls back to this process's memory for that request. The shared client queues
 * commands while Redis is down rather than failing them, so waiting on it would hold every limited
 * request — sign-in included — until Redis came back. A limit that is briefly per process is the
 * lesser harm.
 */

const REDIS_TIMEOUT_MS = 250;

/** One counter per key and window: the first hit starts the window, the key expires with it. */
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {hits, ttl}
`;

type RedisLike = Pick<Redis, 'status' | 'eval' | 'decr' | 'del'>;

export class SharedRateLimitStore implements Store {
  private windowMs = 60_000;
  private readonly memory = new MemoryStore();

  /**
   * @param name what this limit is, so two limits never share a counter (api, webhook, auth…).
   * @param redis the client to count in; resolved lazily so importing this never connects.
   */
  constructor(
    private readonly name: string,
    private readonly redis: () => RedisLike | null,
  ) {}

  /** Read by express-rate-limit: counts are not only this process's. */
  get localKeys() {
    return false;
  }

  init(options: Options) {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  private keyFor(key: string) {
    return `ratelimit:${this.name}:${key}`;
  }

  private ready(): RedisLike | null {
    const client = this.redis();
    return client && client.status === 'ready' ? client : null;
  }

  private async within<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Redis did not answer in time')), REDIS_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const client = this.ready();
    if (client) {
      try {
        const [hits, ttl] = (await this.within(client.eval(INCREMENT, 1, this.keyFor(key), String(this.windowMs)))) as [number, number];
        return { totalHits: Number(hits), resetTime: new Date(Date.now() + Number(ttl)) };
      } catch {
        // Fall through to this process's count.
      }
    }
    return this.memory.increment(key);
  }

  async decrement(key: string): Promise<void> {
    const client = this.ready();
    if (client) {
      try {
        await this.within(client.decr(this.keyFor(key)));
        return;
      } catch {
        // Fall through.
      }
    }
    await this.memory.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    const client = this.ready();
    if (client) {
      try {
        await this.within(client.del(this.keyFor(key)));
      } catch {
        // The memory count is reset below either way.
      }
    }
    await this.memory.resetKey(key);
  }

  shutdown() {
    this.memory.shutdown();
  }
}

let redisClient: (RedisLike & Partial<Pick<Redis, 'connect'>>) | null = null;

/** A store for one limit, counting in the application's Redis once the web process provides it. */
export function sharedStore(name: string): SharedRateLimitStore {
  return new SharedRateLimitStore(name, () => redisClient);
}

/**
 * Called once at start-up by the web process with the client it already holds. The client
 * connects lazily; nothing else may have asked it to yet, so this does, without waiting.
 */
export function useRedisForRateLimits(client: (RedisLike & Partial<Pick<Redis, 'connect'>>) | null) {
  redisClient = client;
  if (client && client.status === 'wait' && client.connect) client.connect().catch(() => undefined);
}

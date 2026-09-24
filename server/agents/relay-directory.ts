import type { Redis } from 'ioredis';

/**
 * Which relay instance holds which agents, when there is more than one web server.
 *
 * An agent keeps its standing connection to whichever instance the load balancer gave it, and a
 * runner's request for a browser may reach any instance. Each instance publishes what it holds a
 * few times a minute; an instance asked for a pool it does not hold forwards the request to one
 * that does (server/agents/relay.ts). Entries expire on their own, so an instance that died stops
 * being chosen without anybody cleaning up after it.
 */

/** One agent as the other instances see it: enough to choose it, nothing that authenticates. */
export interface PublishedAgent {
  id: string;
  organizationId: number;
  pool: string;
  playwrightVersion: string;
  browsers: string[];
  maxSessions: number;
  activeSessions: number;
  draining: boolean;
}

export interface RelayInstance {
  id: string;
  /** Where the other instances reach this one: its own address, not the load balancer's. */
  url: string;
  agents: PublishedAgent[];
}

export interface RelayDirectory {
  /** Replaces what this instance published before, for `ttlMs`. */
  publish(instance: RelayInstance, ttlMs: number): Promise<void>;
  /** Every instance with an entry that has not expired, this one included. */
  instances(): Promise<RelayInstance[]>;
  withdraw(instanceId: string): Promise<void>;
}

/** For one process (and for tests of several relays in one process). */
export class MemoryRelayDirectory implements RelayDirectory {
  private readonly entries = new Map<string, { instance: RelayInstance; expiresAt: number }>();

  async publish(instance: RelayInstance, ttlMs: number) {
    this.entries.set(instance.id, { instance, expiresAt: Date.now() + ttlMs });
  }

  async instances() {
    const now = Date.now();
    return [...this.entries.values()].filter((e) => e.expiresAt > now).map((e) => e.instance);
  }

  async withdraw(instanceId: string) {
    this.entries.delete(instanceId);
  }
}

const PREFIX = 'wfm:agent-relay:instance:';

/** The shared one, in the Redis the queue already needs. */
export class RedisRelayDirectory implements RelayDirectory {
  constructor(private readonly redis: Redis) {}

  async publish(instance: RelayInstance, ttlMs: number) {
    await this.redis.set(PREFIX + instance.id, JSON.stringify(instance), 'PX', ttlMs);
  }

  async instances() {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', `${PREFIX}*`, 'COUNT', 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    if (keys.length === 0) return [];
    const values = await this.redis.mget(keys);
    return values.flatMap((value) => {
      if (!value) return [];
      try {
        return [JSON.parse(value) as RelayInstance];
      } catch {
        return [];
      }
    });
  }

  async withdraw(instanceId: string) {
    await this.redis.del(PREFIX + instanceId);
  }
}

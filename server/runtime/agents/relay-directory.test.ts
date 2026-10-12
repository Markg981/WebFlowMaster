import { describe, it, expect } from 'vitest';
import type { Redis } from 'ioredis';
import { RedisRelayDirectory, type RelayInstance } from './relay-directory';

/**
 * The Redis directory, against a stand-in that behaves like Redis where it matters: SCAN returns
 * its keys a page at a time, and an entry past its time is gone.
 */
function fakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const live = () => [...store].filter(([, e]) => e.expiresAt > Date.now()).map(([k]) => k);
  const client = {
    ttls: [] as number[],
    async set(key: string, value: string, _px: 'PX', ttl: number) {
      client.ttls.push(ttl);
      store.set(key, { value, expiresAt: Date.now() + ttl });
      return 'OK';
    },
    async scan(cursor: string, _match: 'MATCH', pattern: string, _count: 'COUNT', _n: number) {
      const prefix = pattern.replace(/\*$/, '');
      const keys = live().filter((k) => k.startsWith(prefix));
      const start = Number(cursor);
      const page = keys.slice(start, start + 2); // small pages, so the loop has to follow the cursor
      const next = start + 2 >= keys.length ? '0' : String(start + 2);
      return [next, page] as [string, string[]];
    },
    async mget(keys: string[]) {
      return keys.map((k) => store.get(k)?.value ?? null);
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
    corrupt(key: string) {
      store.set(key, { value: '{not json', expiresAt: Date.now() + 60_000 });
    },
    expire(key: string) {
      const entry = store.get(key);
      if (entry) entry.expiresAt = 0;
    },
  };
  return client;
}

const instance = (id: string): RelayInstance => ({ id, url: `http://${id}:5000`, agents: [] });

describe('RedisRelayDirectory', () => {
  it('lists every instance across SCAN pages, and skips what expired or cannot be read', async () => {
    const redis = fakeRedis();
    const directory = new RedisRelayDirectory(redis as unknown as Redis);
    for (const id of ['a', 'b', 'c', 'd', 'e']) await directory.publish(instance(id), 15_000);
    redis.expire('wfm:agent-relay:instance:d');
    redis.corrupt('wfm:agent-relay:instance:e');

    const ids = (await directory.instances()).map((i) => i.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(redis.ttls).toEqual([15_000, 15_000, 15_000, 15_000, 15_000]);
  });

  it('forgets an instance that withdraws', async () => {
    const redis = fakeRedis();
    const directory = new RedisRelayDirectory(redis as unknown as Redis);
    await directory.publish(instance('a'), 15_000);
    await directory.withdraw('a');
    expect(await directory.instances()).toEqual([]);
  });
});

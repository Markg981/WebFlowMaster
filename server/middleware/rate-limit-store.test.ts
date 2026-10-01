import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';
import { SharedRateLimitStore } from './rate-limit-store';

/**
 * Rate limits shared by every web process through Redis, and counted per process while Redis
 * does not answer (server/middleware/rate-limit-store.ts).
 */

/** Enough of Redis for the store: one counter per key with an expiry, evaluated as the script does. */
function fakeRedis() {
  const counters = new Map<string, { hits: number; expiresAt: number }>();
  const client = {
    status: 'ready' as string,
    hang: false,
    async eval(_script: string, _n: number, key: string, windowMs: string) {
      if (client.hang) return new Promise(() => undefined);
      const now = Date.now();
      const current = counters.get(key);
      const entry = current && current.expiresAt > now ? current : { hits: 0, expiresAt: now + Number(windowMs) };
      entry.hits += 1;
      counters.set(key, entry);
      return [entry.hits, entry.expiresAt - now];
    },
    async decr(key: string) {
      const entry = counters.get(key);
      if (entry) entry.hits -= 1;
      return entry?.hits ?? 0;
    },
    async del(key: string) {
      return counters.delete(key) ? 1 : 0;
    },
  };
  return { client, counters };
}

/** A "web process": its own express app and its own limiter, over the given Redis. */
function webProcess(redis: () => any, limit = 3) {
  const app = express();
  app.use(rateLimit({ windowMs: 60_000, limit, store: new SharedRateLimitStore('test', redis), standardHeaders: 'draft-7', legacyHeaders: false }));
  app.get('/', (_req, res) => res.send('ok'));
  return app;
}

describe('SharedRateLimitStore', () => {
  it('makes two web processes share one budget', async () => {
    const { client, counters } = fakeRedis();
    const a = webProcess(() => client);
    const b = webProcess(() => client);
    await request(a).get('/').expect(200);
    await request(b).get('/').expect(200);
    await request(a).get('/').expect(200);
    // The fourth request is over the limit of three, whichever process gets it.
    const refused = await request(b).get('/').expect(429);
    expect(refused.headers['retry-after']).toBeDefined();
    expect([...counters.keys()][0]).toMatch(/^ratelimit:test:/);
  });

  it('counts in this process alone while Redis is not ready, as before', async () => {
    const { client, counters } = fakeRedis();
    client.status = 'reconnecting';
    const a = webProcess(() => client, 2);
    const b = webProcess(() => client, 2);
    await request(a).get('/').expect(200);
    await request(a).get('/').expect(200);
    await request(a).get('/').expect(429);
    // The other process has its own count.
    await request(b).get('/').expect(200);
    expect(counters.size).toBe(0);
  });

  it('does not hold a request when Redis stops answering', async () => {
    const { client } = fakeRedis();
    client.hang = true;
    const started = Date.now();
    await request(webProcess(() => client)).get('/').expect(200);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('works with no Redis at all', async () => {
    await request(webProcess(() => null, 1)).get('/').expect(200);
  });
});

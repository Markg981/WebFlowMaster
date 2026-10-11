import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { healthRouter, readiness } from './health';

const app = (checks: Parameters<typeof healthRouter>[0], timeoutMs = 50) => express().use(healthRouter(checks, timeoutMs));
const never = () => new Promise(() => {});

describe('the health probes', () => {
  it('answers /healthz without touching any dependency', async () => {
    let touched = false;
    const res = await request(app({ database: () => { touched = true; } })).get('/healthz').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(touched).toBe(false);
  });

  it('is ready when every check passes', async () => {
    const res = await request(app({ database: async () => 1, redis: async () => 'PONG', sessions: () => true })).get('/readyz').expect(200);
    expect(res.body).toEqual({ status: 'ready', checks: { database: 'ok', redis: 'ok', sessions: 'ok' } });
  });

  it('answers 503 and names the failed check, without its error', async () => {
    const res = await request(app({
      database: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret'); },
      redis: async () => 'PONG',
    })).get('/readyz').expect(503);
    expect(res.body).toEqual({ status: 'not ready', checks: { database: 'failed', redis: 'ok' } });
    expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.5|secret|ECONNREFUSED/);
  });

  it('treats a check that does not answer in time as failed', async () => {
    const started = Date.now();
    const result = await readiness({ redis: never, database: async () => 1 }, 50);
    expect(result).toEqual({ ready: false, checks: { redis: 'failed', database: 'ok' } });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('treats false as a failed check', async () => {
    expect((await readiness({ sessions: () => false })).checks.sessions).toBe('failed');
  });
});

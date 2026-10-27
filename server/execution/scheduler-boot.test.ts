import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { healthRouter } from '../health';
import {
  startSchedulerWithRetry,
  schedulerReadiness,
  getSchedulerState,
  resetSchedulerState,
} from './scheduler-boot';

const app = () => express().use(healthRouter({ scheduler: schedulerReadiness }, 50));
const fast = { baseDelayMs: 1, maxDelayMs: 2 };

describe('scheduler boot', () => {
  beforeEach(resetSchedulerState);

  it('is 503 while initializing', async () => {
    const res = await request(app()).get('/readyz').expect(503);
    expect(res.body.checks.scheduler).toBe('failed');
  });

  it('stays 503 with the scheduler check failed once retries are exhausted; healthz stays 200', async () => {
    const init = vi.fn().mockRejectedValue(new Error('redis down'));
    const error = vi.fn();
    const st = await startSchedulerWithRetry(init, {
      ...fast,
      maxAttempts: 3,
      log: { info() {}, warn() {}, error },
    });
    expect(st).toBe('failed');
    expect(init).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledOnce();
    const res = await request(app()).get('/readyz').expect(503);
    expect(res.body).toEqual({ status: 'not ready', checks: { scheduler: 'failed' } });
    await request(app()).get('/healthz').expect(200);
  });

  it('becomes 200 when a retry succeeds', async () => {
    const init = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    await startSchedulerWithRetry(init, { ...fast, maxAttempts: 3 });
    expect(getSchedulerState()).toBe('ready');
    await request(app()).get('/readyz').expect(200);
  });
});

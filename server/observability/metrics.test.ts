import { describe, expect, it, vi } from 'vitest';
import { createMetrics, startMetricsServer } from './metrics';
import express from 'express';
import { createServer } from 'node:http';

describe('Prometheus telemetry', () => {
  it('bounds Redis work during an outage and returns 503 instead of stale metrics', async () => {
    const getJobCounts = vi.fn(() => new Promise<Record<string, number>>(() => {}));
    const listener = await startMetricsServer('worker', createMetrics(), [{ name: 'queue', getJobCounts }], {
      WFM_METRICS_ENABLED: 'true', WFM_METRICS_TOKEN: 'test-token', WFM_METRICS_PORT: '0',
    });
    try {
      const url = `http://127.0.0.1:${listener!.port}/metrics`;
      const options = { headers: { Authorization: 'Bearer test-token' } };
      const responses = await Promise.all([fetch(url, options), fetch(url, options)]);
      expect(responses.map(r => r.status)).toEqual([503, 503]);
      expect(getJobCounts).toHaveBeenCalledTimes(1);
    } finally { await listener!.close(); }
  });
  it('records route templates without leaking URL tokens into metric labels', async () => {
    process.env.WFM_METRICS_ENABLED = 'true';
    const metrics = createMetrics();
    const app = express();
    app.use(metrics.middleware);
    app.get('/secret/:token', (_req, res) => res.sendStatus(500));
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/secret/private-value`);
      const text = await metrics.registry.metrics();
      expect(text).toContain('route="/secret/:token",status="500"');
      expect(text).not.toContain('private-value');
    } finally {
      delete process.env.WFM_METRICS_ENABLED;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('collects aggregate local agent capacity and resets it after disconnect', async () => {
    const metrics = createMetrics();
    let snapshot = { connected: 2, capacity: 4, active: 3 };
    metrics.setAgentSnapshot(() => snapshot);
    expect(await metrics.registry.metrics()).toContain('wfm_agent_active_sessions 3');
    snapshot = { connected: 0, capacity: 0, active: 0 };
    expect(await metrics.registry.metrics()).toContain('wfm_agent_capacity 0');
  });
  it('records wait, duration, failures and restores active capacity after errors', async () => {
    const metrics = createMetrics();
    const fail = new Error('secret');
    await expect(metrics.job('test-execution-queue', { name: 'execute-plan', timestamp: Date.now() - 1000, data: {} }, async () => { throw fail; })).rejects.toBe(fail);
    const text = await metrics.registry.metrics();
    expect(text).toContain('wfm_job_wait_seconds_count{queue="test-execution-queue",job="execute-plan"} 1');
    expect(text).toContain('wfm_jobs_total{queue="test-execution-queue",job="execute-plan",outcome="error"} 1');
    expect(text).toContain('wfm_worker_active_jobs{queue="test-execution-queue"} 0');
    expect(text).not.toContain('secret');
  });

  it('treats BullMQ delay as deferral, not failure, and caps unknown job labels', async () => {
    const metrics = createMetrics();
    const error = Object.assign(new Error(), { name: 'DelayedError' });
    await expect(metrics.job('test-execution-queue', { name: 'user-controlled', data: {} }, async () => { throw error; })).rejects.toBe(error);
    expect(await metrics.registry.metrics()).toContain('job="other",outcome="deferred"');
  });

  it('disables the listener by default and requires a bearer token when enabled', async () => {
    expect(await startMetricsServer('api', createMetrics(), [], {})).toBeUndefined();
    await expect(startMetricsServer('api', createMetrics(), [], { WFM_METRICS_ENABLED: 'true' })).rejects.toThrow('WFM_METRICS_TOKEN');
    const listener = await startMetricsServer('api', createMetrics(), [], {
      WFM_METRICS_ENABLED: 'true', WFM_METRICS_TOKEN: 'test-token', WFM_METRICS_PORT: '0',
    });
    try {
      const url = `http://127.0.0.1:${listener!.port}/metrics`;
      expect((await fetch(url)).status).toBe(401);
      const response = await fetch(url, { headers: { Authorization: 'Bearer test-token' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(await response.text()).toContain('wfm_');
    } finally { await listener!.close(); }
  });
});

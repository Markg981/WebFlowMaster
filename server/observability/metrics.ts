import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Registry, Histogram, Counter, Gauge, collectDefaultMetrics } from 'prom-client';
import type { RequestHandler } from 'express';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { beginSpan, withSpan, type TraceCarrier } from '../../shared/telemetry';

const JOBS = new Set(['execute-plan', 'execute-shard', 'trigger-schedule', 'adhoc-sequence', 'debug-sequence', 'run-test', 'load-website', 'detect-elements']);
export interface MetricJob { name: string; timestamp?: number; processedOn?: number; data: { traceContext?: TraceCarrier }; }
export interface MetricQueue { name: string; getJobCounts(...states: string[]): Promise<Record<string, number>>; }

export function createMetrics() {
  const registry = new Registry();
  let agentSnapshot = () => ({ connected: 0, capacity: 0, active: 0 });
  for (const [suffix, key, help] of [
    ['connected', 'connected', 'Agents connected to this relay instance'],
    ['capacity', 'capacity', 'Session slots offered by non-draining agents on this instance'],
    ['active_sessions', 'active', 'Sessions lent by agents connected to this instance'],
  ] as const) {
    new Gauge({ name: `wfm_agent_${suffix}`, help, registers: [registry], collect() { this.set(agentSnapshot()[key]); } });
  }
  const http = new Histogram({ name: 'wfm_http_duration_seconds', help: 'HTTP request duration', labelNames: ['method', 'route', 'status'], registers: [registry] });
  const wait = new Histogram({ name: 'wfm_job_wait_seconds', help: 'Job age when taken by a worker, including delays and retries', labelNames: ['queue', 'job'], buckets: [0.1, 1, 5, 10, 30, 60, 300, 1800], registers: [registry] });
  const duration = new Histogram({ name: 'wfm_job_duration_seconds', help: 'Duration of a worker processing attempt', labelNames: ['queue', 'job'], buckets: [0.1, 1, 5, 10, 30, 60, 300, 1800], registers: [registry] });
  const jobs = new Counter({ name: 'wfm_jobs_total', help: 'Worker attempt outcomes', labelNames: ['queue', 'job', 'outcome'], registers: [registry] });
  const active = new Gauge({ name: 'wfm_worker_active_jobs', help: 'Jobs in hand on this worker', labelNames: ['queue'], registers: [registry] });
  const capacity = new Gauge({ name: 'wfm_worker_capacity', help: 'Configured concurrency on this worker', labelNames: ['queue'], registers: [registry] });
  const depth = new Gauge({ name: 'wfm_queue_jobs', help: 'Global queue depth (duplicate across scrapers; do not sum replicas)', labelNames: ['queue', 'state'], registers: [registry] });
  const enabled = () => process.env.WFM_METRICS_ENABLED === 'true';
  const middleware: RequestHandler = (req, res, next) => {
    if (!enabled() && process.env.WFM_TRACING_ENABLED !== 'true') return next();
    const started = performance.now();
    const incoming = { traceparent: typeof req.headers.traceparent === 'string' ? req.headers.traceparent : undefined, tracestate: typeof req.headers.tracestate === 'string' ? req.headers.tracestate : undefined };
    const scope = beginSpan('http.request', SpanKind.SERVER, incoming);
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      // Express route templates only: raw paths can contain tokens or unbounded IDs.
      const route = typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(req.method) ? req.method : 'OTHER';
      if (enabled()) http.observe({ method, route, status: String(res.statusCode) }, (performance.now() - started) / 1000);
      scope.span.updateName(`${method} ${route}`);
      scope.span.setAttributes({ 'http.request.method': method, 'http.route': route, 'http.response.status_code': res.statusCode });
      if (res.statusCode >= 500 || !res.writableFinished) scope.span.setStatus({ code: SpanStatusCode.ERROR });
      scope.span.end();
    };
    res.once('finish', finish);
    res.once('close', finish);
    scope.run(next);
  };
  async function job<T>(queue: string, input: MetricJob, fn: () => Promise<T>): Promise<T> {
    const labels = { queue, job: JOBS.has(input.name) ? input.name : 'other' };
    active.inc({ queue });
    if (input.timestamp) wait.observe(labels, Math.max(0, ((input.processedOn ?? Date.now()) - input.timestamp) / 1000));
    const started = performance.now();
    try {
      const result = await withSpan(`queue.${labels.job}`, SpanKind.CONSUMER, input.data.traceContext ?? {}, fn);
      jobs.inc({ ...labels, outcome: 'success' });
      return result;
    } catch (error) {
      jobs.inc({ ...labels, outcome: (error as Error)?.name === 'DelayedError' ? 'deferred' : 'error' });
      throw error;
    } finally { active.dec({ queue }); duration.observe(labels, (performance.now() - started) / 1000); }
  }
  return { registry, middleware, job, capacity, active, depth, setAgentSnapshot: (read: typeof agentSnapshot) => { agentSnapshot = read; } };
}

export const applicationMetrics = createMetrics();

export function instrumentJob<T>(queue: string, job: MetricJob, fn: () => Promise<T>): Promise<T> {
  if (process.env.WFM_METRICS_ENABLED !== 'true' && process.env.WFM_TRACING_ENABLED !== 'true') return fn();
  return applicationMetrics.job(queue, job, fn);
}

export async function startMetricsServer(role: 'api' | 'worker', metrics: ReturnType<typeof createMetrics>, queues: MetricQueue[], env: NodeJS.ProcessEnv = process.env) {
  if (env.WFM_METRICS_ENABLED !== 'true') return undefined;
  const token = env.WFM_METRICS_TOKEN;
  if (!token) throw new Error('WFM_METRICS_TOKEN is required when metrics are enabled.');
  const port = Number(env.WFM_METRICS_PORT ?? (role === 'api' ? 9464 : 9465));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('WFM_METRICS_PORT must be a valid TCP port.');
  collectDefaultMetrics({ register: metrics.registry, prefix: 'wfm_' });
  // One in-flight Redis poll per listener. ioredis may retain commands until recovery;
  // a scrape timeout must not cause the next scrape to add another pending poll.
  let pendingPoll: Promise<void[]> | undefined;
  function pollQueues() {
    if (!pendingPoll) {
      pendingPoll = Promise.all(queues.map(async queue => {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'prioritized', 'paused');
        for (const state of ['waiting', 'active', 'delayed', 'failed', 'prioritized', 'paused']) metrics.depth.set({ queue: queue.name, state }, counts[state] ?? 0);
      }));
      const poll = pendingPoll;
      const clear = () => { if (pendingPoll === poll) pendingPoll = undefined; };
      void poll.then(clear, clear);
    }
    return pendingPoll;
  }
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') { res.writeHead(404).end(); return; }
    const given = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) { res.writeHead(401).end(); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        pollQueues(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('scrape timeout')), 3000); }),
      ]);
      res.writeHead(200, { 'Content-Type': metrics.registry.contentType, 'Cache-Control': 'no-store' }).end(await metrics.registry.metrics());
    } catch { res.writeHead(503).end('Metrics unavailable'); }
    finally { clearTimeout(timer); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, env.WFM_METRICS_HOST || '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
  return { port: (server.address() as { port: number }).port, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

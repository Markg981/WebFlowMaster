import { afterAll, expect, it, vi } from 'vitest';
import { SpanKind } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { captureTrace, startTracing, withSpan } from '../../shared/telemetry';
import { signTicket, verifyTicket } from '../agents/agent-credentials';

// Redis persistence is a boundary here; inspect exactly the envelope the real Queue receives.
const add = vi.hoisted(() => vi.fn(async (_name: string, data: any, _options: unknown) => ({ data })));
vi.mock('bullmq', () => ({ Queue: class { add(name: string, data: any, options: unknown) { return add(name, data, options); } } }));
const { TracedQueue } = await import('./queue');
const exporter = new InMemorySpanExporter();
afterAll(startTracing('test', { WFM_TRACING_ENABLED: 'true' }, exporter));

it('overwrites stale queue context and puts the producer span in the persisted envelope', async () => {
  const queue = new TracedQueue('test-execution-queue');
  await withSpan('request', SpanKind.SERVER, {}, async () => {
    const api = captureTrace();
    const job = await queue.add('execute-plan', { planId: 1, traceContext: { traceparent: 'stale' } }, { jobId: 'job-1' });
    expect(job.data.planId).toBe(1);
    expect(job.data.traceContext.traceparent).not.toBe(api.traceparent);
    expect(job.data.traceContext.traceparent.split('-')[1]).toBe(api.traceparent.split('-')[1]);
    expect(add).toHaveBeenCalledWith('execute-plan', job.data, { jobId: 'job-1' });
  });
});

it('carries the active trace through an authenticated agent ticket', async () => {
  await withSpan('worker', SpanKind.CONSUMER, {}, async () => {
    const traceContext = captureTrace();
    const ticket = signTicket({ organizationId: 1, pool: 'local', engine: 'chromium', headless: true, playwrightVersion: '1.0.0' }, 'secret');
    const verified = verifyTicket(ticket, 'secret');
    expect(verified).not.toHaveProperty('error');
    expect(verified).toHaveProperty('traceContext', traceContext);
  });
});

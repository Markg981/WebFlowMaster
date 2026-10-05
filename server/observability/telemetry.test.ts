import { afterAll, describe, expect, it } from 'vitest';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { SpanKind } from '@opentelemetry/api';
import { captureTrace, startTracing, withSpan } from '../../shared/telemetry';

const exporter = new InMemorySpanExporter();
const stop = startTracing('test', { WFM_TRACING_ENABLED: 'true' }, exporter);
afterAll(stop);

describe('distributed tracing', () => {
  it('continues the API trace through a serialized queue or agent carrier', async () => {
    let carrier: Record<string, string> = {};
    await withSpan('api', SpanKind.SERVER, undefined, async () => { carrier = captureTrace(); });
    await withSpan('worker', SpanKind.CONSUMER, JSON.parse(JSON.stringify(carrier)), async () => {
      await Promise.resolve();
      await withSpan('agent', SpanKind.CLIENT, undefined, async () => {});
    });
    const spans = exporter.getFinishedSpans();
    const api = spans.find(s => s.name === 'api')!;
    const worker = spans.find(s => s.name === 'worker')!;
    const agent = spans.find(s => s.name === 'agent')!;
    expect(carrier.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    expect(worker.spanContext().traceId).toBe(api.spanContext().traceId);
    expect(worker.parentSpanContext?.spanId).toBe(api.spanContext().spanId);
    expect(agent.parentSpanContext?.spanId).toBe(worker.spanContext().spanId);
    expect(carrier).not.toHaveProperty('baggage');
  });

  it('ignores malformed carriers and preserves errors without exporting their secrets', async () => {
    const error = new Error('password=secret');
    await expect(withSpan('failure', SpanKind.CONSUMER, { traceparent: 'invalid' }, async () => { throw error; })).rejects.toBe(error);
    const span = exporter.getFinishedSpans().find(s => s.name === 'failure')!;
    expect(span.status.code).toBe(2);
    expect(JSON.stringify(span.events)).not.toContain('secret');
    expect(span.parentSpanContext).toBeUndefined();
  });
});

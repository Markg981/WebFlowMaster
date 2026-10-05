/** Node-only tracing shared by API, workers and the standalone local agent. */
import { context, trace, ROOT_CONTEXT, SpanKind, SpanStatusCode, isSpanContextValid, type Span, type Context, defaultTextMapGetter, defaultTextMapSetter } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor, SimpleSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

export type TraceCarrier = { traceparent?: string; tracestate?: string };
const propagator = new W3CTraceContextPropagator();
let provider: NodeTracerProvider | undefined;

export function startTracing(role: string, env: NodeJS.ProcessEnv = process.env, exporter?: SpanExporter): () => Promise<void> {
  if (env.WFM_TRACING_ENABLED !== 'true' || provider) return async () => {};
  const ratio = Number(env.WFM_TRACE_SAMPLE_RATIO ?? '0.1');
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error('WFM_TRACE_SAMPLE_RATIO must be between 0 and 1.');
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': env.OTEL_SERVICE_NAME || `webflowmaster-${role}` }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(exporter ? 1 : ratio) }),
    spanProcessors: [exporter ? new SimpleSpanProcessor(exporter) : new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register({ propagator });
  const started = provider;
  return async () => { await started.shutdown(); provider = undefined; };
}

/** Only W3C trace fields cross trust/process boundaries; never application baggage. */
export function captureTrace(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagator.inject(context.active(), carrier, defaultTextMapSetter);
  return carrier;
}

function parentContext(carrier?: TraceCarrier): Context {
  if (!carrier) return context.active();
  const bounded: TraceCarrier = {};
  if (typeof carrier.traceparent === 'string' && carrier.traceparent.length <= 55) bounded.traceparent = carrier.traceparent;
  if (typeof carrier.tracestate === 'string' && carrier.tracestate.length <= 512) bounded.tracestate = carrier.tracestate;
  return propagator.extract(ROOT_CONTEXT, bounded, defaultTextMapGetter);
}

export function beginSpan(name: string, kind: SpanKind, carrier?: TraceCarrier): { span: Span; run: <T>(fn: () => T) => T } {
  const parent = parentContext(carrier);
  const span = trace.getTracer('webflowmaster').startSpan(name, { kind }, parent);
  return { span, run: fn => context.with(trace.setSpan(parent, span), fn) };
}

export async function withSpan<T>(name: string, kind: SpanKind, carrier: TraceCarrier | undefined, fn: () => Promise<T>): Promise<T> {
  const scope = beginSpan(name, kind, carrier);
  return scope.run(async () => {
    try { return await fn(); }
    catch (error) {
      // Exceptions and messages can contain target URLs, credentials or test data.
      if ((error as Error)?.name !== 'DelayedError') scope.span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally { scope.span.end(); }
  });
}

export function traceLogFields(): Record<string, string> {
  const span = trace.getActiveSpan()?.spanContext();
  return span && isSpanContextValid(span) ? { traceId: span.traceId, spanId: span.spanId } : {};
}

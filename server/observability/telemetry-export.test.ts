import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { SpanKind } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { startTracing, withSpan } from '../../shared/telemetry';

it('delivers an OTLP JSON span to an HTTP receiver and flushes on shutdown', async () => {
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      expect(req.url).toBe('/v1/traces');
      expect(req.headers['content-type']).toContain('application/json');
      bodies.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const stop = startTracing('worker', { WFM_TRACING_ENABLED: 'true' }, new OTLPTraceExporter({ url: `http://127.0.0.1:${port}/v1/traces` }));
  try {
    await withSpan('queue.execute-plan', SpanKind.CONSUMER, {}, async () => {});
    await stop();
    expect(bodies).toHaveLength(1);
    const payload = JSON.parse(bodies[0]);
    expect(payload.resourceSpans[0].scopeSpans[0].spans[0].name).toBe('queue.execute-plan');
    expect(payload.resourceSpans[0].resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'webflowmaster-worker' } });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

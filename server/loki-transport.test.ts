import { describe, it, expect, vi, afterEach } from 'vitest';
import winston from 'winston';
import { LokiTransport } from './loki-transport';

const transports: LokiTransport[] = [];
afterEach(() => transports.splice(0).forEach((t) => t.close()));

function setup(responses: Array<Response | Error>) {
  const pushes: any[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    pushes.push(JSON.parse(String(init.body)));
    const next = responses.shift() ?? new Response(null, { status: 204 });
    if (next instanceof Error) throw next;
    return next;
  });
  const report = vi.fn();
  const transport = new LokiTransport({
    host: 'http://loki:3100/',
    labels: { app: 'webflowmaster', service: 'webflowmaster-api' },
    fetch: fetch as unknown as typeof globalThis.fetch,
    report,
  });
  transports.push(transport);
  const logger = winston.createLogger({
    format: winston.format.combine(winston.format((info) => ({ ...info, service: 'webflowmaster-api' }))(), winston.format.json()),
    transports: [transport],
  });
  return { transport, logger, fetch, pushes, report };
}

// winston hands the entry to the transport on a later tick.
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('the Loki transport', () => {
  it('pushes [timestamp, line] pairs, with nothing Loki would read as structured metadata', async () => {
    const { transport, logger, fetch, pushes } = setup([]);
    logger.info('Request completed', { statusCode: 401, correlationId: 'abc' });
    await settle();
    await transport.flush();

    expect(fetch).toHaveBeenCalledWith('http://loki:3100/loki/api/v1/push', expect.anything());
    const [stream] = pushes[0].streams;
    expect(stream.stream).toEqual({ app: 'webflowmaster', service: 'webflowmaster-api', level: 'info' });
    expect(stream.values).toHaveLength(1);
    const value = stream.values[0];
    expect(value).toHaveLength(2);
    expect(value[0]).toMatch(/^\d{19}$/);
    // The fields stay in the line, for `| json` to find.
    expect(JSON.parse(value[1])).toMatchObject({ message: 'Request completed', statusCode: 401, correlationId: 'abc' });
  });

  it('says so when Loki refuses a push, once, and again when it recovers', async () => {
    const { transport, logger, report } = setup([
      new Response('structured metadata is disallowed', { status: 400 }),
      new Response('still no', { status: 400 }),
    ]);
    for (let i = 0; i < 3; i++) {
      logger.info(`line ${i}`);
      await settle();
      await transport.flush();
    }

    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[0][0]).toContain('HTTP 400: structured metadata is disallowed');
    expect(report.mock.calls[1][0]).toContain('again');
  });

  it('keeps the lines for the next push when Loki cannot be reached', async () => {
    const { transport, logger, pushes } = setup([new Error('ECONNREFUSED')]);
    logger.info('first');
    await settle();
    await transport.flush();
    logger.info('second');
    await settle();
    await transport.flush();

    const lines = pushes[1].streams[0].values.map((v: string[]) => JSON.parse(v[1]).message);
    expect(lines).toEqual(['first', 'second']);
  });

  it('does not retry a push Loki rejected as malformed', async () => {
    const { transport, logger, pushes } = setup([new Response('bad', { status: 400 })]);
    logger.info('rejected');
    await settle();
    await transport.flush();
    logger.info('next');
    await settle();
    await transport.flush();

    expect(pushes[1].streams[0].values.map((v: string[]) => JSON.parse(v[1]).message)).toEqual(['next']);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { runApiRequest } from './api-test-runner';

/**
 * Executing an API test for real.
 *
 * `runTest`'s API branch was `const success = Math.random() > 0.2` under a TODO — so every
 * API test inside a test plan reported a fabricated result at an 80% pass rate, with the
 * failure message "Simulated API test failure". A scheduled plan containing API tests
 * produced a report that looked exactly like a real one and meant nothing, which is worse
 * than having no coverage: nobody goes looking for coverage they know they lack.
 *
 * The request-building and assertion logic existed, but only inside the
 * /api/proxy-api-request route handler, where nothing else could reach it.
 */

let server: http.Server;
let baseUrl: string;
let received: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: string }>;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });

      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/orders' && req.method === 'POST') {
        res
          .writeHead(201, { 'Content-Type': 'application/json', 'x-request-id': 'req-99' })
          .end(JSON.stringify({ id: 4711, status: 'confirmed', lines: [{ sku: 'A' }] }));
        return;
      }
      if (url.pathname === '/boom') {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"nope"}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
});

const assertion = (over: Record<string, unknown>) => ({
  id: '00000000-0000-4000-8000-000000000000',
  source: 'status_code',
  comparison: 'equals',
  targetValue: '200',
  enabled: true,
  ...over,
});

describe('runApiRequest', () => {
  it('actually sends the request', async () => {
    const result = await runApiRequest(
      {
        method: 'POST',
        url: `${baseUrl}/orders`,
        headers: { 'X-Caller': 'wfm' },
        body: { sku: 'A', qty: 2 },
        assertions: [assertion({ targetValue: '201' })],
      },
      {},
    );

    // The point of the whole thing: a request left the process.
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe('POST');
    expect(received[0].url).toBe('/orders');
    expect(received[0].headers['x-caller']).toBe('wfm');
    expect(JSON.parse(received[0].body)).toEqual({ sku: 'A', qty: 2 });
    expect(result.status).toBe(201);
    expect(result.passed).toBe(true);
  }, 30_000);

  it('fails when an assertion does not hold, every time', async () => {
    // Five runs, because the behaviour being replaced passed four times out of five at
    // random. A single red result would not tell the two apart.
    for (let i = 0; i < 5; i++) {
      const result = await runApiRequest(
        { method: 'GET', url: `${baseUrl}/boom`, assertions: [assertion({ targetValue: '200' })] },
        {},
      );
      expect(result.passed).toBe(false);
      expect(result.assertions[0].pass).toBe(false);
      expect(result.assertions[0].actualValue).toBe(500);
    }
  }, 60_000);

  it('resolves {{variables}} in the url, the query, the headers and the body', async () => {
    const result = await runApiRequest(
      {
        method: 'POST',
        url: '{{baseUrl}}/orders',
        queryParams: { site: '{{site}}' },
        headers: { Authorization: 'Bearer {{token}}' },
        body: { sku: '{{sku}}' },
        assertions: [assertion({ targetValue: '201' })],
      },
      { baseUrl, site: 'henniez', token: 'abc123', sku: 'A' },
    );

    expect(result.passed).toBe(true);
    expect(received[0].url).toBe('/orders?site=henniez');
    expect(received[0].headers.authorization).toBe('Bearer abc123');
    expect(JSON.parse(received[0].body)).toEqual({ sku: 'A' });
  }, 30_000);

  it('reports a name it could not resolve instead of sending it literally', async () => {
    const result = await runApiRequest(
      { method: 'GET', url: '{{missingHost}}/orders', assertions: [] },
      {},
    );

    expect(received).toHaveLength(0);
    expect(result.passed).toBe(false);
    expect(result.error).toContain('missingHost');
  }, 30_000);

  it('treats an unreachable host as a failed test, not a thrown error', async () => {
    const result = await runApiRequest(
      { method: 'GET', url: 'http://127.0.0.1:1/nothing', assertions: [] },
      {},
    );

    expect(result.passed).toBe(false);
    expect(result.error).toBeTruthy();
  }, 30_000);

  it('passes a test with no assertions as long as the request succeeded', async () => {
    const result = await runApiRequest({ method: 'GET', url: `${baseUrl}/ping` }, {});

    expect(received).toHaveLength(1);
    expect(result.passed).toBe(true);
  }, 30_000);
});

describe('extracting values for the next request', () => {
  it('captures from the body, the headers and the status', async () => {
    const result = await runApiRequest(
      {
        method: 'POST',
        url: `${baseUrl}/orders`,
        body: { sku: 'A' },
        extractions: [
          { id: 'e1', name: 'orderId', source: 'body_json_path', property: 'id' },
          { id: 'e2', name: 'requestId', source: 'header', property: 'x-request-id' },
          { id: 'e3', name: 'createdStatus', source: 'status_code' },
          { id: 'e4', name: 'firstSku', source: 'body_json_path', property: 'lines[0].sku' },
        ],
      },
      {},
    );

    // Without this there is no way to test a flow: authenticate, create, read back, delete.
    // Only isolated endpoints, which is not what anyone means by an API test.
    expect(result.extracted).toEqual({
      orderId: '4711',
      requestId: 'req-99',
      createdStatus: '201',
      firstSku: 'A',
    });
  }, 30_000);

  it('reports an extraction that found nothing rather than capturing undefined', async () => {
    const result = await runApiRequest(
      {
        method: 'GET',
        url: `${baseUrl}/ping`,
        extractions: [{ id: 'e1', name: 'missing', source: 'body_json_path', property: 'nope.deep' }],
      },
      {},
    );

    // A silently absent variable becomes a literal `{{missing}}` in the next request, which
    // fails somewhere else entirely and takes the reader with it.
    expect(result.extracted.missing).toBeUndefined();
    expect(result.extractionErrors).toContainEqual(
      expect.objectContaining({ name: 'missing' }),
    );
  }, 30_000);
});

describe('the authentication a saved test carries', () => {
  it('applies basic auth', async () => {
    await runApiRequest(
      {
        method: 'GET',
        url: `${baseUrl}/ping`,
        auth: { type: 'basic', params: { username: 'svc', password: 'hunter2' } },
      },
      {},
    );

    // The API Tester page built this header in the browser, so a saved test's own auth
    // settings were simply ignored once a plan ran it — the request went out anonymous and
    // the test failed for a reason that had nothing to do with what it checked.
    const expected = 'Basic ' + Buffer.from('svc:hunter2').toString('base64');
    expect(received[0].headers.authorization).toBe(expected);
  }, 30_000);

  it('applies a bearer token, resolving a variable in it', async () => {
    await runApiRequest(
      {
        method: 'GET',
        url: `${baseUrl}/ping`,
        auth: { type: 'bearer', params: { token: '{{token}}' } },
      },
      { token: 'tok-from-an-earlier-request' },
    );

    // The token usually comes from an earlier request in the plan, so it has to go through
    // the same substitution as everything else.
    expect(received[0].headers.authorization).toBe('Bearer tok-from-an-earlier-request');
  }, 30_000);

  it('puts an api key in a header or in the query, as configured', async () => {
    await runApiRequest(
      {
        method: 'GET',
        url: `${baseUrl}/ping`,
        auth: { type: 'apiKey', params: { key: 'X-Api-Key', value: 'k-1', addTo: 'header' } },
      },
      {},
    );
    expect(received[0].headers['x-api-key']).toBe('k-1');

    received = [];
    await runApiRequest(
      {
        method: 'GET',
        url: `${baseUrl}/ping`,
        auth: { type: 'apiKey', params: { key: 'api_key', value: 'k-2', addTo: 'query' } },
      },
      {},
    );
    expect(received[0].url).toBe('/ping?api_key=k-2');
  }, 30_000);

  it('leaves an explicit Authorization header alone', async () => {
    await runApiRequest(
      {
        method: 'GET',
        url: `${baseUrl}/ping`,
        headers: { Authorization: 'Bearer written-by-hand' },
        auth: { type: 'basic', params: { username: 'svc', password: 'x' } },
      },
      {},
    );

    // A header the tester wrote is more specific than a setting on the test, and silently
    // overwriting it would make a deliberate override look broken.
    expect(received[0].headers.authorization).toBe('Bearer written-by-hand');
  }, 30_000);

  it('sends nothing extra for none or for an unimplemented scheme', async () => {
    for (const type of ['none', 'inherit', 'oauth2', 'ntlm'] as const) {
      received = [];
      await runApiRequest(
        { method: 'GET', url: `${baseUrl}/ping`, auth: { type } as never },
        {},
      );
      expect(received[0].headers.authorization).toBeUndefined();
    }
  }, 30_000);
});

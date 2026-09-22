import { describe, it, expect, vi } from 'vitest';
import { runPreconditions } from './precondition-runner';
import type { Precondition } from '@shared/schema';

const pc = (over: Partial<Precondition>): Precondition => ({
  id: 'p1',
  name: 'setup',
  method: 'POST',
  url: '{{baseUrl}}/api/NetContentScale/SaveCheck',
  queryParams: null,
  requestHeaders: null,
  requestBody: null,
  sourceApiTestId: null,
  ...over,
});

const okResponse = { ok: true, status: 200 } as Response;
const badResponse = (status: number) => ({ ok: false, status } as Response);

describe('runPreconditions', () => {
  it('returns ok with ranCount 0 for empty/null preconditions', async () => {
    const fetchImpl = vi.fn();
    const empty = { ok: true, ranCount: 0, satisfiedCount: 0, steps: [] };
    expect(await runPreconditions(null, {}, fetchImpl as any)).toEqual(empty);
    expect(await runPreconditions([], {}, fetchImpl as any)).toEqual(empty);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('runs each precondition and substitutes {{baseUrl}} + query params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse);
    const result = await runPreconditions(
      [pc({ queryParams: [{ key: 'equipmentRowId', value: '42', enabled: true }] })],
      { baseUrl: 'http://localhost:7000' },
      fetchImpl as any,
    );
    expect(result).toMatchObject({ ok: true, ranCount: 1, satisfiedCount: 0 });
    // With no check declared, the call runs — which is what every precondition written
    // before checks existed keeps doing.
    expect(result.steps).toEqual([{ name: 'setup', status: 'applied', detail: expect.any(String) }]);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:7000/api/NetContentScale/SaveCheck?equipmentRowId=42');
    expect(opts.method).toBe('POST');
  });

  it('fails fast on a non-2xx response and reports which precondition failed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse)
      .mockResolvedValueOnce(badResponse(500))
      .mockResolvedValueOnce(okResponse);
    const result = await runPreconditions(
      [pc({ name: 'first' }), pc({ name: 'second' }), pc({ name: 'third' })],
      { baseUrl: 'http://h' },
      fetchImpl as any,
    );
    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe('second');
    expect(result.reason).toMatch(/HTTP 500/);
    expect(result.ranCount).toBe(2); // stopped, did not run 'third'
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports a network error as a failed precondition', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await runPreconditions([pc({ name: 'setup' })], { baseUrl: 'http://h' }, fetchImpl as any);
    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe('setup');
    expect(result.reason).toMatch(/ECONNREFUSED/);
  });

  it('sends a JSON body with content-type for non-GET requests', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse);
    await runPreconditions(
      [pc({ method: 'POST', requestBody: { weight: 100 }, url: 'http://h/api/x' })],
      {},
      fetchImpl as any,
    );
    const [, opts] = fetchImpl.mock.calls[0];
    expect(opts.body).toBe('{"weight":100}');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });
});

/**
 * A precondition that is already satisfied.
 *
 * A precondition states a starting point, not an operation. The runner always performed the
 * operation, so running a test twice — or running it against a system someone had already
 * set up — either wasted the call or, on an API that refuses duplicates, failed the test
 * with "Precondition failed: HTTP 409" for a state that was in fact exactly as required.
 */
const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as Response;

describe('a precondition that is already satisfied', () => {
  it('skips the setup call when the check says the state is there', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { functions: { netContentMachine: true } }));

    const result = await runPreconditions(
      [
        pc({
          name: 'enable NetContentMachine',
          check: {
            url: 'http://h/api/machines/42',
            jsonPath: 'functions.netContentMachine',
            equals: true,
          },
        }),
      ],
      {},
      fetchImpl as any,
    );

    expect(result.ok).toBe(true);
    expect(result.satisfiedCount).toBe(1);
    expect(result.ranCount).toBe(0);
    // One call, and it was the question — never the change.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://h/api/machines/42');
    expect(result.steps[0]).toMatchObject({ status: 'satisfied' });
  });

  it('runs the setup call when the check says the state is not there', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { functions: { netContentMachine: false } }))
      .mockResolvedValueOnce(okResponse);

    const result = await runPreconditions(
      [
        pc({
          url: 'http://h/api/enable',
          check: {
            url: 'http://h/api/machines/42',
            jsonPath: 'functions.netContentMachine',
            equals: true,
          },
        }),
      ],
      {},
      fetchImpl as any,
    );

    expect(result).toMatchObject({ ok: true, ranCount: 1, satisfiedCount: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe('http://h/api/enable');
  });

  it('does the setup when the check itself cannot be carried out', async () => {
    // "I could not establish that it is already done" is not "it is already done". Doing the
    // setup then fails, or does not, on its own terms — which is a better thing to read in a
    // report than a complaint about a probe.
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(okResponse);

    const result = await runPreconditions(
      [pc({ url: 'http://h/api/enable', check: { url: 'http://h/api/machines/42' } })],
      {},
      fetchImpl as any,
    );

    expect(result).toMatchObject({ ok: true, ranCount: 1, satisfiedCount: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not treat a missing json path as satisfied', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { functions: {} }))
      .mockResolvedValueOnce(okResponse);

    const result = await runPreconditions(
      [
        pc({
          url: 'http://h/api/enable',
          check: { url: 'http://h/api/machines/42', jsonPath: 'functions.netContentMachine' },
        }),
      ],
      {},
      fetchImpl as any,
    );

    expect(result.ranCount).toBe(1);
  });

  it('reads a status-only check', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, {}));

    const result = await runPreconditions(
      [pc({ check: { url: 'http://h/api/orders/4711' } })],
      {},
      fetchImpl as any,
    );

    expect(result.satisfiedCount).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts a status the author named, such as 404 meaning "not there yet"', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(404, {}));

    const result = await runPreconditions(
      [pc({ check: { url: 'http://h/api/orders/4711', expectStatus: [404] } })],
      {},
      fetchImpl as any,
    );

    expect(result.satisfiedCount).toBe(1);
  });

  it('counts a 409 from the setup call as satisfied when the author said so', async () => {
    // The shape most create endpoints have. Reporting this as a failed precondition sends
    // whoever reads the run looking for a problem that is not there.
    const fetchImpl = vi.fn().mockResolvedValueOnce(badResponse(409));

    const result = await runPreconditions(
      [pc({ name: 'create order', url: 'http://h/api/orders', satisfiedStatuses: [409] })],
      {},
      fetchImpl as any,
    );

    expect(result.ok).toBe(true);
    expect(result.satisfiedCount).toBe(1);
    expect(result.ranCount).toBe(0);
    expect(result.steps[0]).toMatchObject({ name: 'create order', status: 'satisfied' });
  });

  it('still fails on a status the author did not name', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(badResponse(500));

    const result = await runPreconditions(
      [pc({ name: 'create order', url: 'http://h/api/orders', satisfiedStatuses: [409] })],
      {},
      fetchImpl as any,
    );

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe('create order');
    expect(result.reason).toMatch(/HTTP 500/);
  });

  it('resolves variables inside the check', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, { state: 'OPEN' }));

    const result = await runPreconditions(
      [
        pc({
          check: {
            url: '{{baseUrl}}/api/orders/{{orderNo}}',
            jsonPath: 'state',
            equals: '{{wantedState}}',
          },
        }),
      ],
      { baseUrl: 'http://h', orderNo: '4711', wantedState: 'OPEN' },
      fetchImpl as any,
    );

    expect(fetchImpl.mock.calls[0][0]).toBe('http://h/api/orders/4711');
    expect(result.satisfiedCount).toBe(1);
  });

  it('reports each precondition separately, so a mixed run can be read', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { on: true })) // check for #1: satisfied
      .mockResolvedValueOnce(jsonResponse(200, { on: false })) // check for #2: not yet
      .mockResolvedValueOnce(okResponse); // setup for #2

    const result = await runPreconditions(
      [
        pc({ name: 'function A', check: { url: 'http://h/a', jsonPath: 'on', equals: true } }),
        pc({ name: 'function B', url: 'http://h/b', check: { url: 'http://h/b?', jsonPath: 'on', equals: true } }),
      ],
      {},
      fetchImpl as any,
    );

    expect(result.steps.map((s) => [s.name, s.status])).toEqual([
      ['function A', 'satisfied'],
      ['function B', 'applied'],
    ]);
    expect(result).toMatchObject({ ok: true, ranCount: 1, satisfiedCount: 1 });
  });
});

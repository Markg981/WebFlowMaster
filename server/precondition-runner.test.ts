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
    expect(await runPreconditions(null, {}, fetchImpl as any)).toEqual({ ok: true, ranCount: 0 });
    expect(await runPreconditions([], {}, fetchImpl as any)).toEqual({ ok: true, ranCount: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('runs each precondition and substitutes {{baseUrl}} + query params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse);
    const result = await runPreconditions(
      [pc({ queryParams: [{ key: 'equipmentRowId', value: '42', enabled: true }] })],
      { baseUrl: 'http://localhost:7000' },
      fetchImpl as any,
    );
    expect(result).toEqual({ ok: true, ranCount: 1 });
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

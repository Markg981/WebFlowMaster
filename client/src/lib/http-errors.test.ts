import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, apiRequest, errorMessage, queryClient } from './queryClient';
import { watchForEndedSession } from './session-expiry';

/**
 * How a failed HTTP answer reaches the person: apiRequest turns any non-2xx into an ApiError
 * with the status and parsed body, errorMessage picks the sentence to show, and a 401 while
 * signed in ends the session so ProtectedRoute sends them to the login.
 */

const reply = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
});

describe('apiRequest error mapping', () => {
  it.each([
    [401, { error: 'Please sign in.' }, 'Please sign in.'],
    [403, { error: 'You are not allowed to do this.' }, 'You are not allowed to do this.'],
    [409, { message: 'Someone else changed it.' }, 'Someone else changed it.'],
    [
      422,
      { details: [{ path: ['name'], message: 'Name is required' }] },
      expect.stringContaining('Name is required'),
    ],
    [429, { error: 'Too many requests, slow down.' }, 'Too many requests, slow down.'],
  ])('status %i becomes an ApiError with a readable sentence', async (status, body, sentence) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(status, body)));
    const error = await apiRequest('POST', '/api/things', { a: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    expect((error as ApiError).body).toEqual(body);
    expect(errorMessage(error)).toEqual(sentence);
  });

  it('keeps a non-JSON body as text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(429, 'Rate limited')));
    const error = (await apiRequest('GET', '/api/things').catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(429);
    expect(error.body).toBe('Rate limited');
    expect(errorMessage(error)).toBe('429: Rate limited');
  });

  it('resolves on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, { ok: true })));
    const res = await apiRequest('GET', '/api/things');
    expect(res.status).toBe(200);
  });
});

describe('watchForEndedSession', () => {
  it('signs the person out on a 401 from the API while signed in', async () => {
    const original = vi.fn().mockResolvedValue(reply(401, { error: 'Session expired' }));
    vi.stubGlobal('fetch', original);
    window.fetch = original as unknown as typeof fetch;
    watchForEndedSession();
    queryClient.setQueryData(['/api/user'], { id: 1, username: 'alice' });
    queryClient.setQueryData(['/api/tests'], [{ name: 'secret' }]);

    await window.fetch('/api/tests');

    expect(queryClient.getQueryData(['/api/user'])).toBeNull();
    expect(queryClient.getQueryData(['/api/tests'])).toBeUndefined();
  });

  it.each([403, 409, 422, 429])('keeps the session on a %i', async (status) => {
    const original = vi.fn().mockResolvedValue(reply(status, { error: 'No' }));
    window.fetch = original as unknown as typeof fetch;
    watchForEndedSession();
    queryClient.setQueryData(['/api/user'], { id: 1, username: 'alice' });

    await window.fetch('/api/tests');

    expect(queryClient.getQueryData(['/api/user'])).toEqual({ id: 1, username: 'alice' });
  });

  it('ignores a 401 from another origin or when nobody is signed in', async () => {
    const original = vi.fn().mockResolvedValue(reply(401, {}));
    window.fetch = original as unknown as typeof fetch;
    watchForEndedSession();
    queryClient.setQueryData(['/api/user'], { id: 1 });
    await window.fetch('https://other.example/api/x');
    expect(queryClient.getQueryData(['/api/user'])).toEqual({ id: 1 });
    queryClient.clear();
    await window.fetch('/api/x');
    expect(queryClient.getQueryData(['/api/user'])).toBeUndefined();
  });
});

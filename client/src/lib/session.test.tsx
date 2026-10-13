import React from 'react';
import { render, renderHook, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { queryClient } from './queryClient';
import { replaceSession } from './session';
import { watchForEndedSession } from './session-expiry';
import { AuthProvider, useAuth, type SessionUser } from '@/hooks/use-auth';

/**
 * Whose data the cache holds. Queries are keyed by URL with `staleTime: Infinity`, so whatever
 * the previous person loaded would be served to the next one in the same tab from memory, with
 * no request the server could refuse: every change of session has to take the cache with it.
 */

const alice = { id: 1, username: 'alice', organizationId: 1 } as SessionUser;
const bob = { id: 2, username: 'bob', organizationId: 2 } as SessionUser;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();

function Catalog() {
  const { data } = useQuery<{ name: string }[]>({ queryKey: ['/api/tests'] });
  return <ul data-testid="catalog">{data?.map((t) => <li key={t.name}>{t.name}</li>)}</ul>;
}

function renderCatalog() {
  return render(
    <QueryClientProvider client={queryClient}>
      <Catalog />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('replaceSession', () => {
  it("does not show the next person the previous person's cached catalog", async () => {
    replaceSession(alice);
    fetchMock.mockResolvedValueOnce(json([{ name: 'Alice private checkout' }]));
    const { unmount } = renderCatalog();
    await screen.findByText('Alice private checkout');
    unmount();

    replaceSession(null); // sign-out
    replaceSession(bob); // sign-in, same tab
    expect(queryClient.getQueryData(['/api/tests'])).toBeUndefined();

    fetchMock.mockResolvedValueOnce(json([{ name: 'Bob smoke test' }]));
    renderCatalog();
    await screen.findByText('Bob smoke test');
    expect(screen.queryByText('Alice private checkout')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2); // Bob's catalog came from the server, as Bob
    expect(queryClient.getQueryData(['/api/user'])).toEqual(bob);
  });

  it("drops a response for the previous person that arrives after the switch", async () => {
    replaceSession(alice);
    let answerAlice!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answerAlice = resolve)));
    const inFlight = queryClient.fetchQuery({ queryKey: ['/api/tests'] }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    replaceSession(bob);
    await act(async () => {
      answerAlice(json([{ name: 'Alice private checkout' }]));
      await inFlight;
    });
    expect(queryClient.getQueryData(['/api/tests'])).toBeUndefined();

    fetchMock.mockResolvedValueOnce(json([{ name: 'Bob smoke test' }]));
    renderCatalog();
    await screen.findByText('Bob smoke test');
    expect(screen.queryByText('Alice private checkout')).toBeNull();
  });

  it('a page still loading for the previous person never renders their late response', async () => {
    replaceSession(alice);
    let answerAlice!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answerAlice = resolve)));
    renderCatalog();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => replaceSession(bob));
    await act(async () => answerAlice(json([{ name: 'Alice private checkout' }])));

    expect(screen.queryByText('Alice private checkout')).toBeNull();
    expect(queryClient.getQueryData(['/api/tests'])).toBeUndefined();
  });
});

describe('AuthProvider', () => {
  it('signing out takes the cached data with it', async () => {
    replaceSession(alice);
    queryClient.setQueryData(['/api/tests'], [{ name: 'Alice private checkout' }]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children}</AuthProvider>
        </QueryClientProvider>
      ),
    });

    await act(() => result.current.logoutMutation.mutateAsync());

    expect(queryClient.getQueryData(['/api/user'])).toBeNull();
    expect(queryClient.getQueryData(['/api/tests'])).toBeUndefined();
  });

  it('signing in as someone else starts from an empty cache', async () => {
    queryClient.setQueryData(['/api/user'], null);
    queryClient.setQueryData(['/api/tests'], [{ name: 'Alice private checkout' }]);
    fetchMock.mockResolvedValueOnce(json(bob));
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children}</AuthProvider>
        </QueryClientProvider>
      ),
    });

    await act(() => result.current.loginMutation.mutateAsync({ username: 'bob', password: 'pw' }));

    expect(queryClient.getQueryData(['/api/user'])).toEqual(bob);
    expect(queryClient.getQueryData(['/api/tests'])).toBeUndefined();
  });
});

describe('watchForEndedSession', () => {
  it('a 401 on an API call ends the session with its cached data', async () => {
    replaceSession(alice);
    queryClient.setQueryData(['/api/tests'], [{ name: 'Alice private checkout' }]);
    fetchMock.mockResolvedValueOnce(json({ message: 'Unauthorized' }, 401));
    watchForEndedSession();

    await window.fetch('/api/projects');

    expect(queryClient.getQueryData(['/api/user'])).toBeNull();
    expect(queryClient.getQueryData(['/api/tests'])).toBeUndefined();
  });
});

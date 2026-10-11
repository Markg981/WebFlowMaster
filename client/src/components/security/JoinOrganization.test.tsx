import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import JoinOrganization from './JoinOrganization';
import { queryClient } from '@/lib/queryClient';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) =>
            String(options?.[name] ?? ''),
          )
        : _key,
  }),
}));

/**
 * A signed-in person opening an invitation link joins one more organization: they are told whose
 * invitation it is and as what, and accepting lands them in it with a fresh client state.
 */

const token = 'f'.repeat(64);
const fetchMock = vi.fn();
const jsonResponse = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function renderJoin() {
  const location = memoryLocation({ path: `/auth?invitation=${token}`, record: true });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook}>
        <JoinOrganization token={token} />
      </Router>
    </QueryClientProvider>,
  );
  return location;
}

beforeEach(() => {
  fetchMock.mockReset();
  queryClient.clear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('JoinOrganization', () => {
  it('shows the organization and role, and joins with the token', async () => {
    const joined = { id: 7, username: 'alice', organizationId: 2, role: 'editor' };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/invitations/preview'))
        return jsonResponse(200, { organizationName: 'Globex', role: 'editor', username: 'alice' });
      if (url === '/api/invitations/accept' && init?.method === 'POST')
        return jsonResponse(200, joined);
      throw new Error(`unexpected ${url}`);
    });
    queryClient.setQueryData(['/api/tests'], [{ id: 'stale' }]);
    const location = renderJoin();

    expect(await screen.findByText('Join Globex')).toBeInTheDocument();
    expect(screen.getByText(/invited to join Globex as editor/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('join-confirm'));

    await waitFor(() => expect(location.history).toContain('/dashboard'));
    const accept = fetchMock.mock.calls.find(([url]) => url === '/api/invitations/accept');
    expect(JSON.parse(accept![1].body)).toEqual({ token });
    expect(queryClient.getQueryData(['/api/user'])).toEqual(joined);
    expect(queryClient.getQueryData(['/api/tests'])).toBeUndefined();
  });

  it('says when the invitation is not for this account, and offers the way back', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'That invitation is not valid.' }));
    const location = renderJoin();

    expect(await screen.findByText(/not valid for your account/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Back to the app'));
    expect(location.history).toContain('/dashboard');
  });

  it('keeps the page and shows the reason when joining is refused', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/invitations/preview')
        ? jsonResponse(200, { organizationName: 'Globex', role: 'viewer', username: 'alice' })
        : jsonResponse(409, { error: 'You are already a member of that organization.' }),
    );
    const location = renderJoin();
    fireEvent.click(await screen.findByTestId('join-confirm'));

    expect(await screen.findByText(/already a member/)).toBeInTheDocument();
    expect(location.history).not.toContain('/dashboard');
  });
});

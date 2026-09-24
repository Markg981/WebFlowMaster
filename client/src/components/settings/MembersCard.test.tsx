import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MembersCard, { invitationLink } from './MembersCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 1, username: 'founder', role: 'owner' } }),
}));

/**
 * Members and invitations, which used to exist only in the API.
 *
 * Worth a test: the invitation link carries the token and the username, and is shown once; removing
 * a member sends who takes over; the owner cannot reset their own second factor from here.
 */

const fetchMock = vi.fn();

const members = [
  { id: 1, username: 'founder', role: 'owner', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 2, username: 'maria', role: 'editor', createdAt: '2026-02-01T00:00:00.000Z' },
  { id: 3, username: 'luca', role: 'viewer', createdAt: '2026-03-01T00:00:00.000Z' },
];
const invitations = [
  { id: 9, username: 'newcomer', role: 'viewer', expiresAt: '2099-01-01T00:00:00.000Z', acceptedAt: null },
  { id: 10, username: 'joined', role: 'editor', expiresAt: '2099-01-01T00:00:00.000Z', acceptedAt: '2026-09-01T00:00:00.000Z' },
];

const ok = (body: unknown) => ({ ok: true, json: async () => body });

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MembersCard />
    </QueryClientProvider>,
  );
}

const calls = (method: string, url: string) =>
  fetchMock.mock.calls.filter(([calledUrl, init]: any[]) => calledUrl === url && (init?.method ?? 'GET') === method);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url === '/api/organization') return ok({ organization: { id: 1, name: 'Acme' }, members });
    if (method === 'GET' && url === '/api/organization/invitations') return ok(invitations);
    if (method === 'POST' && url === '/api/organization/invitations') {
      return ok({ id: 11, username: 'giulia', role: 'editor', token: 'f'.repeat(64), expiresAt: '2099-01-01T00:00:00.000Z', acceptedAt: null });
    }
    if (method === 'DELETE' && url === '/api/organization/members/2') {
      return ok({ removed: 2, transferredTo: { id: 3, username: 'luca' }, transferred: {} });
    }
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('MembersCard', () => {
  it('lists the members, and only the invitations still waiting', async () => {
    renderCard();

    expect(await screen.findByText('maria')).toBeInTheDocument();
    expect(screen.getByText('you')).toBeInTheDocument();
    expect(await screen.findByText('newcomer')).toBeInTheDocument();
    expect(screen.queryByText('joined')).toBeNull();
  });

  it('offers to reset two-factor for others, not for the owner themselves', async () => {
    renderCard();
    await screen.findByText('maria');

    expect(screen.getByRole('button', { name: 'Reset two-factor for maria' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset two-factor for founder' })).toBeNull();
  });

  it('creates an invitation and shows its link once, with the token and the username', async () => {
    renderCard();
    await screen.findByText('maria');

    fireEvent.change(screen.getByLabelText('Username for the new account'), { target: { value: 'giulia' } });
    fireEvent.click(screen.getByRole('button', { name: /Create invitation/i }));

    const link = (await screen.findByLabelText('Invitation link')) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/auth?invitation=${'f'.repeat(64)}&username=giulia`);
    expect(JSON.parse(calls('POST', '/api/organization/invitations')[0][1].body)).toEqual({ username: 'giulia', role: 'editor' });
  });

  it('refuses a username too short to be one before asking the server', async () => {
    renderCard();
    await screen.findByText('maria');

    fireEvent.change(screen.getByLabelText('Username for the new account'), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: /Create invitation/i }));

    expect(await screen.findByText(/at least 3 characters/)).toBeInTheDocument();
    expect(calls('POST', '/api/organization/invitations')).toHaveLength(0);
  });

  it('removes a member after asking, and says who took over', async () => {
    renderCard();
    await screen.findByText('maria');

    fireEvent.click(screen.getByRole('button', { name: 'Remove maria' }));
    expect(await screen.findByText('Remove maria?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Remove member/i }));

    expect(await screen.findByText('maria was removed. What they made now belongs to luca.')).toBeInTheDocument();
    // Nobody was chosen, so the server decides: the owner removing them.
    expect(JSON.parse(calls('DELETE', '/api/organization/members/2')[0][1].body)).toEqual({});
  });

  it('issues a password reset link for a member, not for the owner themselves', async () => {
    fetchMock.mockImplementationOnce(async () => ok({ organization: { id: 1, name: 'Acme' }, members }));
    renderCard();
    await screen.findByText('maria');
    expect(screen.queryByRole('button', { name: 'Password reset link for founder' })).toBeNull();

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url === '/api/organization/members/2/password-reset') {
        return ok({ username: 'maria', token: 'r'.repeat(40), expiresAt: '2099-01-01T00:00:00.000Z' });
      }
      if (url === '/api/organization') return ok({ organization: { id: 1, name: 'Acme' }, members });
      return ok(invitations);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Password reset link for maria' }));

    const link = (await screen.findByLabelText('Password reset link')) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/auth?reset=${'r'.repeat(40)}&username=maria`);
  });

  it('revokes an invitation', async () => {
    renderCard();
    await screen.findByText('newcomer');

    fireEvent.click(screen.getByRole('button', { name: 'Revoke the invitation for newcomer' }));

    await waitFor(() => expect(calls('DELETE', '/api/organization/invitations/9')).toHaveLength(1));
  });
});

describe('invitationLink', () => {
  it('escapes what it carries', () => {
    expect(invitationLink('https://wfm.example.com', { token: 'abc', username: 'maria rossi' })).toBe(
      'https://wfm.example.com/auth?invitation=abc&username=maria+rossi',
    );
  });
});

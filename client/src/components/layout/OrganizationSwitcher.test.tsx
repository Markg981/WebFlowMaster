import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { queryClient } from '@/lib/queryClient';
import type { SessionOrganization } from '@/hooks/use-auth';

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

let organizations: SessionOrganization[] = [];
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', role: 'owner', organizations } }),
}));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

/**
 * Moving between organizations: offered only to a person with more than one, and a switch
 * replaces the client's whole state — the cache is of the organization just left.
 */

const fetchMock = vi.fn();

function renderSwitcher() {
  const location = memoryLocation({ path: '/tests', record: true });
  render(
    <Router hook={location.hook}>
      <OrganizationSwitcher />
    </Router>,
  );
  return location;
}

beforeEach(() => {
  fetchMock.mockReset();
  toast.mockReset();
  queryClient.clear();
  vi.stubGlobal('fetch', fetchMock);
  organizations = [
    { id: 1, name: 'Acme', role: 'owner', current: true },
    { id: 2, name: 'Globex', role: 'viewer', current: false },
  ];
});

describe('OrganizationSwitcher', () => {
  it('is absent for a person of one organization', () => {
    organizations = [{ id: 1, name: 'Acme', role: 'owner', current: true }];
    renderSwitcher();
    expect(screen.queryByTestId('organization-switcher')).toBeNull();
  });

  it('names the current organization and lists the others with their roles', async () => {
    renderSwitcher();
    const trigger = screen.getByTestId('organization-switcher');
    expect(trigger).toHaveTextContent('Acme');

    fireEvent.keyDown(trigger, { key: 'Enter' });
    const option = await screen.findByTestId('organization-option-2');
    expect(option).toHaveTextContent('Globex');
    expect(option).toHaveTextContent('viewer');
  });

  it('switches, replaces the cached user, clears the rest and goes to the dashboard', async () => {
    const switched = {
      id: 1,
      username: 'alice',
      role: 'viewer',
      organizationId: 2,
      organizations: organizations.map((o) => ({ ...o, current: o.id === 2 })),
    };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => switched,
      text: async () => JSON.stringify(switched),
    });
    queryClient.setQueryData(['/api/tests'], [{ id: 'stale' }]);
    const location = renderSwitcher();

    fireEvent.keyDown(screen.getByTestId('organization-switcher'), { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('organization-option-2'));

    await waitFor(() => expect(location.history).toContain('/dashboard'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/organizations/switch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ organizationId: 2 });
    expect(queryClient.getQueryData(['/api/user'])).toEqual(switched);
    expect(queryClient.getQueryData(['/api/tests'])).toBeUndefined();
    expect(toast).not.toHaveBeenCalled();
  });

  it('says so when the switch is refused, and stays', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'You are not a member of that organization.' }),
      text: async () => JSON.stringify({ error: 'You are not a member of that organization.' }),
    });
    const location = renderSwitcher();

    fireEvent.keyDown(screen.getByTestId('organization-switcher'), { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('organization-option-2'));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({ variant: 'destructive' });
    expect(location.history).not.toContain('/dashboard');
  });
});

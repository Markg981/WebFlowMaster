import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ServiceAccountsCard from './ServiceAccountsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

/**
 * Accounts for pipelines rather than people.
 *
 * What is worth a test: one is created with a name and a role that is never owner, and disabling
 * it is offered only while it is enabled.
 */

const fetchMock = vi.fn();

const accounts = [
  { id: 7, name: 'GitHub Actions', role: 'editor', createdAt: '2026-09-01T00:00:00.000Z', disabledAt: null },
  { id: 8, name: 'Old Jenkins', role: 'viewer', createdAt: '2026-01-01T00:00:00.000Z', disabledAt: '2026-06-01T00:00:00.000Z' },
];

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ServiceAccountsCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => accounts });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ServiceAccountsCard', () => {
  it('lists the accounts, and offers to disable only the ones still enabled', async () => {
    renderCard();

    expect(await screen.findByText('GitHub Actions')).toBeInTheDocument();
    expect(screen.getByText('disabled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable GitHub Actions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disable Old Jenkins' })).toBeNull();
  });

  it('creates one with a name and, by default, the editor role', async () => {
    renderCard();
    await screen.findByText('GitHub Actions');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => accounts[0] });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Nightly' } });
    fireEvent.click(screen.getByRole('button', { name: /Create account/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'POST');
      expect(JSON.parse(post![1].body)).toEqual({ name: 'Nightly', role: 'editor' });
    });
  });

  it('disables one', async () => {
    renderCard();
    await screen.findByText('GitHub Actions');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ...accounts[0], revokedKeys: 1 }) });

    fireEvent.click(screen.getByRole('button', { name: 'Disable GitHub Actions' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]: any[]) => url === '/api/service-accounts/7' && init?.method === 'DELETE')).toBe(true);
    });
  });
});

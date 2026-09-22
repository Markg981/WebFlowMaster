import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ApiKeysCard from './ApiKeysCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key) }),
}));

/**
 * The screen that issues a pipeline's credential. Its one hard rule is that the key is shown
 * exactly once: the server keeps a hash and cannot produce it again.
 */

const fetchMock = vi.fn();

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ApiKeysCard />
    </QueryClientProvider>,
  );
}

const existingKey = {
  id: 'key-1',
  name: 'GitHub Actions',
  prefix: 'wfm_abc1234',
  createdAt: '2026-09-01T10:00:00.000Z',
  lastUsedAt: '2026-09-20T02:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => [existingKey] });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ApiKeysCard', () => {
  it('lists the keys by name and prefix, never by key', async () => {
    renderCard();

    expect(await screen.findByText('GitHub Actions')).toBeInTheDocument();
    expect(screen.getByText('wfm_abc1234…')).toBeInTheDocument();
  });

  it('shows a new key once, with a warning that it will not be shown again', async () => {
    renderCard();
    await screen.findByText('GitHub Actions');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...existingKey, id: 'key-2', name: 'Nightly', key: 'wfm_the-actual-secret' }),
    });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Nightly' } });
    fireEvent.click(screen.getByRole('button', { name: /Create key/i }));

    expect(await screen.findByTestId('fresh-api-key')).toHaveTextContent('wfm_the-actual-secret');
    expect(screen.getByText(/only time it is shown/i)).toBeInTheDocument();
  });

  it('sends the name and the optional lifetime', async () => {
    renderCard();
    await screen.findByText('GitHub Actions');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ...existingKey, key: 'wfm_x' }) });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Nightly' } });
    fireEvent.change(screen.getByLabelText(/Expires in/i), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /Create key/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'POST');
      expect(JSON.parse(post![1].body)).toEqual({ name: 'Nightly', expiresInDays: 30 });
    });
  });

  it('refuses a nameless key before asking the server', async () => {
    renderCard();
    await screen.findByText('GitHub Actions');
    const callsBefore = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /Create key/i }));

    expect(await screen.findByText(/Give the key a name/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('revokes a key', async () => {
    renderCard();
    await screen.findByText('GitHub Actions');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ...existingKey, revokedAt: new Date().toISOString() }) });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke key' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'DELETE');
      expect(call![0]).toBe('/api/api-keys/key-1');
    });
  });

  it('offers no way to revoke a key that is already revoked', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ ...existingKey, revokedAt: '2026-09-21T00:00:00.000Z' }] });
    renderCard();

    expect(await screen.findByText('revoked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke key' })).not.toBeInTheDocument();
  });

  it('says so when there is nothing yet, rather than showing an empty table', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    renderCard();

    expect(await screen.findByText(/No API keys yet/i)).toBeInTheDocument();
  });
});

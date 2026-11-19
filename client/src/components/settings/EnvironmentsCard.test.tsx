import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EnvironmentsCard from './EnvironmentsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

/**
 * The data setup switch of an environment: off unless the server says it is on, changed only by
 * an owner, and changed through the owner-only route rather than by editing the environment.
 */

const fetchMock = vi.fn();
const env = { id: 7, name: 'QA', description: null, loginStateCapturedAt: null, dataSetup: false };

function renderCard(isOwner: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EnvironmentsCard isOwner={isOwner} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT')
      return Promise.resolve({ ok: true, json: async () => ({ id: 7, dataSetup: true }) });
    if (url.endsWith('/secrets')) return Promise.resolve({ ok: true, json: async () => [] });
    return Promise.resolve({ ok: true, json: async () => [env] });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('EnvironmentsCard data setup', () => {
  it('lets an owner turn it on through the data-setup route', async () => {
    renderCard(true);
    fireEvent.click(await screen.findByText('QA'));
    const toggle = await screen.findByRole('switch', { name: 'environments.dataSetup.label' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/environments/7/data-setup',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ dataSetup: true }) }),
      ),
    );
  });

  it('shows it to everyone else, but not to change', async () => {
    renderCard(false);
    fireEvent.click(await screen.findByText('QA'));
    expect(
      await screen.findByRole('switch', { name: 'environments.dataSetup.label' }),
    ).toBeDisabled();
    expect(screen.getByText('environments.dataSetup.ownerOnly')).toBeInTheDocument();
  });
});

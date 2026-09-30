import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BrowserGridsCard from './BrowserGridsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {})) text = text.replace(`{{${name}}}`, String(value));
      return text;
    },
  }),
}));

/**
 * The organization's browser grids: the fields each provider needs, a key typed once, a check
 * that opens a real session, and deletion that says which plans go back to the runners.
 */

const fetchMock = vi.fn();
let grids: unknown[] = [];

beforeEach(() => {
  grids = [{ id: 'g1', name: 'Cloud', provider: 'browserstack', username: 'acme', endpoint: null, hasKey: true }];
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url === '/api/browser-grids') return Promise.resolve({ ok: true, json: async () => ({ id: 'g2' }) });
    if (init?.method === 'POST' && url.endsWith('/test')) return Promise.resolve({ ok: true, json: async () => ({ ok: true, message: 'Connected: 120.0, in 900 ms.' }) });
    if (init?.method === 'DELETE') return Promise.resolve({ ok: true, json: async () => ({ deleted: true, plansMovedToRunners: 2 }) });
    return Promise.resolve({ ok: true, json: async () => grids });
  });
  vi.stubGlobal('fetch', fetchMock);
});

const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BrowserGridsCard />
    </QueryClientProvider>,
  );

describe('BrowserGridsCard', () => {
  it('lists the grids by account, never by key', async () => {
    renderCard();
    expect(await screen.findByText('Cloud')).toBeTruthy();
    expect(screen.getByText('acme')).toBeTruthy();
    expect(screen.getAllByText('BrowserStack').length).toBeGreaterThan(1);
  });

  it('asks BrowserStack for a username and a key before saving, then saves them', async () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'BS' } });
    fireEvent.click(screen.getByText('Add grid'));
    expect(screen.getByRole('alert').textContent).toMatch(/username/);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'acme' } });
    fireEvent.click(screen.getByText('Add grid'));
    expect(screen.getByRole('alert').textContent).toMatch(/access key/);

    fireEvent.change(screen.getByLabelText('Access key'), { target: { value: 'k-1' } });
    fireEvent.click(screen.getByText('Add grid'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(JSON.parse(init.body)).toEqual({ name: 'BS', provider: 'browserstack', username: 'acme', endpoint: null, key: 'k-1' });
    expect(screen.getByLabelText('Access key')).toHaveValue('');
  });

  it('checks a grid and says how it went, and says which plans a deletion moves', async () => {
    renderCard();
    fireEvent.click(await screen.findByLabelText('Test connection'));
    expect(await screen.findByText('Connected: 120.0, in 900 ms.')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Delete'));
    expect(await screen.findByText('2 plan(s) that used it run on the server’s runners again.')).toBeTruthy();
  });
});

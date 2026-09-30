import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PublicationsCard from './PublicationsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {})) text = text.split(`{{${name}}}`).join(String(value));
      return text;
    },
  }),
}));

/** Where a run went in TestRail, Xray or Zephyr, and publishing it again from the report. */

const fetchMock = vi.fn();
let publications: unknown[] = [];
let connections: unknown[] = [];
let publishStatus = 200;

beforeEach(() => {
  publications = [
    { id: 2, connectionName: 'Xray', provider: 'xray_cloud', status: 'published', externalKey: 'SHOP-900', externalUrl: 'https://acme.atlassian.net/browse/SHOP-900', publishedCount: 4, unmappedCount: 1, message: null, createdAt: '2026-09-30T08:00:00Z' },
    { id: 1, connectionName: 'TestRail', provider: 'testrail', status: 'failed', externalKey: null, externalUrl: null, publishedCount: 0, unmappedCount: 0, message: 'TestRail refused those credentials.', createdAt: '2026-09-30T07:00:00Z' },
  ];
  connections = [{ id: 'tm1', name: 'Xray' }];
  publishStatus = 200;
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve({ ok: publishStatus < 400, status: publishStatus, json: async () => (publishStatus === 409 ? { error: 'The run has not finished: publish it when it has.' } : {}) });
    if (url.endsWith('/publications')) return Promise.resolve({ ok: true, json: async () => publications });
    return Promise.resolve({ ok: true, json: async () => connections });
  });
  vi.stubGlobal('fetch', fetchMock);
});

const renderCard = (runStatus = 'completed') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PublicationsCard executionId="exec-1" runStatus={runStatus} />
    </QueryClientProvider>,
  );

describe('PublicationsCard', () => {
  it('shows each publication with its link, counts and the reason it failed', async () => {
    renderCard();
    const link = await screen.findByText('SHOP-900');
    expect(link.closest('a')).toHaveAttribute('href', 'https://acme.atlassian.net/browse/SHOP-900');
    expect(screen.getByText('4 case(s) published, 1 test(s) with no case left out.')).toBeTruthy();
    expect(screen.getByText('TestRail refused those credentials.')).toBeTruthy();
  });

  it('publishes again to the plan’s connection', async () => {
    renderCard();
    fireEvent.click(await screen.findByText('Publish again'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(url).toBe('/api/test-plan-executions/exec-1/publish');
    expect(JSON.parse(init.body)).toEqual({ connectionId: null });
  });

  it('says why the server refused, but not for a publication recorded as failed', async () => {
    publishStatus = 409;
    renderCard();
    fireEvent.click(await screen.findByText('Publish again'));
    expect((await screen.findByRole('alert')).textContent).toBe('The run has not finished: publish it when it has.');
  });

  it('offers no publishing while the run is in flight', async () => {
    renderCard('running');
    await screen.findByText('SHOP-900');
    expect(screen.queryByText('Publish again')).toBeNull();
  });

  it('is not shown to an organization with no connection and nothing published', async () => {
    publications = [];
    connections = [];
    const { container } = renderCard();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(container.querySelector('[data-testid="publications-card"]')).toBeNull();
  });
});

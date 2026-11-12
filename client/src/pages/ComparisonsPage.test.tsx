import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ComparisonsPage from './ComparisonsPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));
let search = '';
vi.mock('wouter', () => ({
  useSearch: () => search,
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

/** The list of comparisons: each links to its report, and `?planId=` narrows the query. */

const fetchMock = vi.fn();

beforeEach(() => {
  search = '';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ComparisonsPage />
    </QueryClientProvider>,
  );
}

const reply = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });

describe('ComparisonsPage', () => {
  it('lists comparisons with their environments, status and verdict', async () => {
    fetchMock.mockImplementation(() =>
      reply({
        rows: [
          {
            id: 'cmp-1',
            planId: 'plan-1',
            planName: 'Checkout plan',
            name: 'Angular 22',
            status: 'completed',
            verdict: 'parity',
            baseline: { environmentName: 'prod' },
            candidate: { environmentName: 'staging' },
            createdAt: '2026-11-12T10:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      }),
    );
    renderPage();
    expect((await screen.findByText('Angular 22')).closest('a')).toHaveAttribute(
      'href',
      '/comparisons/cmp-1',
    );
    expect(screen.getByText('Checkout plan')).toBeInTheDocument();
    expect(screen.getByText('Parity')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/comparisons?page=1&pageSize=25');
  });

  it('narrows to one plan and says when there is none', async () => {
    search = 'planId=plan-9';
    fetchMock.mockImplementation(() => reply({ rows: [], total: 0, page: 1, pageSize: 25 }));
    renderPage();
    expect(await screen.findByText('No comparison yet.')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/comparisons?planId=plan-9&page=1&pageSize=25');
    expect(screen.getByText('Show all')).toBeInTheDocument();
  });
});

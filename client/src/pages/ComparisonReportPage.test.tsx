import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ComparisonReportPage from './ComparisonReportPage';

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
vi.mock('wouter', () => ({
  useRoute: () => [true, { id: 'cmp-1' }],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
let role = 'editor';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 2, role } }) }));

/**
 * One comparison's report: counts by verdict and parity by module once it completes; a test
 * opens to its differences, a visual one as the two screenshots; an editor can cancel one that
 * is still running, a viewer cannot.
 */

const counts = (values: Partial<Record<string, number>>) => ({
  identical: 0,
  equivalent: 0,
  different: 0,
  outcome_mismatch: 0,
  both_failed: 0,
  not_comparable: 0,
  ...values,
});

const comparison = (status: string) => ({
  id: 'cmp-1',
  planId: 'plan-1',
  planName: 'Checkout plan',
  name: 'Angular 22',
  mode: 'sequential',
  status,
  verdict: status === 'completed' ? 'regressions' : null,
  summary:
    status === 'completed'
      ? {
          total: 4,
          byVerdict: counts({ identical: 3, different: 1 }),
          byModule: [
            { module: 'Cart', total: 2, byVerdict: counts({ identical: 1, different: 1 }) },
            { module: '', total: 2, byVerdict: counts({ identical: 2 }) },
          ],
          droppedDifferences: 0,
        }
      : null,
  baseline: { environmentId: 1, environmentName: 'prod', executionId: 'run-a' },
  candidate: { environmentId: 2, environmentName: 'staging', executionId: null },
  failureCode: null,
  failureMessage: null,
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
  completedAt: null,
  baselineRun: null,
  candidateRun: null,
});

const resultRow = {
  id: 'res-1',
  testType: 'ui',
  testName: 'checkout',
  browser: 'chromium',
  module: 'Cart',
  component: null,
  verdict: 'different',
  differenceCount: 2,
  reviewStatus: 'open',
};

const fetchMock = vi.fn();
let status = 'completed';

beforeEach(() => {
  role = 'editor';
  status = 'completed';
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
    if (init?.method === 'POST') return reply({ status: 'cancelled' });
    if (url === '/api/comparisons/cmp-1') return reply(comparison(status));
    if (url.startsWith('/api/comparisons/cmp-1/results/res-1'))
      return reply({
        ...resultRow,
        hidden: false,
        steps: null,
        differences: [
          {
            stepId: 'total',
            stepIndex: 2,
            checkpoint: 'cart total',
            kind: 'text',
            path: 'texts[0]',
            baseline: '€ 10,00',
            candidate: '€ 10.00',
            severity: 'blocking',
          },
          {
            stepId: 'open',
            stepIndex: 0,
            checkpoint: null,
            kind: 'visual',
            path: 'pixels',
            baseline: { screenshot: '/api/test-plan-executions/run-a/artifacts/1.png' },
            candidate: { screenshot: null },
            severity: 'informative',
          },
        ],
      });
    if (url.startsWith('/api/comparisons/cmp-1/results'))
      return reply({ rows: [resultRow], total: 1, page: 1, pageSize: 50 });
    return Promise.resolve({ ok: false, json: async () => ({ error: 'unexpected' }) });
  });
  vi.stubGlobal('fetch', fetchMock);
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ComparisonReportPage />
    </QueryClientProvider>,
  );
}

describe('ComparisonReportPage', () => {
  it('shows the verdict, the counts and parity by module of a completed comparison', async () => {
    renderPage();
    expect(await screen.findByText('Regressions')).toBeInTheDocument();
    const tiles = screen.getByTestId('verdict-tiles');
    expect(within(tiles).getByText('3')).toBeInTheDocument();
    expect(within(tiles).getByText('Identical')).toBeInTheDocument();
    const cart = screen.getByText('Cart', { selector: 'td' }).closest('tr')!;
    expect(within(cart).getByText('50%')).toBeInTheDocument();
    const none = screen.getByText('No module').closest('tr')!;
    expect(within(none).getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Open its run').closest('a')).toHaveAttribute(
      'href',
      '/test-plans/plan-1/executions/run-a/report',
    );
    expect(screen.queryByRole('button', { name: 'Cancel comparison' })).not.toBeInTheDocument();
  });

  it('opens a test to both sides of each difference, screenshots included', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /checkout/ }));
    const differences = await screen.findByTestId('differences');
    expect(within(differences).getByText('€ 10,00')).toBeInTheDocument();
    expect(within(differences).getByText('€ 10.00')).toBeInTheDocument();
    expect(within(differences).getByText('checkpoint “cart total”')).toBeInTheDocument();
    expect(within(differences).getByRole('img')).toHaveAttribute(
      'src',
      '/api/test-plan-executions/run-a/artifacts/1.png',
    );
    expect(within(differences).getByText('No screenshot you can open.')).toBeInTheDocument();
  });

  it('lets an editor cancel a running comparison, and not a viewer', async () => {
    status = 'running';
    renderPage();
    const cancel = await screen.findByRole('button', { name: 'Cancel comparison' });
    expect(screen.queryByTestId('verdict-tiles')).not.toBeInTheDocument();
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/comparisons/cmp-1/cancel',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('lets an editor review an opened test, and not a viewer', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /checkout/ }));
    const review = await screen.findByTestId('review');
    fireEvent.click(within(review).getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('button', { name: 'Save review' })).toBeInTheDocument();
  });

  it('shows a viewer the review without the button', async () => {
    role = 'viewer';
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /checkout/ }));
    const review = await screen.findByTestId('review');
    expect(within(review).queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
  });

  it('offers a viewer no cancel', async () => {
    status = 'running';
    role = 'viewer';
    renderPage();
    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel comparison' })).not.toBeInTheDocument();
  });
});

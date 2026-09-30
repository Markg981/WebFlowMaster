import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RequirementsPage from './RequirementsPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

let role = 'editor';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 1, role } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

/**
 * The requirements page: the epic-story tree with each one's coverage said in words, the tests
 * behind a number, and the changes a viewer is not offered.
 */

const fetchMock = vi.fn();

const coverage = (state: string, tests: any[] = [], hidden = 0) => ({
  state,
  tests,
  passed: tests.filter((t) => t.outcome === 'passed').length,
  failed: tests.filter((t) => t.outcome === 'failed').length,
  notRun: tests.filter((t) => t.outcome !== 'passed' && t.outcome !== 'failed').length,
  hidden,
});
const checkout = { type: 'ui', id: 7, name: 'Checkout by card', outcome: 'failed', lastRun: { executionId: 'run-1', planId: 'plan-1', planName: 'Nightly', at: '2026-09-30T02:00:00.000Z' } };
const orders = { type: 'api', id: 3, name: 'Orders API', outcome: 'passed', lastRun: { executionId: 'run-1', planId: 'plan-1', planName: 'Nightly', at: '2026-09-30T02:00:00.000Z' } };

const base = { description: null, trackerId: null, url: null, externalType: null, externalStatus: null, syncedAt: null, directTests: 0 };
const answer = {
  requirements: [
    { ...base, id: 1, key: 'SHOP-1', title: 'Checkout', kind: 'epic', parentId: null, url: 'https://acme.atlassian.net/browse/SHOP-1', externalStatus: 'In Progress', coverage: coverage('failing', [checkout, orders]) },
    { ...base, id: 2, key: 'SHOP-2', title: 'Pay by card', kind: 'story', parentId: 1, directTests: 2, coverage: coverage('failing', [checkout, orders], 1) },
    { ...base, id: 3, key: 'SHOP-3', title: 'Pay by invoice', kind: 'story', parentId: 1, coverage: coverage('uncovered') },
  ],
  summary: { total: 3, passing: 0, failing: 2, notRun: 0, uncovered: 1, coveredPercent: 67 },
  scope: null,
  trackers: [{ id: 'tr-1', name: 'Jira', provider: 'jira' }],
};

function respond(routes: Record<string, unknown>) {
  fetchMock.mockImplementation((url: string, init?: any) => {
    const method = init?.method ?? 'GET';
    const body = routes[`${method} ${url}`];
    return Promise.resolve({ ok: true, status: 200, json: async () => body ?? {} });
  });
}

const sent = (method: string, url: string) => {
  const call = fetchMock.mock.calls.find(([u, init]: any[]) => u === url && init?.method === method);
  return call ? JSON.parse(call[1].body) : undefined;
};

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  role = 'editor';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  respond({
    'GET /api/requirements': answer,
    'GET /api/test-plans': [{ id: 'plan-1', name: 'Nightly' }],
    'GET /api/requirements/2': { ...answer.requirements[1], tests: [{ type: 'ui', id: 7, name: 'Checkout by card' }, { type: 'ui', id: 99, name: null }] },
    'GET /api/tests': [{ id: 7, name: 'Checkout by card' }, { id: 8, name: 'Login' }],
    'GET /api/api-tests': [{ id: 3, name: 'Orders API' }],
    'GET /api/mobile-tests': [{ id: 5, name: 'Checkout on iPhone' }],
    'PUT /api/requirements/2/tests': [],
    'POST /api/requirements/import': { created: ['SHOP-9'], updated: [], missing: [], found: 1 },
  });
});

describe('RequirementsPage', () => {
  it('shows the tree with each coverage in words, and the numbers above it', async () => {
    withClient(<RequirementsPage />);
    const epic = await screen.findByTestId('requirement-SHOP-1');
    expect(within(epic).getByText('Failing')).toBeInTheDocument();
    expect(within(epic).getByRole('link', { name: /SHOP-1/ })).toHaveAttribute('href', 'https://acme.atlassian.net/browse/SHOP-1');
    expect(within(epic).getByText('In Progress')).toBeInTheDocument();
    expect(within(screen.getByTestId('requirement-SHOP-3')).getByText('No tests')).toBeInTheDocument();
    expect(within(screen.getByTestId('requirement-SHOP-2')).getByText('+1 in projects you cannot see')).toBeInTheDocument();
    expect(within(screen.getByTestId('requirements-summary')).getByText('67%')).toBeInTheDocument();

    // Collapsing the epic hides its stories.
    fireEvent.click(within(epic).getByRole('button', { name: 'Hide what it contains' }));
    expect(screen.queryByTestId('requirement-SHOP-2')).not.toBeInTheDocument();
  });

  it('opens the tests behind the counts, with their last run', async () => {
    withClient(<RequirementsPage />);
    const story = await screen.findByTestId('requirement-SHOP-2');
    fireEvent.click(within(story).getByRole('button', { name: /1 passed · 1 failed · 0 not run/ }));
    const row = screen.getByTestId('requirement-SHOP-2-test-ui-7');
    expect(within(row).getByText('Failed')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /Nightly/ })).toHaveAttribute('href', '/test-plans/plan-1/executions/run-1/report');
  });

  it('filters by coverage, and exports what is on screen', async () => {
    withClient(<RequirementsPage />);
    await screen.findByTestId('requirement-SHOP-1');
    fireEvent.change(screen.getByLabelText('Search key or title…'), { target: { value: 'invoice' } });
    expect(screen.queryByTestId('requirement-SHOP-2')).not.toBeInTheDocument();
    // A story that matches is shown even when its epic does not.
    expect(screen.getByTestId('requirement-SHOP-3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Export matrix/ })).toHaveAttribute('href', '/api/requirements/matrix.csv');
  });

  it('links a mobile app test like the others', async () => {
    withClient(<RequirementsPage />);
    const story = await screen.findByTestId('requirement-SHOP-2');
    fireEvent.click(within(story).getByRole('button', { name: /Tests/ }));
    const list = await screen.findByTestId('requirement-test-list');
    await waitFor(() => expect(within(list).getByLabelText('Checkout on iPhone')).toBeInTheDocument());
    expect(within(list).getByLabelText('Checkout on iPhone').closest('label')).toHaveTextContent('Mobile');
    fireEvent.click(within(list).getByLabelText('Checkout on iPhone'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('PUT', '/api/requirements/2/tests')).toEqual({ items: [{ type: 'ui', id: 7 }, { type: 'mobile', id: 5 }] }));
  });

  it('links tests, leaving the hidden one where it is', async () => {
    withClient(<RequirementsPage />);
    const story = await screen.findByTestId('requirement-SHOP-2');
    fireEvent.click(within(story).getByRole('button', { name: /Tests/ }));
    expect(await screen.findByTestId('requirement-hidden-tests')).toHaveTextContent('1 more linked tests are in projects you cannot see');
    const list = await screen.findByTestId('requirement-test-list');
    await waitFor(() => expect(within(list).getByLabelText('Orders API')).toBeInTheDocument());
    fireEvent.click(within(list).getByLabelText('Orders API'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('PUT', '/api/requirements/2/tests')).toEqual({ items: [{ type: 'ui', id: 7 }, { type: 'api', id: 3 }] }));
  });

  it('imports keys from the tracker', async () => {
    withClient(<RequirementsPage />);
    await screen.findByTestId('requirement-SHOP-1');
    fireEvent.click(screen.getByRole('button', { name: /Import from tracker/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'These keys' }));
    fireEvent.change(screen.getByLabelText('Keys'), { target: { value: 'SHOP-9, SHOP-10\nSHOP-11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(sent('POST', '/api/requirements/import')).toEqual({ trackerId: 'tr-1', keys: ['SHOP-9', 'SHOP-10', 'SHOP-11'] }));
  });

  it('offers a viewer nothing to change', async () => {
    role = 'viewer';
    withClient(<RequirementsPage />);
    const epic = await screen.findByTestId('requirement-SHOP-1');
    expect(within(epic).queryByRole('button', { name: /Tests/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New requirement/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import from tracker/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Export matrix/ })).toBeInTheDocument();
  });
});

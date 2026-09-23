import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SuitesPage from './SuitesPage';
import PlanSuitesDialog from '@/components/suites/PlanSuitesDialog';

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

/**
 * Suites, and choosing which ones a plan includes.
 *
 * What is worth a test: a static suite sends its tests in the order they were ticked (that is the
 * order they run in); a dynamic one cannot be saved without a tag, since it would match nothing;
 * a viewer is not offered changes; and a plan's suites are sent in the order they were ticked.
 */

const fetchMock = vi.fn();

const suiteRows = [
  { id: 1, name: 'Checkout', description: 'Paying', kind: 'static', testCount: 3, planCount: 2 },
  { id: 2, name: 'Smoke', description: null, kind: 'dynamic', testCount: 5, planCount: 0 },
];

function answer(routes: Record<string, unknown>) {
  fetchMock.mockImplementation((url: string, init?: any) => {
    const method = init?.method ?? 'GET';
    const body = routes[`${method} ${url}`];
    if (body === undefined) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: method === 'POST' ? 201 : 200, json: async () => body });
  });
}

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const sent = (method: string, url: string) => {
  const call = fetchMock.mock.calls.find(([u, init]: any[]) => u === url && init?.method === method);
  return call ? JSON.parse(call[1].body) : undefined;
};

beforeEach(() => {
  role = 'editor';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('SuitesPage', () => {
  it('lists the suites with what they run and who includes them', async () => {
    answer({ 'GET /api/suites': suiteRows });
    withClient(<SuitesPage />);
    const checkout = await screen.findByTestId('suite-1');
    expect(within(checkout).getByText('Static')).toBeInTheDocument();
    expect(within(checkout).getByText('3')).toBeInTheDocument();
    expect(within(checkout).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('suite-2')).getByText('Dynamic')).toBeInTheDocument();
  });

  it('sends a static suite with its tests in the order they were ticked', async () => {
    answer({
      'GET /api/suites': [],
      'GET /api/tests': [{ id: 10, name: 'Pay by card' }, { id: 11, name: 'Pay by transfer' }],
      'GET /api/api-tests': [{ id: 20, name: 'Orders API' }],
      'GET /api/tags': [],
      'POST /api/suites': { id: 3 },
    });
    withClient(<SuitesPage />);
    expect(await screen.findByTestId('suites-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /New suite/ }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Checkout' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Orders API' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pay by card' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent('POST', '/api/suites')).toBeDefined());
    expect(sent('POST', '/api/suites')).toMatchObject({
      name: 'Checkout',
      kind: 'static',
      tagIds: [],
      items: [{ type: 'api', id: 20 }, { type: 'ui', id: 10 }],
    });
  });

  it('will not save a dynamic suite without a tag', async () => {
    answer({
      'GET /api/suites': [],
      'GET /api/tests': [],
      'GET /api/api-tests': [],
      'GET /api/tags': [{ id: 'tag-a', name: 'checkout' }, { id: 'tag-b', name: 'smoke' }],
      'POST /api/suites': { id: 4 },
    });
    withClient(<SuitesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /New suite/ }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Everything checkout' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dynamic' }));

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'checkout' }));
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(sent('POST', '/api/suites')).toMatchObject({ kind: 'dynamic', tagIds: ['tag-a'], items: [] }));
  });

  it('offers a viewer no changes', async () => {
    role = 'viewer';
    answer({ 'GET /api/suites': suiteRows });
    withClient(<SuitesPage />);
    const checkout = await screen.findByTestId('suite-1');
    expect(within(checkout).getByRole('button', { name: /View/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New suite/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});

describe('PlanSuitesDialog', () => {
  it("starts from the plan's suites and sends them in the order they were ticked", async () => {
    answer({
      'GET /api/suites': [...suiteRows, { id: 5, name: 'Search', kind: 'static', testCount: 1, planCount: 0 }],
      'GET /api/test-plans/plan-1/suites': [{ id: 2, name: 'Smoke', kind: 'dynamic', position: 0 }],
      'PUT /api/test-plans/plan-1/suites': [],
    });
    const onClose = vi.fn();
    withClient(<PlanSuitesDialog plan={{ id: 'plan-1', name: 'Nightly' }} onClose={onClose} />);

    const smoke = await screen.findByRole('checkbox', { name: 'Smoke' });
    await waitFor(() => expect(smoke).toBeChecked());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Search' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Checkout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent('PUT', '/api/test-plans/plan-1/suites')).toEqual({ suiteIds: [2, 5, 1] }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

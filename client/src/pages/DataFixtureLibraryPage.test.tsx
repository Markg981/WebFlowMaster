import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DataFixtureLibraryPage, { definitionProblems } from './DataFixtureLibraryPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: any, options?: any) => {
      const opts = typeof fallback === 'object' ? fallback : options;
      let text = typeof fallback === 'string' ? fallback : key;
      for (const [name, value] of Object.entries(opts ?? {}))
        text = text.split(`{{${name}}}`).join(String(value));
      return typeof fallback === 'object' ? `${key} ${Object.values(opts).join(' ')}` : text;
    },
  }),
}));
const toast = vi.fn();
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'editor' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/hooks/use-projects', () => ({
  useProjects: () => ({ data: [{ id: 7, name: 'Shop', access: 'editor' }] }),
}));
vi.mock('@/hooks/use-environments', () => ({
  useEnvironments: () => ({ data: [{ id: 2, name: 'Staging', dataSetup: true }] }),
}));

/** The project's fixture library: listed with what each needs first, kept, and not deleted while named. */

const customer = {
  id: 1,
  projectId: 7,
  key: 'customer',
  name: 'A customer',
  description: null,
  tags: ['billing'],
  currentVersion: 2,
  updatedAt: '2026-11-19T00:00:00Z',
  definition: {
    params: [{ name: 'code', type: 'string', value: 'C-1' }],
    check: 'SELECT id FROM customers WHERE code = {{params.code}}',
    apply: 'INSERT INTO customers (code) VALUES ({{params.code}})',
    outputs: ['id'],
    dependsOn: [],
  },
};
const order = {
  ...customer,
  id: 2,
  key: 'order',
  name: 'An order',
  tags: [],
  currentVersion: 1,
  definition: {
    params: [],
    check: 'SELECT id FROM orders WHERE customer_id = {{fx.customer.id}}',
    apply: 'INSERT INTO orders (customer_id) VALUES ({{fx.customer.id}})',
    outputs: ['id'],
    dependsOn: [{ fixture: 'customer', as: 'customer', params: {} }],
  },
};

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  fetchMock.mockReset();
  toast.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.restoreAllMocks());

/** The ledger of leftover data is its own request: answer it empty unless a test says otherwise. */
const LEDGER = '/api/data-fixture-ledger';
const withLedger =
  (handler: (url: string, init?: RequestInit) => unknown, ledger: unknown[] = []) =>
  (url: string, init?: RequestInit) =>
    String(url).startsWith(LEDGER) && init?.method !== 'POST' ? reply(ledger) : handler(url, init);

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DataFixtureLibraryPage />
    </QueryClientProvider>,
  );

describe('DataFixtureLibraryPage', () => {
  it('lists the project fixtures with the order their dependencies run in', async () => {
    fetchMock.mockImplementation(withLedger(() => reply([customer, order])));
    renderPage();
    expect(await screen.findByText('An order')).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('/api/projects/7/data-fixtures');
    expect(screen.getByText('v2')).toBeTruthy();
    expect(screen.getByText(/customer → order/)).toBeTruthy();
  });

  it('creates a fixture with its key and definition', async () => {
    fetchMock.mockImplementation(
      withLedger((_url, init) => (init?.method === 'POST' ? reply({ ...customer, id: 9 }, 201) : reply([]))),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /New fixture/ }));
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'customer' } });
    fireEvent.change(screen.getByLabelText('dataFixtures.name'), {
      target: { value: 'A customer' },
    });
    fireEvent.change(screen.getByLabelText('dataFixtures.check'), {
      target: { value: 'SELECT 1 AS id' },
    });
    fireEvent.change(screen.getByLabelText('dataFixtures.apply'), {
      target: { value: 'SELECT 1' },
    });
    fireEvent.change(screen.getByLabelText('dataFixtures.teardown'), {
      target: { value: 'DELETE FROM customers WHERE id = {{fx.self.id}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(url).toBe('/api/projects/7/data-fixtures');
    expect(JSON.parse(init.body)).toMatchObject({
      key: 'customer',
      name: 'A customer',
      definition: {
        check: 'SELECT 1 AS id',
        apply: 'SELECT 1',
        teardown: 'DELETE FROM customers WHERE id = {{fx.self.id}}',
        dependsOn: [],
      },
    });
  });

  it('says which tests and fixtures still name a fixture it could not delete', async () => {
    fetchMock.mockImplementation(
      withLedger((_url, init) =>
        init?.method === 'DELETE'
          ? reply({ error: 'in use', tests: [{ id: 3, name: 'Checkout' }], fixtures: [] }, 409)
          : reply([customer]),
      ),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete A customer' }));
    fireEvent.click(await screen.findByRole('button', { name: /confirm|delete|ok/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0].description).toMatch(/Checkout/);
  });

  it('lists the data runs left behind and runs a teardown from there', async () => {
    const left = {
      id: 41,
      runId: 'run-9',
      testId: null,
      alias: 'customer',
      name: 'Customer Ann',
      policy: 'always',
      status: 'pending',
      attempts: 0,
      detail: null,
      appliedAt: '2026-11-20T10:00:00Z',
      settledAt: null,
    };
    let ledger: unknown[] = [left];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        ledger = [];
        return reply({ outcome: 'done', detail: 'ok' });
      }
      return withLedger(() => reply([customer]), ledger)(url, init);
    });
    renderPage();
    expect(await screen.findByText('Customer Ann')).toBeTruthy();
    expect(screen.getByText('dataFixtures.ledger.statuses.pending')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /dataFixtures.ledger.runTeardownFor/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/data-fixture-ledger/41/teardown' && i?.method === 'POST')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText('Customer Ann')).toBeNull());
    expect(toast.mock.calls[0][0].title).toBe('dataFixtures.ledger.done');
  });

  it('reports a teardown that failed, with the server reason', async () => {
    const left = {
      id: 42, runId: 'run-10', testId: null, alias: 'c', name: 'Customer Bob', policy: 'always',
      status: 'failed', attempts: 1, detail: 'boom', appliedAt: '2026-11-20T10:00:00Z', settledAt: null,
    };
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? reply({ error: 'the environment it was applied to has been deleted' }, 502)
        : withLedger(() => reply([customer]), [left])(url, init),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /dataFixtures.ledger.runTeardownFor/ }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({
      variant: 'destructive',
      description: expect.stringMatching(/environment/),
    });
  });
});

describe('definitionProblems', () => {
  it('names SQL reading a fixture that is not a dependency', () => {
    expect(
      definitionProblems({
        params: [],
        check: 'SELECT 1 WHERE x = {{fx.other.id}}',
        apply: 'SELECT 1',
        outputs: [],
        dependsOn: [],
      }),
    ).toEqual([expect.stringMatching(/not one of this fixture's dependencies/)]);
  });
});

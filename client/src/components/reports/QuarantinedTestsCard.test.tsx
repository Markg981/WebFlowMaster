import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import QuarantinedTestsCard, { type QuarantineRow } from './QuarantinedTestsCard';

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
 * The tests in quarantine. What is worth a test: the card is absent while nothing is in
 * quarantine; it shows the evidence for a release, and marks a test that has been passing long
 * enough; releasing sends its own row's note; a viewer is offered no release.
 */

const fetchMock = vi.fn();

const row = (overrides: Partial<QuarantineRow>): QuarantineRow => ({
  id: 1,
  testType: 'ui',
  testId: 42,
  testName: 'Checkout',
  reason: 'Times out on the payment iframe',
  quarantinedAt: '2026-09-10T08:00:00.000Z',
  quarantinedBy: 'marco',
  evidence: { runs: 12, passed: 11, failed: 1, passingStreak: 11, lastRunAt: '2026-09-23T02:00:00.000Z', lastStatus: 'Passed' },
  ...overrides,
});

function renderCard(rows: QuarantineRow[]) {
  fetchMock.mockImplementation((_url: string, init?: any) =>
    Promise.resolve({ ok: true, json: async () => (init?.method === 'POST' ? {} : rows) }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuarantinedTestsCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  role = 'editor';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('QuarantinedTestsCard', () => {
  it('is absent while nothing is in quarantine', async () => {
    const { container } = renderCard([]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows what each test has done since, and which are ready to come back', async () => {
    renderCard([row({}), row({ id: 2, testName: 'Search', evidence: { runs: 4, passed: 2, failed: 2, passingStreak: 1, lastRunAt: null, lastStatus: 'Passed' } })]);

    const ready = await screen.findByTestId('quarantine-1');
    expect(within(ready).getByText('Times out on the payment iframe')).toBeInTheDocument();
    expect(within(ready).getByText('11 passed, 1 failed')).toBeInTheDocument();
    expect(within(ready).getByText('Passed its last 11 runs: ready to release')).toBeInTheDocument();
    expect(within(screen.getByTestId('quarantine-2')).getByText('1 passes in a row')).toBeInTheDocument();
  });

  it("releases a test with its own row's note", async () => {
    renderCard([row({}), row({ id: 2, testName: 'Search' })]);

    const second = await screen.findByTestId('quarantine-2');
    fireEvent.change(within(second).getByLabelText('Release note'), { target: { value: 'Fixed the wait' } });
    fireEvent.click(within(screen.getByTestId('quarantine-1')).getByRole('button', { name: /Release/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]: any[]) => url === '/api/quarantine/1/release');
      expect(call && JSON.parse(call[1].body)).toEqual({});
    });
    fireEvent.click(within(second).getByRole('button', { name: /Release/ }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]: any[]) => url === '/api/quarantine/2/release');
      expect(call && JSON.parse(call[1].body)).toEqual({ note: 'Fixed the wait' });
    });
  });

  it('offers a viewer no release', async () => {
    role = 'viewer';
    renderCard([row({})]);
    await screen.findByTestId('quarantine-1');
    expect(screen.queryByRole('button', { name: /Release/ })).toBeNull();
  });
});

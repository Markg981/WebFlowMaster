import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FlakyTestsCard from './FlakyTestsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      if (options) {
        for (const [name, value] of Object.entries(options)) {
          text = text.replace(`{{${name}}}`, String(value));
        }
      }
      return text;
    },
  }),
}));

let role = 'editor';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 1, role } }) }));

/**
 * A run was only ever readable on its own. This is the one view that looks across them — and
 * where an unreliable test is put in quarantine.
 */

const fetchMock = vi.fn();

const response = {
  window: { days: 30, since: '2026-08-23T00:00:00.000Z', resultsExamined: 120 },
  thresholds: { minimumRuns: 3, minimumFlips: 1 },
  items: [
    {
      testName: 'Login',
      test: { type: 'ui' as const, id: 42 },
      quarantine: null,
      browser: 'chromium',
      runs: 8,
      passed: 4,
      failed: 4,
      errored: 1,
      flips: 7,
      unexplainedFlips: 7,
      versions: [4],
      changedDuringWindow: false,
      flakiness: 1,
      lastStatus: 'failed' as const,
      firstSeen: '2026-09-01T00:00:00.000Z',
      lastSeen: '2026-09-21T00:00:00.000Z',
    },
  ],
};

function renderCard(props: { planId?: string | null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FlakyTestsCard planId={props.planId ?? null} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  role = 'editor';
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => response });
  vi.stubGlobal('fetch', fetchMock);
});

describe('FlakyTestsCard', () => {
  it('names the test and how often it changed its mind', async () => {
    renderCard();

    expect(await screen.findByText('Login')).toBeInTheDocument();
    expect(screen.getByText(/7× in 8 runs/)).toBeInTheDocument();
    expect(screen.getByText(/4 \/ 4/)).toBeInTheDocument();
    expect(screen.getByText(/1 never ran/)).toBeInTheDocument();
  });

  it('counts only what the test’s own edits do not explain, and marks that it was edited', async () => {
    // A test somebody rewrote on Monday is not a test that cannot make up its mind, and the
    // list loses its meaning the moment it stops telling the two apart.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...response,
        items: [{ ...response.items[0], flips: 7, unexplainedFlips: 2, versions: [4, 5], changedDuringWindow: true }],
      }),
    });
    renderCard();

    expect(await screen.findByText('edited')).toBeInTheDocument();
    expect(screen.getByText(/2× in 8 runs/)).toBeInTheDocument();
    expect(screen.queryByText(/7× in 8 runs/)).not.toBeInTheDocument();
  });

  it('asks about one plan when the page is filtered to one', async () => {
    renderCard({ planId: 'plan-1' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toContain('planId=plan-1');
  });

  it('says how much history it looked at when it found nothing', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...response, items: [] }) });
    renderCard();

    expect(await screen.findByText(/out of 120 results examined/)).toBeInTheDocument();
  });

  it('quarantines a test with the reason given, and not without one', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Quarantine' }));

    const confirm = screen.getAllByRole('button', { name: 'Quarantine' }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Times out one night in three' } });
    fireEvent.click(confirm);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]: any[]) => url === '/api/quarantine' && init?.method === 'POST');
      expect(call && JSON.parse(call[1].body)).toEqual({ testType: 'ui', testId: 42, reason: 'Times out one night in three' });
    });
  });

  it('says a test is already in quarantine, and offers a viewer nothing', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...response,
        items: [
          { ...response.items[0], quarantine: { id: 3, reason: 'Flaky', since: '2026-09-20T00:00:00.000Z' } },
          { ...response.items[0], testName: 'Search', browser: 'firefox', test: { type: 'ui', id: 43 } },
        ],
      }),
    });
    role = 'viewer';
    renderCard();

    expect(await screen.findByText('In quarantine')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quarantine' })).toBeNull();
  });

  it('reports a failed analysis instead of showing an empty list', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    renderCard();

    expect(await screen.findByText('Could not analyse flaky tests')).toBeInTheDocument();
  });
});

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RunUsageCard from './RunUsageCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));

/**
 * The organization's runs against its limits.
 *
 * What is worth a test: a team whose run sits "queued" can see that the limit is why, and a
 * limit that has been reached looks different from one that has not.
 */

const fetchMock = vi.fn();

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RunUsageCard />
    </QueryClientProvider>,
  );
}

function answer(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({ ok, status: ok ? 200 : 500, statusText: ok ? 'OK' : 'Error', json: async () => body, text: async () => JSON.stringify(body) });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('RunUsageCard', () => {
  it('shows runs in progress and waiting against their limits', async () => {
    answer({ running: 1, queued: 7, maxConcurrentRuns: 2, maxQueuedRuns: 100 });
    renderCard();

    const running = await screen.findByTestId('usage-running');
    expect(within(running).getByText('1 / 2')).toBeInTheDocument();
    expect(within(screen.getByTestId('usage-queued')).getByText('7 / 100')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/organization/usage');
  });

  it('marks a limit that has been reached', async () => {
    answer({ running: 2, queued: 0, maxConcurrentRuns: 2, maxQueuedRuns: 100 });
    renderCard();

    const full = within(await screen.findByTestId('usage-running')).getByText('2 / 2');
    expect(full.className).toContain('text-amber-700');
    expect(within(screen.getByTestId('usage-queued')).getByText('0 / 100').className).not.toContain('text-amber-700');
  });

  it('says why runs wait when no runner is online', async () => {
    answer({ running: 0, queued: 3, maxConcurrentRuns: 2, maxQueuedRuns: 100, runnersOnline: 0 });
    renderCard();

    expect(await screen.findByTestId('usage-no-runner')).toBeInTheDocument();
  });

  it('says so when the usage cannot be loaded', async () => {
    answer({ message: 'boom' }, false);
    renderCard();

    expect(await screen.findByText('Usage could not be loaded.')).toBeInTheDocument();
  });
});

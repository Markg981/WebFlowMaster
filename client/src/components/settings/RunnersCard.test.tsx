import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RunnersCard, { type RunnerRow } from './RunnersCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

/**
 * The runners, for an owner.
 *
 * What is worth a test: it says plainly when nothing is taking work; it shows what each machine
 * has; and it offers draining an online runner and resuming a draining one — nothing for an
 * offline one.
 */

const fetchMock = vi.fn();

const runner = (overrides: Partial<RunnerRow>): RunnerRow => ({
  id: 'build-1:42:ab12',
  hostname: 'build-1',
  pid: 42,
  version: '1.4.0',
  concurrency: 2,
  browserTaskConcurrency: 2,
  browsers: ['chromium', 'firefox'],
  activeJobs: 1,
  status: 'online',
  startedAt: '2026-09-23T08:00:00.000Z',
  lastSeenAt: '2026-09-23T10:00:00.000Z',
  ...overrides,
});

function renderCard(rows: RunnerRow[], canManage?: boolean) {
  fetchMock.mockImplementation((url: string, init?: any) =>
    Promise.resolve({ ok: true, json: async () => (init?.method === 'POST' ? {} : rows) }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RunnersCard canManage={canManage} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('RunnersCard', () => {
  it('says plainly when no runner is taking work', async () => {
    renderCard([runner({ status: 'offline' })]);
    expect(await screen.findByTestId('runners-none')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Drain|Resume/ })).toBeNull();
  });

  it('shows what each runner has, and drains an online one', async () => {
    renderCard([runner({}), runner({ id: 'build-2:7:cd34', hostname: 'build-2', status: 'draining', browsers: [] })]);

    const first = await screen.findByTestId('runner-build-1:42:ab12');
    expect(within(first).getByText('1 / 4')).toBeInTheDocument();
    expect(within(first).getByText('firefox')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 runners taking work.')).toBeInTheDocument();

    const second = screen.getByTestId('runner-build-2:7:cd34');
    expect(within(second).getByText('none installed')).toBeInTheDocument();
    expect(within(second).getByRole('button', { name: /Resume/ })).toBeInTheDocument();

    fireEvent.click(within(first).getByRole('button', { name: /Drain/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, init]: any[]) => url === '/api/runners/build-1%3A42%3Aab12/drain' && init?.method === 'POST')).toBe(true),
    );
  });

  it('shows the runners but offers no drain or resume to an owner who does not run the installation', async () => {
    renderCard([runner({}), runner({ id: 'build-2:7:cd34', hostname: 'build-2', status: 'draining' })], false);

    expect(await screen.findByTestId('runner-build-1:42:ab12')).toBeInTheDocument();
    expect(screen.getByTestId('runners-read-only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Drain|Resume/ })).toBeNull();
  });
});

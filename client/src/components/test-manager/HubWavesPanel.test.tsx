import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HubWavesPanel from './HubWavesPanel';

/**
 * The QA waves tab: the waves read from the hub with their results, a sync and an import that
 * run as background jobs, and an end-of-job toast with the summary.
 */

const toastMock = vi.fn();
let role = 'editor';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 1, role } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>();
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const fetchMock = vi.fn();

const counts = (passed: number, failed: number, on_hold = 0, not_tested = 0, pending = 0) => ({
  passed,
  failed,
  on_hold,
  not_tested,
  pending,
});
const rates = (total: number, executed: number, passed: number) => ({
  total,
  executed,
  executedPct: total ? Math.round((executed / total) * 100) : 0,
  passRatePct: executed ? Math.round((passed / executed) * 100) : 0,
});

const wave = (id: number, waveId: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  waveId,
  name,
  description: null,
  release: '2026.4',
  majorRelease: '2026',
  waveType: 'Regression',
  status: 'closed',
  startDate: '2026-10-01',
  targetDate: null,
  modules: ['Billing'],
  workbookLinks: [],
  createdByName: 'QA',
  entryCount: 10,
  syncedAt: '2026-11-01T10:00:00Z',
  missingSince: null,
  testPlanId: null,
  executionId: null,
  materializedAt: null,
  counts: counts(7, 2, 1),
  rates: rates(10, 10, 7),
  imported: false,
  changedSinceImport: false,
  ...extra,
});

const waves = [
  wave(1, 'W-01', 'October regression'),
  wave(2, 'W-02', 'Old smoke', { missingSince: '2026-11-02T00:00:00Z' }),
];

const overview = {
  waves: 2,
  imported: 0,
  cases: 20,
  totals: counts(14, 4, 2),
  rates: rates(20, 20, 14),
  trend: [],
  modules: [{ module: 'Billing', counts: counts(14, 4, 2), rates: rates(20, 20, 14) }],
  lastJob: null,
};

const source = { id: 1, repoUrl: 'https://example.test/hub.git', branch: 'main' };

const job = (status: string, kind = 'waves_sync', summary: unknown = null) => ({
  id: 'job-1',
  kind,
  status,
  params: {},
  progress: {},
  summary,
  error: null,
  createdAt: '2026-11-06T10:00:00Z',
  startedAt: null,
  finishedAt: status === 'running' ? null : '2026-11-06T10:01:00Z',
  cancelRequested: false,
});

/** Answers `${method} ${url}`; a function is called on every request, anything unlisted is 200 {}. */
function answer(routes: Record<string, unknown>) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const key = `${method} ${url}`;
    let body = key in routes ? routes[key] : {};
    if (typeof body === 'function') body = body();
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  });
}

const sent = (method: string, url: string) => {
  const call = fetchMock.mock.calls.find(
    ([u, init]: any[]) => u === url && (init?.method ?? 'GET') === method,
  );
  return call?.[1]?.body ? JSON.parse(call[1].body) : undefined;
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HubWavesPanel />
    </QueryClientProvider>,
  );
}

const baseRoutes = {
  'GET /api/testcase-hub': source,
  'GET /api/testcase-hub/waves': waves,
  'GET /api/testcase-hub/waves/overview': overview,
  'GET /api/projects': [{ id: 3, name: 'Billing app' }],
};

beforeEach(() => {
  role = 'editor';
  fetchMock.mockReset();
  toastMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HubWavesPanel', () => {
  it('asks for the hub first when there is no source', async () => {
    answer({ 'GET /api/testcase-hub': null });
    renderPanel();
    expect(await screen.findByText('No test case hub yet')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-waves-sync')).toBeNull();
  });

  it('lists the waves with their results and the totals', async () => {
    answer(baseRoutes);
    renderPanel();
    const row = await screen.findByTestId('hub-wave-row-W-01');
    expect(within(row).getByText('October regression')).toBeInTheDocument();
    expect(within(row).getByText('Not imported')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('hub-wave-row-W-02')).getByText('Not in the hub'),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('hub-waves-kpis')).getByText('20')).toBeInTheDocument();
    // A wave gone from the hub cannot be chosen for an import.
    expect(screen.getByRole('checkbox', { name: 'Select Old smoke' })).toBeDisabled();
  });

  it('hides the sync and the selection from a viewer', async () => {
    role = 'viewer';
    answer(baseRoutes);
    renderPanel();
    await screen.findByTestId('hub-wave-row-W-01');
    expect(screen.queryByTestId('hub-waves-sync')).toBeNull();
    expect(screen.queryByTestId('hub-waves-import')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('reads the waves as a job and says what changed when it ends', async () => {
    let polls = 0;
    answer({
      ...baseRoutes,
      'POST /api/testcase-hub/waves/sync': job('running'),
      'GET /api/testcase-hub/jobs/job-1': () =>
        ++polls === 1
          ? job('running')
          : job('succeeded', 'waves_sync', {
              waves: 2,
              added: 1,
              updated: 1,
              unchanged: 0,
              missing: 1,
            }),
    });
    renderPanel();
    fireEvent.click(await screen.findByTestId('hub-waves-sync'));
    expect(await screen.findByTestId('hub-wave-job')).toBeInTheDocument();
    expect(screen.getByTestId('hub-waves-sync')).toBeDisabled();
    await waitFor(
      () =>
        expect(toastMock).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Waves read from the hub',
            description: '2 waves: 1 new, 1 changed, 1 no longer in the hub.',
          }),
        ),
      { timeout: 4000 },
    );
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('imports the chosen waves into a project as a job', async () => {
    answer({
      ...baseRoutes,
      'POST /api/testcase-hub/waves/import': job('running', 'wave_import'),
      'GET /api/testcase-hub/jobs/job-1': job('running', 'wave_import'),
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select October regression' }));
    fireEvent.click(screen.getByTestId('hub-waves-import'));
    const dialog = await screen.findByTestId('hub-wave-import-dialog');
    expect(within(dialog).getByText('Import 1 wave')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByTestId('hub-wave-import-submit'));
    await waitFor(() => expect(screen.queryByTestId('hub-wave-import-dialog')).toBeNull());
    expect(sent('POST', '/api/testcase-hub/waves/import')).toEqual({
      waveIds: [1],
      projectId: null,
      variant: 'standard',
    });
    expect(await screen.findByTestId('hub-wave-job')).toBeInTheDocument();
  });

  it('follows a job a colleague started before the page opened', async () => {
    answer({
      ...baseRoutes,
      'GET /api/testcase-hub/waves/overview': { ...overview, lastJob: job('running') },
      'GET /api/testcase-hub/jobs/job-1': job('running'),
    });
    renderPanel();
    expect(await screen.findByTestId('hub-wave-job')).toBeInTheDocument();
  });
});

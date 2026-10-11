import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoadTestsPage from './LoadTestsPage';

/**
 * The load tests page: the list with each test's scenario, profile and last run, the runs
 * dialog where a run is started against an environment and stopped, and the delete that asks
 * first. The editor dialog and the run view have their own tests (load-tests/LoadTests.test.tsx).
 */

let role = 'editor';
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 1, role, organizationId: 2 } }),
}));

const fetchMock = vi.fn();

/** A reply with a status of its own; a bare body answers 200. */
class Reply {
  constructor(
    readonly status: number,
    readonly body: unknown = {},
  ) {}
}
const reply = (status: number, body?: unknown) => new Reply(status, body);

/** Answers `${method} ${url}`; anything unlisted gets an empty 200. */
function answer(routes: Record<string, unknown>) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const route = routes[`${method} ${url}`];
    const answerWith = route instanceof Reply ? route : new Reply(200, route ?? {});
    const status = answerWith.status;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: async () => answerWith.body ?? {},
      text: async () => JSON.stringify(answerWith.body ?? {}),
    });
  });
}

const sent = (method: string, url: string) => {
  const call = fetchMock.mock.calls.find(
    ([u, init]: any[]) => u === url && (init?.method ?? 'GET') === method,
  );
  return call ? (call[1]?.body ? JSON.parse(call[1].body) : {}) : undefined;
};

const checkout = {
  id: 7,
  name: 'Checkout',
  description: null,
  projectId: null,
  steps: [
    { apiTestId: 1, thinkTimeMs: 0 },
    { apiTestId: 2, thinkTimeMs: 500 },
  ],
  stages: [
    { durationSec: 60, targetVus: 20 },
    { durationSec: 120, targetVus: 20 },
  ],
  warmUpSec: 30,
  dataSetId: null,
  dataMode: 'vu',
  thresholds: { p95Ms: 800 },
  lastRun: { id: 'run-1', status: 'passed', startedAt: '2026-10-10T02:00:00.000Z' },
};
const search = {
  ...checkout,
  id: 8,
  name: 'Search',
  steps: [{ apiTestId: 3, thinkTimeMs: 0 }],
  stages: [{ durationSec: 30, targetVus: 5 }],
  warmUpSec: 0,
  lastRun: null,
};

const passedRun = {
  id: 'run-1',
  loadTestId: 7,
  status: 'passed',
  summary: null,
  error: null,
  cancelRequested: false,
  startedAt: '2026-10-10T02:00:00.000Z',
  finishedAt: '2026-10-10T02:03:00.000Z',
};
const runningRun = {
  ...passedRun,
  id: 'run-2',
  loadTestId: 8,
  status: 'running',
  startedAt: '2026-10-11T02:00:00.000Z',
  finishedAt: null,
};

const routes = {
  'GET /api/load-tests': [checkout, search],
  'GET /api/environments': [{ id: 4, name: 'QA', description: null, loginStateCapturedAt: null }],
  'GET /api/api-tests': [],
  'GET /api/test-data': [],
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LoadTestsPage />
    </QueryClientProvider>,
  );
}

/** Radix opens a Select on keyboard activation only; JSDOM has no PointerEvent for a click. */
const choose = async (trigger: HTMLElement, option: string) => {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

beforeEach(() => {
  role = 'editor';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoadTestsPage', () => {
  it('says it is loading until the load tests arrive', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Load tests' })).toBeInTheDocument();
  });

  it('reports a list that could not be loaded', async () => {
    answer({ ...routes, 'GET /api/load-tests': reply(500) });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the load tests.');
  });

  it('shows the empty state when there is no load test yet', async () => {
    answer({ ...routes, 'GET /api/load-tests': [] });
    renderPage();
    expect(
      await screen.findByText(
        'No load test yet. One repeats saved API tests: save them in the API Tester first.',
      ),
    ).toBeInTheDocument();
  });

  it('lists each load test with its scenario, profile and last run', async () => {
    answer(routes);
    renderPage();

    const checkoutRow = await screen.findByTestId('load-test-7');
    expect(within(checkoutRow).getByText('Checkout')).toBeInTheDocument();
    expect(within(checkoutRow).getByText('2 API tests')).toBeInTheDocument();
    expect(within(checkoutRow).getByText('20 users · 180 s · warm-up 30 s')).toBeInTheDocument();
    expect(within(checkoutRow).getByText('Passed')).toBeInTheDocument();

    const searchRow = screen.getByTestId('load-test-8');
    expect(within(searchRow).getByText('1 API tests')).toBeInTheDocument();
    expect(within(searchRow).getByText('5 users · 30 s · warm-up 0 s')).toBeInTheDocument();
    expect(within(searchRow).getByText('—')).toBeInTheDocument();
  });

  it('starts a run against the chosen environment and can stop it', async () => {
    let runs: unknown[] = [];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const json = (body: unknown, status = 200) =>
        Promise.resolve({
          ok: status < 300,
          status,
          json: async () => body,
          text: async () => JSON.stringify(body),
        });
      if (method === 'GET' && url === '/api/load-tests') return json([checkout, search]);
      if (method === 'GET' && url === '/api/environments')
        return json([{ id: 4, name: 'QA', description: null, loginStateCapturedAt: null }]);
      if (method === 'GET' && url === '/api/load-tests/8') return json({ ...search, runs });
      if (method === 'POST' && url === '/api/load-tests/8/runs') {
        runs = [runningRun];
        return json({ id: 'run-2' }, 201);
      }
      if (method === 'GET' && url === '/api/load-test-runs/run-2') return json(runningRun);
      if (method === 'POST' && url === '/api/load-test-runs/run-2/cancel') return json({});
      return json({});
    });
    renderPage();
    await screen.findByTestId('load-test-8');

    fireEvent.click(screen.getByRole('button', { name: 'Runs of Search' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Runs of Search' })).toBeInTheDocument();
    expect(await within(dialog).findByText('No run yet.')).toBeInTheDocument();

    await choose(within(dialog).getByRole('combobox', { name: 'Environment' }), 'QA');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start a run' }));

    await waitFor(() =>
      expect(sent('POST', '/api/load-tests/8/runs')).toEqual({ environmentId: 4 }),
    );
    expect(await screen.findByTestId('load-run-run-2')).toBeInTheDocument();
    expect(within(dialog).queryByText('No run yet.')).toBeNull();
    // One load test at a time: while this one runs another cannot be started.
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Start a run' })).toBeDisabled(),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop the run' }));
    await waitFor(() => expect(sent('POST', '/api/load-test-runs/run-2/cancel')).toBeDefined());
  });

  it('keeps the start button off while a run is queued, as while one runs', async () => {
    const queuedRun = { ...passedRun, status: 'queued', summary: null, finishedAt: null };
    answer({
      ...routes,
      'GET /api/load-tests/7': { ...checkout, runs: [queuedRun] },
      'GET /api/load-test-runs/run-1': queuedRun,
    });
    renderPage();
    await screen.findByTestId('load-test-7');
    fireEvent.click(screen.getByRole('button', { name: 'Runs of Checkout' }));
    const dialog = await screen.findByRole('dialog');
    expect(await screen.findByTestId('load-run-run-1')).toBeInTheDocument();
    // Once in the list of runs, once on the run itself.
    expect(within(dialog).getAllByText('Queued')).toHaveLength(2);
    expect(within(dialog).getByRole('button', { name: 'Start a run' })).toBeDisabled();
  });

  it('starts a run with no environment when none is chosen', async () => {
    answer({
      ...routes,
      'GET /api/load-tests/8': { ...search, runs: [] },
      'POST /api/load-tests/8/runs': reply(201, { id: 'run-3' }),
      'GET /api/load-test-runs/run-3': { ...passedRun, id: 'run-3', loadTestId: 8 },
    });
    renderPage();
    await screen.findByTestId('load-test-8');

    fireEvent.click(screen.getByRole('button', { name: 'Runs of Search' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Start a run' }));

    await waitFor(() => expect(sent('POST', '/api/load-tests/8/runs')).toEqual({}));
    expect(await screen.findByTestId('load-run-run-3')).toBeInTheDocument();
  });

  it("shows the server's reason when a run does not start", async () => {
    answer({
      ...routes,
      'GET /api/load-tests/7': { ...checkout, runs: [passedRun] },
      'GET /api/load-test-runs/run-1': passedRun,
      'POST /api/load-tests/7/runs': reply(409, { error: 'Another load test is running' }),
    });
    renderPage();
    await screen.findByTestId('load-test-7');

    fireEvent.click(screen.getByRole('button', { name: 'Runs of Checkout' }));
    const dialog = await screen.findByRole('dialog');
    // The last run is shown straight away.
    expect(await screen.findByTestId('load-run-run-1')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Start a run' }));
    await waitFor(() => expect(sent('POST', '/api/load-tests/7/runs')).toBeDefined());
    // Nothing new to follow: the failed start leaves the last run on screen.
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Start a run' })).toBeEnabled(),
    );
    expect(screen.getByTestId('load-run-run-1')).toBeInTheDocument();
  });

  it('asks before deleting and only then sends the delete', async () => {
    answer({ ...routes, 'DELETE /api/load-tests/7': reply(204) });
    renderPage();
    await screen.findByTestId('load-test-7');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Checkout' }));
    expect(await screen.findByRole('heading', { name: 'Delete Checkout?' })).toBeInTheDocument();
    expect(screen.getByText('Its runs go with it. The API tests stay.')).toBeInTheDocument();
    expect(sent('DELETE', '/api/load-tests/7')).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(sent('DELETE', '/api/load-tests/7')).toBeDefined());
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Delete Checkout?' })).toBeNull(),
    );
  });

  it('opens the editor on a new load test and on an existing one', async () => {
    answer(routes);
    renderPage();
    await screen.findByTestId('load-test-7');

    fireEvent.click(screen.getByRole('button', { name: 'New load test' }));
    expect(await screen.findByRole('heading', { name: 'New load test' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'New load test' })).toBeNull(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Checkout' }));
    expect(await screen.findByRole('heading', { name: 'Edit load test' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Checkout');
  });

  it('offers a viewer the runs of each test and nothing to change them with', async () => {
    role = 'viewer';
    answer({
      ...routes,
      'GET /api/load-tests/7': { ...checkout, runs: [passedRun] },
      'GET /api/load-test-runs/run-1': passedRun,
    });
    renderPage();
    await screen.findByTestId('load-test-7');

    expect(screen.queryByRole('button', { name: 'New load test' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Checkout' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Checkout' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Runs of Checkout' }));
    const dialog = await screen.findByRole('dialog');
    expect(await screen.findByTestId('load-run-run-1')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Start a run' })).toBeNull();
    expect(within(dialog).queryByRole('combobox', { name: 'Environment' })).toBeNull();
  });
});

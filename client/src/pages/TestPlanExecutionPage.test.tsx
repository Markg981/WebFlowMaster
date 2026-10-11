import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TestPlanExecutionPage from './TestPlanExecutionPage';

/**
 * Starting a run of one plan and following it: what the page says a run would execute, what it
 * sends to start one, where it points once the run is queued, and how it reports a refusal.
 * The live console has its own test (ExecutionLogConsole.test.tsx) and is a stub here.
 */

let role = 'editor';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 1, role } }) }));

vi.mock('wouter', () => ({
  useParams: () => ({ planId: 'plan-1' }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/ExecutionLogConsole', () => ({
  ExecutionLogConsole: ({ executionId }: { executionId: string }) => (
    <div data-testid="console">Console of {executionId}</div>
  ),
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

const nightly = { id: 'plan-1', name: 'Nightly', description: 'Runs every night.' };

const contents = {
  tests: [
    { type: 'ui', id: 1, name: 'Checkout by card' },
    { type: 'api', id: 2, name: 'Orders API' },
    { type: 'mobile', id: 3, name: 'Pay on Android' },
    { type: 'ui', id: 4, name: null },
  ],
  suites: [
    { id: 1, name: 'Smoke' },
    { id: 2, name: 'Checkout' },
  ],
  latestRun: { id: 'run-7', status: 'completed', startedAt: '2026-10-10T02:00:00.000Z' },
};

const routes = {
  'GET /api/test-plans/plan-1': nightly,
  'GET /api/test-plans/plan-1/contents': contents,
  'GET /api/environments': [
    { id: 4, name: 'QA', description: null, loginStateCapturedAt: null },
    { id: 5, name: 'Staging', description: null, loginStateCapturedAt: null },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TestPlanExecutionPage />
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

describe('TestPlanExecutionPage', () => {
  it('says it is loading until the plan arrives', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading Test Plan Details...')).toBeInTheDocument();
  });

  it("shows the server's reason when the plan cannot be loaded, and the way back", async () => {
    answer({
      ...routes,
      'GET /api/test-plans/plan-1': reply(404, { error: 'No such plan' }),
    });
    renderPage();
    expect(await screen.findByText('Error loading test plan: No such plan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Test Suites' })).toHaveAttribute(
      'href',
      '/test-plans',
    );
    expect(screen.queryByRole('button', { name: 'Start Execution' })).toBeNull();
  });

  it('shows the plan, what a run would execute, and its latest report', async () => {
    answer(routes);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Nightly' })).toBeInTheDocument();
    expect(screen.getByText('Runs every night.')).toBeInTheDocument();
    expect(screen.getByText('Running Test Plan')).toBeInTheDocument();

    const list = await screen.findByTestId('plan-contents');
    expect(within(list).getByText('Runs 4 tests')).toBeInTheDocument();
    expect(within(list).getByText('Checkout by card')).toBeInTheDocument();
    expect(within(list).getByText('Orders API').closest('li')).toHaveTextContent('(API)');
    expect(within(list).getByText('Pay on Android').closest('li')).toHaveTextContent(
      '(mobile app)',
    );
    expect(within(list).getByText('A test in a project you cannot see')).toBeInTheDocument();
    expect(within(list).getByText('Suites: Smoke, Checkout')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Latest report (completed)' })).toHaveAttribute(
      'href',
      '/test-plans/plan-1/executions/run-7/report',
    );
    expect(screen.getByText('Waiting for the run to start…')).toBeInTheDocument();
    expect(screen.queryByTestId('console')).toBeNull();
  });

  it('says so when the plan has nothing to run and has never run', async () => {
    answer({
      ...routes,
      'GET /api/test-plans/plan-1/contents': { tests: [], suites: [], latestRun: null },
    });
    renderPage();
    expect(await screen.findByText('This plan has no tests yet.')).toBeInTheDocument();
    expect(screen.getByText('Runs 0 tests')).toBeInTheDocument();
    expect(screen.queryByTestId('latest-report-link')).toBeNull();
  });

  it('starts a run against the chosen environment and follows it', async () => {
    answer({
      ...routes,
      'POST /api/run-test-plan/plan-1': { success: true, data: { id: 'run-9' } },
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Nightly' });

    await choose(screen.getByRole('combobox'), 'QA');
    fireEvent.click(screen.getByRole('button', { name: 'Start Execution' }));

    await waitFor(() => expect(sent('POST', '/api/run-test-plan/plan-1')).toBeDefined());
    expect(sent('POST', '/api/run-test-plan/plan-1')).toEqual({ environmentId: 4 });

    expect(await screen.findByTestId('console')).toHaveTextContent('Console of run-9');
    expect(screen.getByRole('link', { name: 'View detailed report' })).toHaveAttribute(
      'href',
      '/test-plans/plan-1/executions/run-9/report',
    );
    expect(screen.getByRole('button', { name: 'Run Again' })).toBeInTheDocument();
    expect(screen.queryByText('Waiting for the run to start…')).toBeNull();
    expect(screen.queryByTestId('latest-report-link')).toBeNull();
    expect(screen.queryByTestId('run-start-error')).toBeNull();
  });

  it('sends no environment when none is chosen', async () => {
    answer({
      ...routes,
      'POST /api/run-test-plan/plan-1': { success: true, data: { id: 'run-9' } },
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Nightly' });

    fireEvent.click(screen.getByRole('button', { name: 'Start Execution' }));
    await waitFor(() => expect(sent('POST', '/api/run-test-plan/plan-1')).toBeDefined());
    expect(sent('POST', '/api/run-test-plan/plan-1')).toEqual({});
  });

  it("shows the server's refusal and keeps offering to start", async () => {
    answer({
      ...routes,
      'POST /api/run-test-plan/plan-1': reply(409, {
        error: 'A run of this plan is already in progress',
      }),
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Nightly' });

    fireEvent.click(screen.getByRole('button', { name: 'Start Execution' }));
    expect(await screen.findByTestId('run-start-error')).toHaveTextContent(
      'A run of this plan is already in progress',
    );
    expect(screen.getByRole('button', { name: 'Start Execution' })).toBeEnabled();
    expect(screen.queryByTestId('console')).toBeNull();
    expect(screen.getByText('Waiting for the run to start…')).toBeInTheDocument();
  });

  it('shows a viewer the plan and its report with nothing to start it', async () => {
    role = 'viewer';
    answer(routes);
    renderPage();
    await screen.findByRole('heading', { name: 'Nightly' });

    expect(screen.getByText('Test plan')).toBeInTheDocument();
    expect(screen.queryByText('Running Test Plan')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start Execution' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(await screen.findByText('Runs 4 tests')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Latest report (completed)' })).toBeInTheDocument();
    expect(sent('POST', '/api/run-test-plan/plan-1')).toBeUndefined();
  });
});

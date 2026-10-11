import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SchedulingPage from './SchedulingPage';

/**
 * The scheduling page: every schedule of the organization in one table, and the dialogs that
 * create, change and delete one. The form itself is covered by ScheduleForm.test.tsx; what is
 * worth a test here is what the page sends and shows around it.
 */

let role = 'editor';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 1, role } }) }));

// The organization's environments, as the form's environment picker lists them.
vi.mock('@/hooks/use-environments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-environments')>();
  return {
    ...actual,
    useEnvironments: () => ({
      data: [{ id: 4, name: 'QA', description: null, loginStateCapturedAt: null }],
      isLoading: false,
    }),
  };
});

const fetchMock = vi.fn();

const nightly = {
  id: 'sched-1',
  scheduleName: 'Nightly',
  testPlanId: 'plan-1',
  testPlanName: 'Checkout plan',
  frequency: 'daily',
  nextRunAt: '2026-10-12T02:00:00.000Z',
  timezone: 'Europe/Rome',
  environment: 'QA',
  browsers: ['chromium', 'firefox'],
  isActive: true,
  retryOnFailure: 'none',
  notificationConfigOverride: null,
  executionParameters: null,
};
const weeklyCron = {
  ...nightly,
  id: 'sched-2',
  scheduleName: 'Monday report',
  testPlanName: undefined,
  frequency: 'cron:0 2 * * 1',
  timezone: null,
  environment: null,
  browsers: null,
  isActive: false,
};

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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SchedulingPage />
    </QueryClientProvider>,
  );
}

/** Radix opens a Select on keyboard activation only; JSDOM has no PointerEvent for a click. */
const choose = async (trigger: HTMLElement, option: string) => {
  await waitFor(() => expect(trigger).not.toBeDisabled());
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

describe('SchedulingPage', () => {
  it('says it is loading until the schedules arrive', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading schedules...')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Scheduling' })).toBeInTheDocument();
  });

  it('lists each schedule with its plan, frequency, zone, browsers and state', async () => {
    answer({ 'GET /api/test-plan-schedules': [nightly, weeklyCron] });
    renderPage();

    const nightlyRow = (await screen.findByText('Nightly')).closest('tr')!;
    expect(within(nightlyRow).getByText('Checkout plan')).toBeInTheDocument();
    expect(within(nightlyRow).getByText('Daily')).toBeInTheDocument();
    expect(within(nightlyRow).getByText('Europe/Rome')).toBeInTheDocument();
    expect(within(nightlyRow).getByText('QA')).toBeInTheDocument();
    expect(within(nightlyRow).getByText('chromium, firefox')).toBeInTheDocument();
    expect(within(nightlyRow).getByText('Active')).toBeInTheDocument();

    const mondayRow = screen.getByText('Monday report').closest('tr')!;
    // Without a joined plan name the id is shown; a custom frequency shows its expression.
    expect(within(mondayRow).getByText('plan-1')).toBeInTheDocument();
    expect(within(mondayRow).getByText('CRON (0 2 * * 1)')).toBeInTheDocument();
    expect(within(mondayRow).getByText('UTC')).toBeInTheDocument();
    expect(within(mondayRow).getAllByText('-')).toHaveLength(2);
    expect(within(mondayRow).getByText('Inactive')).toBeInTheDocument();
  });

  it('shows the empty state when there is nothing scheduled', async () => {
    answer({ 'GET /api/test-plan-schedules': [] });
    renderPage();
    expect(
      await screen.findByText('No schedules found. Create one to get started!'),
    ).toBeInTheDocument();
  });

  it("shows the server's reason when the schedules cannot be loaded", async () => {
    answer({
      'GET /api/test-plan-schedules': reply(500, { error: 'Database unavailable' }),
    });
    renderPage();
    expect(
      await screen.findByText('Error loading schedules: Database unavailable'),
    ).toBeInTheDocument();
  });

  it('creates a schedule from the dialog and sends what the form holds', async () => {
    answer({
      'GET /api/test-plan-schedules': [],
      'GET /api/test-plans': [
        { id: 'plan-1', name: 'Checkout plan' },
        { id: 'plan-2', name: 'Smoke plan' },
      ],
      'POST /api/test-plan-schedules': reply(201, { ...nightly, id: 'sched-9' }),
    });
    renderPage();
    await screen.findByText('No schedules found. Create one to get started!');

    fireEvent.click(screen.getByRole('button', { name: /Create Schedule/ }));
    expect(await screen.findByRole('heading', { name: 'Create New Schedule' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Schedule Name/i), {
      target: { value: 'Every morning' },
    });
    await choose(screen.getByLabelText(/^Test Plan$/i), 'Smoke plan');
    await choose(screen.getByLabelText(/^Frequency$/i), 'Daily');
    fireEvent.click(screen.getByLabelText('Firefox'));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Schedule' }));

    await waitFor(() => expect(sent('POST', '/api/test-plan-schedules')).toBeDefined());
    expect(sent('POST', '/api/test-plan-schedules')).toMatchObject({
      scheduleName: 'Every morning',
      testPlanId: 'plan-2',
      frequency: 'daily',
      browsers: ['chromium', 'firefox'],
      isActive: true,
      retryOnFailure: 'none',
      environment: null,
      notificationConfigOverride: null,
      executionParameters: null,
    });
    expect(typeof sent('POST', '/api/test-plan-schedules').nextRunAt).toBe('string');
    expect(sent('POST', '/api/test-plan-schedules').timezone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );

    // The dialog closes and the list is read again.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Create New Schedule' })).toBeNull(),
    );
    const listReads = fetchMock.mock.calls.filter(
      ([u, init]: any[]) => u === '/api/test-plan-schedules' && !init?.method,
    );
    expect(listReads.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the dialog open and sends nothing when the form is incomplete', async () => {
    answer({ 'GET /api/test-plan-schedules': [], 'GET /api/test-plans': [] });
    renderPage();
    await screen.findByText('No schedules found. Create one to get started!');

    fireEvent.click(screen.getByRole('button', { name: /Create Schedule/ }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Create Schedule' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    expect(await screen.findByText('Schedule name is required')).toBeInTheDocument();
    expect(screen.getByText('Test plan is required')).toBeInTheDocument();
    expect(sent('POST', '/api/test-plan-schedules')).toBeUndefined();
    expect(screen.getByRole('heading', { name: 'Create New Schedule' })).toBeInTheDocument();
  });

  it('edits a schedule in place and sends the change to its own URL', async () => {
    answer({
      'GET /api/test-plan-schedules': [nightly],
      'GET /api/test-plans': [{ id: 'plan-1', name: 'Checkout plan' }],
      'PUT /api/test-plan-schedules/sched-1': { ...nightly, scheduleName: 'Nightly (EU)' },
    });
    renderPage();
    await screen.findByText('Nightly');

    fireEvent.click(screen.getByRole('button', { name: 'Edit Schedule' }));
    expect(await screen.findByRole('heading', { name: 'Edit Schedule' })).toBeInTheDocument();
    expect(screen.getByText(/Editing schedule:/)).toHaveTextContent('Editing schedule: Nightly');

    const name = screen.getByLabelText(/Schedule Name/i);
    await waitFor(() => expect(name).toHaveValue('Nightly'));
    expect(screen.getByLabelText('Firefox')).toBeChecked();
    expect(screen.getByLabelText(/Timezone/i)).toHaveValue('Europe/Rome');

    fireEvent.change(name, { target: { value: 'Nightly (EU)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(sent('PUT', '/api/test-plan-schedules/sched-1')).toBeDefined());
    expect(sent('PUT', '/api/test-plan-schedules/sched-1')).toMatchObject({
      scheduleName: 'Nightly (EU)',
      testPlanId: 'plan-1',
      frequency: 'daily',
      timezone: 'Europe/Rome',
      // The legacy name "QA" is saved as the id of the environment of that name.
      environment: '4',
      browsers: ['chromium', 'firefox'],
    });
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Edit Schedule' })).toBeNull(),
    );
  });

  it('asks before deleting and only then sends the delete', async () => {
    answer({
      'GET /api/test-plan-schedules': [nightly],
      'DELETE /api/test-plan-schedules/sched-1': reply(204),
    });
    renderPage();
    await screen.findByText('Nightly');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Schedule' }));
    expect(await screen.findByRole('heading', { name: 'Confirm Deletion' })).toBeInTheDocument();
    expect(sent('DELETE', '/api/test-plan-schedules/sched-1')).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Confirm Deletion' })).toBeNull(),
    );
    expect(sent('DELETE', '/api/test-plan-schedules/sched-1')).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Schedule' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(sent('DELETE', '/api/test-plan-schedules/sched-1')).toBeDefined());
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Confirm Deletion' })).toBeNull(),
    );
  });

  it('offers a viewer the list and nothing to change it with', async () => {
    role = 'viewer';
    answer({ 'GET /api/test-plan-schedules': [nightly] });
    renderPage();
    await screen.findByText('Nightly');
    expect(screen.queryByRole('button', { name: /Create Schedule/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Schedule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Schedule' })).toBeNull();
    expect(screen.queryByText('Actions')).toBeNull();
  });
});

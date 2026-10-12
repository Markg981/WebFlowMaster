import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TestPlansPage from './TestPlansPage';

/**
 * The plans page: the list, its search and pages, and the way into each plan's run, settings,
 * suites, webhooks and reports. The dialogs themselves have their own tests; here they are stubs
 * that say which plan they were opened on.
 */

let role = 'editor';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 1, role } }) }));

const navigate = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/test-plans', navigate],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/dashboard/CreateTestPlanWizard', () => ({
  default: ({ isOpen, onPlanCreated }: { isOpen: boolean; onPlanCreated: () => void }) =>
    isOpen ? (
      <div>
        Wizard open
        <button onClick={onPlanCreated}>Pretend a plan was created</button>
      </div>
    ) : null,
}));
vi.mock('@/components/dashboard/EditTestPlanSettingsModal', () => ({
  default: ({ isOpen, plan }: { isOpen: boolean; plan: { name: string } | null }) =>
    isOpen ? <div>Settings of {plan?.name}</div> : null,
}));
vi.mock('@/components/suites/PlanSuitesDialog', () => ({
  default: ({ plan }: { plan: { name: string } | null }) =>
    plan ? <div>Suites of {plan.name}</div> : null,
}));
vi.mock('@/components/dashboard/WebhooksModal', () => ({
  default: ({ isOpen, planName }: { isOpen: boolean; planName: string }) =>
    isOpen ? <div>Webhooks of {planName}</div> : null,
}));

const fetchMock = vi.fn();

const plan = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `plan-${n}`,
  name: `Plan ${n}`,
  description: `Covers area ${n}`,
  ...extra,
});

function answerPlans(body: unknown, status = 200) {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => (url === '/api/test-plans' ? body : {}),
      text: async () => JSON.stringify(body),
    }),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TestPlansPage />
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

beforeEach(() => {
  role = 'editor';
  navigate.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TestPlansPage', () => {
  it('says it is loading until the plans arrive', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading Test Plans...')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Test Suites' })).toBeInTheDocument();
  });

  it("shows the server's reason when the plans cannot be loaded", async () => {
    answerPlans({ message: 'Not signed in' }, 401);
    renderPage();
    expect(await screen.findByText('Error loading Test Plans: Not signed in')).toBeInTheDocument();
  });

  it('shows the empty state and an empty pager', async () => {
    answerPlans([]);
    renderPage();
    expect(await screen.findByText('No Test Plans found.')).toBeInTheDocument();
    expect(screen.getByText('0-0 of 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('lists the plans five to a page with their descriptions', async () => {
    answerPlans([
      plan(1, { description: null }),
      plan(2),
      plan(3),
      plan(4),
      plan(5),
      plan(6),
      plan(7),
    ]);
    renderPage();

    expect(await screen.findByText('Plan 1')).toBeInTheDocument();
    expect(within(rowOf('Plan 1')).getByText('No Description')).toBeInTheDocument();
    expect(within(rowOf('Plan 2')).getByText('Covers area 2')).toBeInTheDocument();
    expect(within(rowOf('Plan 2')).getByText('Cross Browser Testing')).toBeInTheDocument();
    expect(screen.getByText('Plan 5')).toBeInTheDocument();
    expect(screen.queryByText('Plan 6')).toBeNull();
    expect(screen.getByText('1-5 of 7')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('6-7 of 7')).toBeInTheDocument();
    expect(screen.getByText('Plan 6')).toBeInTheDocument();
    expect(screen.queryByText('Plan 1')).toBeNull();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByText('1-5 of 7')).toBeInTheDocument();
  });

  it('narrows the list by name and clears the search again', async () => {
    answerPlans([plan(1, { name: 'Nightly checkout' }), plan(2, { name: 'Smoke' })]);
    renderPage();
    await screen.findByText('Smoke');

    fireEvent.change(screen.getByPlaceholderText('Search tests...'), {
      target: { value: 'smoke' },
    });
    expect(screen.queryByText('Nightly checkout')).toBeNull();
    expect(screen.getByText('Smoke')).toBeInTheDocument();
    expect(screen.getByText('1-1 of 1')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search tests...'), {
      target: { value: 'nothing like this' },
    });
    expect(screen.getByText('No Test Plans found.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByPlaceholderText('Search tests...')).toHaveValue('');
    expect(screen.getByText('Nightly checkout')).toBeInTheDocument();
    expect(screen.getByText('1-2 of 2')).toBeInTheDocument();
  });

  it('runs a plan on its own page, and points reports and scheduling at theirs', async () => {
    answerPlans([plan(1, { name: 'Nightly' })]);
    renderPage();
    const row = (await screen.findByText('Nightly')).closest('tr')!;

    fireEvent.click(within(row).getByRole('button', { name: 'Run' }));
    expect(navigate).toHaveBeenCalledWith('/test-plan/plan-1/run');

    expect(within(row).getByRole('link', { name: 'Reports' })).toHaveAttribute(
      'href',
      '/reports?planId=plan-1',
    );

    fireEvent.click(within(row).getByRole('button', { name: 'Schedule' }));
    expect(navigate).toHaveBeenCalledWith('/scheduling');
  });

  it("opens each plan's settings, suites and webhooks on that plan", async () => {
    answerPlans([plan(1, { name: 'Nightly' }), plan(2, { name: 'Smoke' })]);
    renderPage();
    await screen.findByText('Smoke');

    fireEvent.click(within(rowOf('Smoke')).getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Settings of Smoke')).toBeInTheDocument();

    fireEvent.click(within(rowOf('Nightly')).getByRole('button', { name: 'Suites' }));
    expect(screen.getByText('Suites of Nightly')).toBeInTheDocument();

    fireEvent.click(within(rowOf('Smoke')).getByRole('button', { name: 'Webhooks' }));
    expect(screen.getByText('Webhooks of Smoke')).toBeInTheDocument();
  });

  it('opens the wizard and reads the plans again once one is created', async () => {
    answerPlans([plan(1)]);
    renderPage();
    await screen.findByText('Plan 1');
    expect(screen.queryByText('Wizard open')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '+ Test Plan' }));
    expect(screen.getByText('Wizard open')).toBeInTheDocument();

    const readsBefore = fetchMock.mock.calls.filter(([u]) => u === '/api/test-plans').length;
    fireEvent.click(screen.getByRole('button', { name: 'Pretend a plan was created' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u]) => u === '/api/test-plans').length).toBe(
        readsBefore + 1,
      ),
    );
  });

  it('shows the schedules tab with the way to the scheduling page', async () => {
    answerPlans([plan(1)]);
    renderPage();
    await screen.findByText('Plan 1');

    // Radix switches a tab on mouse-down, not on click.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Schedules' }));
    expect(await screen.findByText('Schedules content goes here.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(navigate).toHaveBeenCalledWith('/scheduling');
  });

  it('offers a viewer the reports and a read-only way into each plan, nothing else', async () => {
    role = 'viewer';
    answerPlans([plan(1, { name: 'Nightly' })]);
    renderPage();
    const row = (await screen.findByText('Nightly')).closest('tr')!;

    expect(screen.queryByRole('button', { name: '+ Test Plan' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Run' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Settings' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Suites' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Schedule' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Webhooks' })).toBeNull();
    expect(within(row).getByRole('link', { name: 'Reports' })).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Open' }));
    expect(navigate).toHaveBeenCalledWith('/test-plan/plan-1/run');
  });
});

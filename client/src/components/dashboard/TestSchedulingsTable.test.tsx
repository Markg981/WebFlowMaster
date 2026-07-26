import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { format } from 'date-fns';
import TestSchedulingsTable from './TestSchedulingsTable';
import * as schedulesApi from '@/lib/api/schedules';
import { TestRouter } from '@/test-utils/router';

// Mocks
vi.mock('@/lib/api/schedules');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: Infinity,
    },
  },
});

const AllTheProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <TestRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TestRouter>
  );
};

const fetchAllSchedules = vi.mocked(schedulesApi.fetchAllSchedules);

// `fetchAllSchedules` parses `nextRunAt` into a Date before returning; the component relies
// on that (`nextRunAt instanceof Date`), so the mock has to hand back the parsed shape too.
const mockSchedules = [
  {
    id: 'sched1', testPlanId: 'tp1', testPlanName: 'Alpha Plan', scheduleName: 'Daily QA',
    frequency: 'daily@10:00', nextRunAt: new Date('2024-08-15T10:00:00Z'),
    environment: 'QA', browsers: ['chromium'], isActive: true, retryOnFailure: 'none', createdAt: new Date(),
  },
  {
    id: 'sched2', testPlanId: 'tp2', testPlanName: 'Beta Plan', scheduleName: 'Weekly Staging',
    frequency: 'weekly@Mon,14:30', nextRunAt: new Date('2024-08-19T14:30:00Z'),
    environment: 'Staging', browsers: ['firefox', 'webkit'], isActive: true, retryOnFailure: 'once', createdAt: new Date(),
  },
  {
    id: 'sched3', testPlanId: 'tp3', testPlanName: 'Gamma Plan', scheduleName: 'Nightly Inactive',
    frequency: 'daily@01:00', nextRunAt: new Date('2024-08-16T01:00:00Z'),
    environment: 'Production', browsers: ['chromium'], isActive: false, retryOnFailure: 'none', createdAt: new Date(),
  },
] as unknown as schedulesApi.TestPlanScheduleEnhanced[];

describe('TestSchedulingsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('renders loading state initially', () => {
    fetchAllSchedules.mockReturnValue(new Promise(() => {})); // Never resolves
    render(<TestSchedulingsTable />, { wrapper: AllTheProviders });
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders error state if fetching schedules fails', async () => {
    const errorMessage = 'Failed to fetch';
    fetchAllSchedules.mockRejectedValue(new Error(errorMessage));
    render(<TestSchedulingsTable />, { wrapper: AllTheProviders });

    expect(await screen.findByText('Error loading schedules.')).toBeInTheDocument();
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('renders "no upcoming schedules" message when no active schedules are returned', async () => {
    fetchAllSchedules.mockResolvedValue(mockSchedules.filter((s) => !s.isActive));
    render(<TestSchedulingsTable />, { wrapper: AllTheProviders });
    expect(await screen.findByText('No upcoming active schedules.')).toBeInTheDocument();
  });

  it('renders table with active schedules sorted by nextRunAt', async () => {
    const activeSchedules = mockSchedules.filter((s) => s.isActive);
    fetchAllSchedules.mockResolvedValue([...mockSchedules]); // mix of active/inactive

    render(<TestSchedulingsTable />, { wrapper: AllTheProviders });

    // 'Daily QA' runs before 'Weekly Staging', so it is rendered first.
    expect(await screen.findByText('Daily QA')).toBeInTheDocument();
    expect(screen.getByText('Alpha Plan')).toBeInTheDocument(); // Test Plan Name
    expect(screen.getByText('QA')).toBeInTheDocument(); // Environment
    expect(
      screen.getByText(format(mockSchedules[0].nextRunAt as Date, 'PPpp')),
    ).toBeInTheDocument();
    expect(screen.getByText('daily@10:00')).toBeInTheDocument(); // Frequency

    const activeBadges = screen.getAllByText('Active');
    expect(activeBadges.length).toBe(activeSchedules.length); // Only active schedules shown

    // The inactive schedule must not be rendered.
    expect(screen.queryByText('Nightly Inactive')).not.toBeInTheDocument();

    const viewAllLink = screen.getByText('View All');
    expect(viewAllLink.closest('a')).toHaveAttribute('href', '/test-suites');

    const planLink = screen.getByText('Alpha Plan');
    expect(planLink.closest('a')).toHaveAttribute(
      'href',
      `/test-suites?planId=${mockSchedules[0].testPlanId}&tab=schedules`,
    );
  });

  it('displays only top 5 upcoming active schedules', async () => {
    const manyActiveSchedules = Array.from({ length: 10 }, (_unused, i) => ({
      id: `sched${i}`,
      testPlanId: `tp${i}`,
      testPlanName: `Plan ${i}`,
      scheduleName: `Schedule ${i}`,
      frequency: 'daily',
      nextRunAt: new Date(Date.now() + i * 3600_000), // one per hour from now
      isActive: true,
      retryOnFailure: 'none',
      createdAt: new Date(),
    })) as unknown as schedulesApi.TestPlanScheduleEnhanced[];

    fetchAllSchedules.mockResolvedValue(manyActiveSchedules);
    render(<TestSchedulingsTable />, { wrapper: AllTheProviders });

    await waitFor(() => {
      expect(screen.getByText('Schedule 0')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    expect(rows.length).toBe(5 + 1); // 5 data rows + 1 header row

    expect(screen.queryByText('Schedule 5')).not.toBeInTheDocument();
  });
});

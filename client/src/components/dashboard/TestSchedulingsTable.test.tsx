import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n'; // Your i18n instance
import TestSchedulingsTable from './TestSchedulingsTable';
import * as schedulesApi from '@/lib/api/schedules';
import { MemoryRouter } from 'wouter'; // To handle <Link> components

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
    <MemoryRouter> {/* Added MemoryRouter */}
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          {children}
        </I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

const mockSchedules: schedulesApi.TestPlanScheduleWithPlanName[] = [
  {
    id: 'sched1', testPlanId: 'tp1', testPlanName: 'Alpha Plan', scheduleName: 'Daily QA',
    frequency: 'daily@10:00', nextRunAt: Math.floor(new Date('2024-08-15T10:00:00Z').getTime() / 1000),
    environment: 'QA', browsers: ['chromium'], isActive: true, retryOnFailure: 'none', createdAt: Date.now()
  },
  {
    id: 'sched2', testPlanId: 'tp2', testPlanName: 'Beta Plan', scheduleName: 'Weekly Staging',
    frequency: 'weekly@Mon,14:30', nextRunAt: Math.floor(new Date('2024-08-19T14:30:00Z').getTime() / 1000),
    environment: 'Staging', browsers: ['firefox', 'webkit'], isActive: true, retryOnFailure: 'once', createdAt: Date.now()
  },
  {
    id: 'sched3', testPlanId: 'tp3', testPlanName: 'Gamma Plan', scheduleName: 'Nightly Inactive',
    frequency: 'daily@01:00', nextRunAt: Math.floor(new Date('2024-08-16T01:00:00Z').getTime() / 1000),
    environment: 'Production', browsers: ['chromium'], isActive: false, retryOnFailure: 'none', createdAt: Date.now()
  },
];

describe('TestSchedulingsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('renders loading state initially', () => {
    (schedulesApi.fetchAllSchedules as vi.Mock).mockReturnValue(new Promise(() => {})); // Never resolves
    render(<TestSchedulingsTable />, { wrapper: AllTheProviders });
    expect(screen.getByText('dashboard.testSchedulingsTable.loading.text')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument(); // Assuming Loader2 has role="status" or similar accessibility attribute
  });

  it('renders error state if fetching schedules fails', async () => {
    const errorMessage = 'Failed to fetch';
    (schedulesApi.fetchAllSchedules as vi.Mock).mockRejectedValue(new Error(errorMessage));
    render(<TestSchedulingsTable />, { wrapper: AllTheProviders });

    expect(await screen.findByText('dashboard.testSchedulingsTable.error.text')).toBeInTheDocument();
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('renders "no upcoming schedules" message when no active schedules are returned', async () => {
    (schedulesApi.fetchAllSchedules as vi.Mock).mockResolvedValue(
        mockSchedules.filter(s => !s.isActive) // Return only inactive schedules
    );
    render(<TestSchedulingsTable />, { wrapper: AllTheProviders });
    expect(await screen.findByText('dashboard.testSchedulingsTable.noUpcomingSchedules.text')).toBeInTheDocument();
  });

  it('renders table with active schedules sorted by nextRunAt', async () => {
    // Ensure mocks return schedules that will be filtered and sorted correctly
    const activeSchedules = mockSchedules.filter(s => s.isActive);
    (schedulesApi.fetchAllSchedules as vi.Mock).mockResolvedValue([...mockSchedules]); // mix of active/inactive

    render(<TestSchedulingsTable />, { wrapper: AllTheProviders });

    // Wait for the first active schedule to appear (sorted by nextRunAt)
    // mockSchedules[0] is 'Daily QA' at 2024-08-15T10:00:00Z
    // mockSchedules[1] is 'Weekly Staging' at 2024-08-19T14:30:00Z
    // The table should display 'Daily QA' first.
    expect(await screen.findByText('Daily QA')).toBeInTheDocument();
    expect(screen.getByText('Alpha Plan')).toBeInTheDocument(); // Test Plan Name
    expect(screen.getByText('QA')).toBeInTheDocument(); // Environment
    expect(screen.getByText(format(new Date(mockSchedules[0].nextRunAt! * 1000), 'PPpp'))).toBeInTheDocument();
    expect(screen.getByText('daily@10:00')).toBeInTheDocument(); // Frequency

    const activeBadges = screen.getAllByText('dashboard.testSchedulingsTable.status.active');
    expect(activeBadges.length).toBe(activeSchedules.length); // Only active schedules shown

    // Check that the inactive schedule is not rendered
    expect(screen.queryByText('Nightly Inactive')).not.toBeInTheDocument();

    // Check link to test suites page
    const viewAllLink = screen.getByText('dashboard.testSchedulingsTable.viewAll.link');
    expect(viewAllLink).toBeInTheDocument();
    expect(viewAllLink.closest('a')).toHaveAttribute('href', '/test-suites');

    // Check link from Test Plan Name to specific plan schedules
    const planLink = screen.getByText('Alpha Plan');
    expect(planLink.closest('a')).toHaveAttribute('href', `/test-suites?planId=${mockSchedules[0].testPlanId}&tab=schedules`);
  });

  it('displays only top 5 upcoming active schedules', async () => {
    const manyActiveSchedules: schedulesApi.TestPlanScheduleWithPlanName[] = [];
    for (let i = 0; i < 10; i++) {
      manyActiveSchedules.push({
        id: `sched${i}`, testPlanId: `tp${i}`, testPlanName: `Plan ${i}`, scheduleName: `Schedule ${i}`,
        frequency: 'daily', nextRunAt: Math.floor(new Date().getTime() / 1000) + (i * 3600), // Runs every hour from now
        isActive: true, retryOnFailure: 'none', createdAt: Date.now()
      });
    }
    (schedulesApi.fetchAllSchedules as vi.Mock).mockResolvedValue(manyActiveSchedules);
    render(<TestSchedulingsTable />, { wrapper: AllTheProviders });

    await waitFor(() => {
        expect(screen.getByText('Schedule 0')).toBeInTheDocument(); // First one
    });
    // Should display 5 schedules
    const rows = screen.getAllByRole('row'); // Includes header row
    expect(rows.length).toBe(5 + 1); // 5 data rows + 1 header row

    // The 6th schedule (index 5) should not be present
    expect(screen.queryByText('Schedule 5')).not.toBeInTheDocument();
  });

});

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TestSchedulingsTable from './TestSchedulingsTable'; // Adjust path as necessary
import { Badge } from '@/components/ui/badge'; // Actual Badge for better integration

// Mock lucide-react icons used in this component
vi.mock('lucide-react', async (importOriginal) => {
  const original = await importOriginal<typeof import('lucide-react')>();
  return {
    ...original,
    Loader2: (props: any) => <div data-testid="loader-icon" {...props}>Loader</div>,
    AlertCircle: (props: any) => <div data-testid="alert-icon" {...props}>Alert</div>,
    CalendarDays: (props: any) => <div data-testid="calendar-days-icon" {...props}>Calendar</div>,
    CheckCircle: (props: any) => <div data-testid="check-circle-icon" {...props}>CompletedIcon</div>,
    XCircle: (props: any) => <div data-testid="x-circle-icon" {...props}>FailedIcon</div>,
    Clock: (props: any) => <div data-testid="clock-icon" {...props}>InProgressIcon</div>,
    AlertTriangle: (props: any) => <div data-testid="alert-triangle-icon" {...props}>CancelledIcon</div>,
  };
});

// Mock Badge component minimally if needed, or use the actual one if it's simple enough
// For this test, we'll use the actual Badge component if it doesn't cause issues.
// If it does, mock it like: vi.mock('@/components/ui/badge', () => ({ Badge: ({children}) => <div>{children}</div> }))

const createTestQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const mockScheduledTestData = [
  { id: 'sched1', dateTime: '2023-11-20 10:00', testSuite: 'Login & Signup Suite', status: 'Completed', environment: 'Production', triggeredBy: 'NightlyJob' },
  { id: 'sched2', dateTime: '2023-11-20 14:00', testSuite: 'Payment Gateway Tests', status: 'Failed', environment: 'Staging', triggeredBy: 'Jane Doe' },
  { id: 'sched3', dateTime: '2023-11-21 09:00', testSuite: 'User Profile Features', status: 'Scheduled', environment: 'Production', triggeredBy: 'AutoScheduler' },
];
const mockEmptyData: any[] = [];

describe('TestSchedulingsTable', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  const renderWithClient = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    );
  };

  it('displays loading state initially', async () => {
    renderWithClient(<TestSchedulingsTable />);
    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
  });

  it('displays error state if API call fails', async () => {
    queryClient.setQueryData(['testSchedulings'], () => { throw new Error('Network Error'); });
    renderWithClient(<TestSchedulingsTable />);
    await waitFor(() => {
      expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
      expect(screen.getByText('Error loading schedulings.')).toBeInTheDocument();
    });
  });

  it('displays "No test schedulings found" message when data is empty', async () => {
    queryClient.setQueryData(['testSchedulings'], mockEmptyData);
    renderWithClient(<TestSchedulingsTable />);
    await waitFor(() => {
      expect(screen.getByTestId('calendar-days-icon')).toBeInTheDocument(); // From the empty state
      expect(screen.getByText('No test schedulings found.')).toBeInTheDocument();
    });
  });

  it('renders table with correct headers and data when API call succeeds', async () => {
    queryClient.setQueryData(['testSchedulings'], mockScheduledTestData);
    renderWithClient(<TestSchedulingsTable />);

    await waitFor(() => {
      // Check for table title
      expect(screen.getByText('Upcoming & Recent Schedulings')).toBeInTheDocument();

      // Check for table headers
      expect(screen.getByText('Date/Time')).toBeInTheDocument();
      expect(screen.getByText('Test Suite')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Environment')).toBeInTheDocument();
      expect(screen.getByText('Triggered By')).toBeInTheDocument();

      // Check for data rows (example: first row)
      const firstRow = screen.getByText(mockScheduledTestData[0].testSuite).closest('tr');
      expect(firstRow).not.toBeNull();
      if (firstRow) {
        expect(within(firstRow).getByText(new Date(mockScheduledTestData[0].dateTime).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))).toBeInTheDocument();
        expect(within(firstRow).getByText('Completed')).toBeInTheDocument(); // Badge text
        expect(within(firstRow).getByTestId('check-circle-icon')).toBeInTheDocument(); // Status icon
        expect(within(firstRow).getByText(mockScheduledTestData[0].environment)).toBeInTheDocument();
        expect(within(firstRow).getByText(mockScheduledTestData[0].triggeredBy!)).toBeInTheDocument();
      }

      // Check number of data rows rendered
      // Assuming each data item creates a row, and header row is separate.
      // `querySelectorAll` on table body rows.
      const table = screen.getByRole('table');
      const dataRows = within(table).getAllByRole('row').slice(1); // Exclude header row
      expect(dataRows.length).toBe(mockScheduledTestData.length);

      // Verify status badge and icon for a 'Failed' item
      const failedRow = screen.getByText(mockScheduledTestData[1].testSuite).closest('tr');
      expect(failedRow).not.toBeNull();
      if (failedRow) {
        expect(within(failedRow).getByText('Failed')).toBeInTheDocument();
        expect(within(failedRow).getByTestId('x-circle-icon')).toBeInTheDocument();
      }
    });
  });
});

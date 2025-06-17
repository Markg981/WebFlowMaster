import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Switch, Route } from 'wouter'; // Import wouter components for Link
import QuickAccessReports from './QuickAccessReports';

// Mock lucide-react icons
vi.mock('lucide-react', async (importOriginal) => {
  const original = await importOriginal<typeof import('lucide-react')>();
  return {
    ...original,
    Loader2: (props: any) => <div data-testid="loader-icon" {...props}>Loader</div>,
    AlertCircle: (props: any) => <div data-testid="alert-icon" {...props}>Alert</div>,
    FileText: (props: any) => <div data-testid="file-text-icon" {...props}>FileTextIcon</div>,
    ListChecks: (props: any) => <div data-testid="list-checks-icon" {...props}>ListChecksIcon</div>,
    Image: (props: any) => <div data-testid="image-icon" {...props}>ImageIcon</div>,
  };
});

// Mock ui components if necessary, e.g. Button, Badge.
// Using actual ones if they are simple.

const createTestQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const mockReportData = [
  { id: 'run101', testName: 'User Authentication Flow', completedAt: '2023-11-21 09:15', status: 'Passed', reportUrl: '/reports/run101', logsUrl: '/reports/run101/logs', screenshotsUrl: '/reports/run101/screenshots' },
  { id: 'run102', testName: 'Product Search & Filter', completedAt: '2023-11-21 08:30', status: 'Failed', reportUrl: '/reports/run102', logsUrl: '/reports/run102/logs', screenshotsUrl: '/reports/run102/screenshots' },
];
const mockEmptyData: any[] = [];


// wouter's Link components need a Router context.
const RouterWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Switch>
    <Route path=".*">{children}</Route> {/* Catch-all route for testing Links */}
  </Switch>
);


describe('QuickAccessReports', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  const renderWithClientAndRouter = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <RouterWrapper>{ui}</RouterWrapper>
      </QueryClientProvider>
    );
  };

  it('displays loading state initially', async () => {
    renderWithClientAndRouter(<QuickAccessReports />);
    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
  });

  it('displays error state if API call fails', async () => {
    queryClient.setQueryData(['recentTestRuns'], () => { throw new Error('Network Error'); });
    renderWithClientAndRouter(<QuickAccessReports />);
    await waitFor(() => {
      expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
      expect(screen.getByText('Error loading reports.')).toBeInTheDocument();
    });
  });

  it('displays "No recent test reports found" message when data is empty', async () => {
    queryClient.setQueryData(['recentTestRuns'], mockEmptyData);
    renderWithClientAndRouter(<QuickAccessReports />);
    await waitFor(() => {
      expect(screen.getByTestId('file-text-icon')).toBeInTheDocument(); // From empty state
      expect(screen.getByText('No recent test reports found.')).toBeInTheDocument();
    });
  });

  it('renders report items with correct data and links when API call succeeds', async () => {
    queryClient.setQueryData(['recentTestRuns'], mockReportData);
    renderWithClientAndRouter(<QuickAccessReports />);

    await waitFor(() => {
      // Check for section title
      expect(screen.getByText('Recent Test Reports')).toBeInTheDocument();

      // Check first report item
      const firstReport = mockReportData[0];
      const firstReportCard = screen.getByText(firstReport.testName).closest('div.border'); // Find the card div
      expect(firstReportCard).not.toBeNull();

      if (firstReportCard) {
        expect(within(firstReportCard).getByText(firstReport.testName)).toBeInTheDocument();
        // Check link on test name
        const testNameLink = within(firstReportCard).getByText(firstReport.testName) as HTMLLinkElement;
        expect(testNameLink.closest('a')).toHaveAttribute('href', firstReport.reportUrl);

        expect(within(firstReportCard).getByText(firstReport.status)).toBeInTheDocument(); // Badge text
        expect(within(firstReportCard).getByText(`Completed: ${new Date(firstReport.completedAt).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`)).toBeInTheDocument();

        // Check buttons/links
        const reportLink = within(firstReportCard).getByText('View Report').closest('a');
        expect(reportLink).toHaveAttribute('href', firstReport.reportUrl);
        expect(within(reportLink!).getByTestId('file-text-icon')).toBeInTheDocument();

        const logsLink = within(firstReportCard).getByText('Logs').closest('a');
        expect(logsLink).toHaveAttribute('href', firstReport.logsUrl);
        expect(within(logsLink!).getByTestId('list-checks-icon')).toBeInTheDocument();

        const screenshotsLink = within(firstReportCard).getByText('Screenshots').closest('a');
        expect(screenshotsLink).toHaveAttribute('href', firstReport.screenshotsUrl);
        expect(within(screenshotsLink!).getByTestId('image-icon')).toBeInTheDocument();
      }

      // Check that correct number of report items are rendered
      const reportCards = screen.getAllByText(/Completed:/); // Each card has "Completed:" text
      expect(reportCards.length).toBe(mockReportData.length);
    });
  });
});

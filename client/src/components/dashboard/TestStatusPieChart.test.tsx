import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TestStatusPieChart from './TestStatusPieChart';

// Mock API function (fetchTestStatusSummary)
// This is tricky if it's defined in the same file. Assume it's mockable or test via useQuery's behavior.
// For robust mocking, API calls should be in their own module.
// We will mock the useQuery hook itself for this component.

// Mock Recharts components to avoid complex rendering in tests
// and focus on data flow and conditional rendering logic.
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>();
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
    PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
    Pie: () => <div data-testid="pie-element" />,
    Cell: () => <div data-testid="cell-element" />,
    Tooltip: () => <div data-testid="tooltip-element" />,
    Legend: () => <div data-testid="legend-element" />,
  };
});

vi.mock('lucide-react', async (importOriginal) => {
  const original = await importOriginal<typeof import('lucide-react')>();
  return {
    ...original,
    Loader2: (props: any) => <div data-testid="loader-icon" {...props}>Loader</div>,
    AlertCircle: (props: any) => <div data-testid="alert-icon" {...props}>Alert</div>,
  };
});

const createTestQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// Mock data for API
const mockSuccessData = { passed: 300, failed: 50, running: 10, skipped: 5 };
const mockEmptyData = { passed: 0, failed: 0, running: 0, skipped: 0 };

// We need to properly mock useQuery for this component
// For now, we will use queryClient.setQueryData to simulate API responses.

describe('TestStatusPieChart', () => {
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
    // To test loading, don't pre-fill cache. useQuery will be 'loading'.
    renderWithClient(<TestStatusPieChart />);
    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
  });

  it('displays error state if API call fails', async () => {
    // Simulate an error by making the query fail
    queryClient.setQueryData(['testStatusSummary'], () => {
      throw new Error('Network Error');
    });

    renderWithClient(<TestStatusPieChart />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
      expect(screen.getByText('Error loading chart data.')).toBeInTheDocument();
    });
  });

  it('displays "No data available" message when data is empty or all zeros', async () => {
    queryClient.setQueryData(['testStatusSummary'], mockEmptyData);
    renderWithClient(<TestStatusPieChart />);

    await waitFor(() => {
      expect(screen.getByText('No data available to display.')).toBeInTheDocument();
    });
  });

  it('renders chart title and chart elements when data is available', async () => {
    queryClient.setQueryData(['testStatusSummary'], mockSuccessData);
    renderWithClient(<TestStatusPieChart />);

    await waitFor(() => {
      expect(screen.getByText('Test Status Overview')).toBeInTheDocument();
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
      expect(screen.getByTestId('pie-element')).toBeInTheDocument();
      // We expect multiple cells, tooltips, legends due to mock structure
      expect(screen.getAllByTestId('cell-element').length).toBeGreaterThan(0);
      expect(screen.getByTestId('tooltip-element')).toBeInTheDocument();
      expect(screen.getByTestId('legend-element')).toBeInTheDocument();
    });
  });
});

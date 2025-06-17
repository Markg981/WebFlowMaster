import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TestTrendBarChart from './TestTrendBarChart';

// Mock Recharts components
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>();
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
    BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
    Bar: () => <div data-testid="bar-element" />,
    XAxis: () => <div data-testid="xaxis-element" />,
    YAxis: () => <div data-testid="yaxis-element" />,
    CartesianGrid: () => <div data-testid="grid-element" />,
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
const mockSuccessData = [
  { date: 'Mon', passed: 60, failed: 8, running: 3 },
  { date: 'Tue', passed: 55, failed: 5, running: 2 },
];
const mockEmptyData: any[] = [];

describe('TestTrendBarChart', () => {
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
    renderWithClient(<TestTrendBarChart />);
    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
  });

  it('displays error state if API call fails', async () => {
    queryClient.setQueryData(['testTrends'], () => {
      throw new Error('Network Error');
    });
    renderWithClient(<TestTrendBarChart />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
      expect(screen.getByText('Error loading chart data.')).toBeInTheDocument();
    });
  });

  it('displays "No data available" message when data is empty', async () => {
    queryClient.setQueryData(['testTrends'], mockEmptyData);
    renderWithClient(<TestTrendBarChart />);

    await waitFor(() => {
      expect(screen.getByText('No data available to display.')).toBeInTheDocument();
    });
  });

  it('renders chart title and chart elements when data is available', async () => {
    queryClient.setQueryData(['testTrends'], mockSuccessData);
    renderWithClient(<TestTrendBarChart />);

    await waitFor(() => {
      expect(screen.getByText('Weekly Test Trends')).toBeInTheDocument();
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
      // Expect multiple bar elements (one for passed, one for failed, one for running per data entry - but mock is simplified)
      expect(screen.getAllByTestId('bar-element').length).toBeGreaterThan(0);
      expect(screen.getByTestId('xaxis-element')).toBeInTheDocument();
      expect(screen.getByTestId('yaxis-element')).toBeInTheDocument();
      expect(screen.getByTestId('grid-element')).toBeInTheDocument();
      expect(screen.getByTestId('tooltip-element')).toBeInTheDocument();
      expect(screen.getByTestId('legend-element')).toBeInTheDocument();
    });
  });
});

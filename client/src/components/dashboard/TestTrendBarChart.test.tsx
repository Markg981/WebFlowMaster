import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TestTrendBarChart from './TestTrendBarChart';

/**
 * The chart takes `data`/`isLoading` as props — the dashboard page owns the query. Recharts
 * is stubbed because `ResponsiveContainer` measures its parent, and JSDOM reports 0×0, so
 * the real chart would never render its children.
 */
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>();
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    BarChart: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="bar-chart">{children}</div>
    ),
    Bar: ({ name }: { name?: string }) => <div data-testid={`bar-${name}`} />,
    XAxis: () => <div data-testid="x-axis" />,
    YAxis: () => <div data-testid="y-axis" />,
    CartesianGrid: () => <div data-testid="cartesian-grid" />,
    Tooltip: () => <div data-testid="tooltip-element" />,
    Legend: () => <div data-testid="legend-element" />,
  };
});

vi.mock('lucide-react', async (importOriginal) => {
  const original = await importOriginal<typeof import('lucide-react')>();
  return {
    ...original,
    Loader2: (props: Record<string, unknown>) => <div data-testid="loader-icon" {...props} />,
  };
});

const sampleData = [
  { date: '2024-08-01', passed: 10, failed: 2, total: 12 },
  { date: '2024-08-02', passed: 8, failed: 0, total: 8 },
];

describe('TestTrendBarChart', () => {
  it('renders the chart title', () => {
    render(<TestTrendBarChart data={sampleData} />);

    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  it('shows a spinner while loading', () => {
    render(<TestTrendBarChart isLoading />);

    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('shows an empty message for an empty series', () => {
    render(<TestTrendBarChart data={[]} />);

    expect(screen.getByText('No runs in the last 30 days')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('treats thirty zero-filled days as empty, not as a trend', () => {
    // The aggregation fills in every day of the window, so a full array of zeroes is exactly
    // what an account with no executions receives. Drawing thirty empty columns and calling
    // it a trend is worse than saying plainly that nothing has run.
    const zeroFilled = Array.from({ length: 30 }, (_, index) => ({
      date: `2024-08-${String(index + 1).padStart(2, '0')}`,
      passed: 0,
      failed: 0,
      total: 0,
    }));

    render(<TestTrendBarChart data={zeroFilled} />);

    expect(screen.getByText('No runs in the last 30 days')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('shows an empty message when no data is supplied at all', () => {
    render(<TestTrendBarChart />);

    expect(screen.getByText('No runs in the last 30 days')).toBeInTheDocument();
  });

  it('renders a stacked passed/failed series when data is available', () => {
    render(<TestTrendBarChart data={sampleData} />);

    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.getByTestId('bar-Passed')).toBeInTheDocument();
    expect(screen.getByTestId('bar-Failed')).toBeInTheDocument();
  });
});

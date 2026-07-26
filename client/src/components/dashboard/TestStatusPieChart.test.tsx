import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TestStatusPieChart from './TestStatusPieChart';

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
    PieChart: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="pie-chart">{children}</div>
    ),
    Pie: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="pie-element">{children}</div>
    ),
    Cell: () => <div data-testid="cell-element" />,
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
  { name: 'Passed', value: 300, fill: '#0f0' },
  { name: 'Failed', value: 50, fill: '#f00' },
  { name: 'Skipped', value: 0, fill: '#999' },
];

describe('TestStatusPieChart', () => {
  it('renders the chart title', () => {
    render(<TestStatusPieChart data={sampleData} />);

    expect(screen.getByText('Test Status Overview')).toBeInTheDocument();
  });

  it('shows a spinner while loading', () => {
    render(<TestStatusPieChart isLoading />);

    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
  });

  it('shows an empty message when there are no executions', () => {
    render(<TestStatusPieChart data={[{ name: 'Passed', value: 0, fill: '#0f0' }]} />);

    expect(screen.getByText('No test executions found.')).toBeInTheDocument();
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
  });

  it('shows an empty message when no data is supplied at all', () => {
    render(<TestStatusPieChart />);

    expect(screen.getByText('No test executions found.')).toBeInTheDocument();
  });

  it('renders one cell per non-zero slice when data is available', () => {
    render(<TestStatusPieChart data={sampleData} />);

    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    // The zero-valued "Skipped" slice is filtered out before rendering.
    expect(screen.getAllByTestId('cell-element')).toHaveLength(2);
  });
});

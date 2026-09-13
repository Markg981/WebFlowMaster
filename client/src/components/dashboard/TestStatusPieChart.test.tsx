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

/**
 * The aggregation sends a stable status id per slice and nothing else. It used to send a
 * `fill` hex and an English `name`, which put the palette and the wording of the interface
 * in the query layer: the slices could not follow the theme and the legend read "Passed" in
 * every language the product ships.
 */
const sampleData = [
  { status: 'passed' as const, value: 300 },
  { status: 'failed' as const, value: 50 },
  { status: 'pending' as const, value: 0 },
];

describe('TestStatusPieChart', () => {
  it('renders the chart title', () => {
    render(<TestStatusPieChart data={sampleData} />);

    expect(screen.getByText('Execution status')).toBeInTheDocument();
  });

  it('shows a spinner while loading', () => {
    render(<TestStatusPieChart isLoading />);

    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
  });

  it('offers a way forward when there are no executions', () => {
    render(<TestStatusPieChart data={[{ status: 'passed', value: 0 }]} />);

    expect(screen.getByText('Nothing has run yet')).toBeInTheDocument();
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
    // The first panel a new account sees is the one moment the product knows exactly what
    // the person should do next, so it says so rather than reporting an empty query.
    expect(screen.getByRole('link', { name: 'Create a test' })).toHaveAttribute(
      'href',
      '/dashboard/create-test',
    );
  });

  it('offers a way forward when no data is supplied at all', () => {
    render(<TestStatusPieChart />);

    expect(screen.getByText('Nothing has run yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a test' })).toBeInTheDocument();
  });

  it('renders one cell per non-zero slice when data is available', () => {
    render(<TestStatusPieChart data={sampleData} />);

    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    // The zero-valued "pending" slice is filtered out before rendering.
    expect(screen.getAllByTestId('cell-element')).toHaveLength(2);
  });
});

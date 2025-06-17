import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import KpiCard from './KpiCard';
import { ListChecks } from 'lucide-react';

// Mock lucide-react icons to simplify testing if they cause issues,
// or to just ensure they are rendered without complex SVG checks.
vi.mock('lucide-react', async (importOriginal) => {
  const original = await importOriginal<typeof import('lucide-react')>();
  return {
    ...original,
    ListChecks: (props: any) => <svg data-testid="list-checks-icon" {...props} />,
    // Add other icons used in tests if necessary
  };
});

describe('KpiCard', () => {
  it('renders title and string value correctly', () => {
    render(<KpiCard title="Total Tests" value="123,456" />);
    expect(screen.getByText('Total Tests')).toBeInTheDocument();
    expect(screen.getByText('123,456')).toBeInTheDocument();
  });

  it('renders title and number value correctly', () => {
    render(<KpiCard title="Success Rate" value={95.5} />);
    expect(screen.getByText('Success Rate')).toBeInTheDocument();
    expect(screen.getByText('95.5')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<KpiCard title="Avg. Duration" value="1m 30s" icon={<ListChecks />} />);
    expect(screen.getByTestId('list-checks-icon')).toBeInTheDocument();
  });

  it('does not render icon when not provided', () => {
    render(<KpiCard title="Total Users" value="5000" />);
    expect(screen.queryByTestId('list-checks-icon')).not.toBeInTheDocument();
  });

  it('renders ReactNode as value correctly', () => {
    const reactNodeValue = <div data-testid="custom-value">Custom Value Content</div>;
    render(<KpiCard title="Custom Data" value={reactNodeValue} />);
    expect(screen.getByTestId('custom-value')).toBeInTheDocument();
    expect(screen.getByText('Custom Data')).toBeInTheDocument();
  });
});

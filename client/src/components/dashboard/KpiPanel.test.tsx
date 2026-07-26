import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import KpiPanel from './KpiPanel';

/**
 * KpiPanel is a presentational component: the dashboard page owns the queries and passes
 * `data`/`isLoading` down. The previous version of this file still drove it through a
 * QueryClient cache, which the component has not read from for a long time.
 */

// KpiCard is stubbed so the assertions target KpiPanel's own formatting, not the card's markup.
vi.mock('./KpiCard', () => ({
  default: ({ title, value }: { title: string; value: React.ReactNode }) => (
    <div data-testid={`kpi-card-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
      <h3>{title}</h3>
      <div>{typeof value === 'string' || typeof value === 'number' ? value : 'ReactNodeValue'}</div>
    </div>
  ),
}));

const sampleData = {
  totalRuns: 1250,
  successRate: 92.5,
  avgDuration: 92_000,
  lastRun: { status: 'success' },
};

const card = (slug: string) => screen.getByTestId(`kpi-card-${slug}`);

describe('KpiPanel', () => {
  it('renders a spinner in every card while loading', () => {
    render(<KpiPanel isLoading />);

    expect(card('success-rate').textContent).toContain('ReactNodeValue');
    expect(card('total-tests').textContent).toContain('ReactNodeValue');
    expect(card('avg-duration').textContent).toContain('ReactNodeValue');
    expect(card('last-run').textContent).toContain('ReactNodeValue');
  });

  it('formats each KPI from the supplied data', () => {
    render(<KpiPanel data={sampleData} />);

    expect(card('success-rate').textContent).toContain('92.5%');
    expect(card('total-tests').textContent).toContain('1250');
    expect(card('avg-duration').textContent).toContain('92.0s');
    expect(card('last-run').textContent).toContain('SUCCESS');
  });

  it('renders neutral placeholders when no data is available', () => {
    render(<KpiPanel />);

    expect(card('success-rate').textContent).toContain('0%');
    expect(card('total-tests').textContent).toContain('0');
    expect(card('avg-duration').textContent).toContain('0s');
    expect(card('last-run').textContent).toContain('N/A');
  });

  it('shows sub-second durations in milliseconds', () => {
    render(<KpiPanel data={{ ...sampleData, avgDuration: 250 }} />);

    expect(card('avg-duration').textContent).toContain('250ms');
  });
});

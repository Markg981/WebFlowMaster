import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import QuickAccessReports from './QuickAccessReports';

/**
 * This was a placeholder card: the report list and its query had been removed, and it said
 * "Report data will be available soon." above 240px of empty card, on the dashboard.
 *
 * The data it needed was already arriving. `/api/analytics/dashboard` returns the five most
 * recent executions under `recent`, and the page fetched them and threw them away. The
 * component is presentational — the page owns the query and passes the rows down — so these
 * tests drive it through props, and it still makes no network calls of its own.
 */

vi.mock('wouter', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const executions = [
  {
    id: 12,
    planName: 'Checkout smoke',
    status: 'passed',
    startedAt: '2026-09-10T09:30:00.000Z',
    duration: 4200,
  },
  {
    id: 13,
    planName: 'Net content',
    status: 'failed',
    startedAt: '2026-09-11T07:05:00.000Z',
    duration: 812,
  },
];

describe('QuickAccessReports', () => {
  it('renders the section heading', () => {
    render(<QuickAccessReports data={[]} />);

    expect(screen.getByRole('heading', { name: 'Recent Test Reports' })).toBeInTheDocument();
  });

  it('lists the recent executions it is given', () => {
    render(<QuickAccessReports data={executions} />);

    expect(screen.getByText('Checkout smoke')).toBeInTheDocument();
    expect(screen.getByText('Net content')).toBeInTheDocument();
    // Durations read in the unit that suits them, not always in milliseconds.
    expect(screen.getByText(/4\.2s/)).toBeInTheDocument();
    expect(screen.getByText(/812ms/)).toBeInTheDocument();
  });

  it('invites the first run instead of reporting an absence', () => {
    render(<QuickAccessReports data={[]} />);

    expect(screen.getByText('No reports yet')).toBeInTheDocument();
    expect(screen.queryByText('Report data will be available soon.')).not.toBeInTheDocument();
  });

  it('shows a spinner while the dashboard query is in flight', () => {
    render(<QuickAccessReports isLoading />);

    expect(screen.queryByText('No reports yet')).not.toBeInTheDocument();
  });

  it('makes no network calls', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    render(<QuickAccessReports data={executions} />);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

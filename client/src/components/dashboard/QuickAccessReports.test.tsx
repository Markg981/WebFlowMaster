import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import QuickAccessReports from './QuickAccessReports';

/**
 * The component is currently a placeholder card: the report list and its query were removed
 * from it. These tests pin the placeholder contract, so a future re-implementation has to
 * update them deliberately rather than silently.
 */
describe('QuickAccessReports', () => {
  it('renders the section heading', () => {
    render(<QuickAccessReports />);

    expect(screen.getByRole('heading', { name: 'Recent Test Reports' })).toBeInTheDocument();
  });

  it('explains that report data is not wired up yet', () => {
    render(<QuickAccessReports />);

    expect(screen.getByText('Report data will be available soon.')).toBeInTheDocument();
  });

  it('makes no network calls', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    render(<QuickAccessReports />);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

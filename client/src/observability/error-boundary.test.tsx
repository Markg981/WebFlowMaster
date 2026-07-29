import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObservabilityErrorBoundary } from './error-boundary';

const mockReport = vi.fn();
vi.mock('./install', () => ({
  reportClientIncident: (...args: unknown[]) => mockReport(...args),
  installObservability: vi.fn(),
  __resetInstallForTests: vi.fn(),
}));

const Boom: React.FC = () => {
  throw new TypeError("Cannot read properties of undefined (reading 'map')");
};

beforeEach(() => {
  mockReport.mockClear();
  // React logs the caught error itself; silence it so the run stays readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('ObservabilityErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ObservabilityErrorBoundary>
        <p>all good</p>
      </ObservabilityErrorBoundary>,
    );

    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('reports the error with its component stack and shows a fallback', () => {
    render(
      <ObservabilityErrorBoundary>
        <Boom />
      </ObservabilityErrorBoundary>,
    );

    expect(mockReport).toHaveBeenCalledTimes(1);
    const report = mockReport.mock.calls[0][0];
    expect(report.name).toBe('TypeError');
    expect(report.message).toContain("reading 'map'");
    expect(report.componentStack).toContain('Boom');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows the failing message in the fallback so the page is not blank', () => {
    render(
      <ObservabilityErrorBoundary>
        <Boom />
      </ObservabilityErrorBoundary>,
    );

    expect(screen.getByRole('alert').textContent).toContain("reading 'map'");
  });
});

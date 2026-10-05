import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TestReportPage from './TestReportPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {})) text = text.replace(`{{${name}}}`, String(value));
      return text;
    },
  }),
}));

vi.mock('wouter', () => ({
  useRoute: () => [true, { planId: 'plan-1', executionId: 'run-1' }],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

/**
 * The report's filters and charts: the filters only wrote a line to the console, and the charts
 * said "Chart placeholder".
 */

const row = (id: string, testName: string, status: string, component: string, severity: string) => ({
  id, testPlanExecutionId: 'run-1', uiTestId: 1, apiTestId: null, testType: 'ui', testName, browser: 'chromium', status,
  videoUrl: null, traceUrl: null, steps: [], reasonForFailure: status === 'Failed' ? 'boom' : null, screenshotUrl: null,
  detailedLog: null, startedAt: 0, completedAt: 0, durationMs: 1000, module: 'Shop', featureArea: null, scenario: null,
  component, priority: 'High', severity,
});

const report = {
  header: {
    testSuiteName: 'Nightly', environment: 'staging', browsers: ['chromium'], dateTime: '2026-09-30T10:00:00Z',
    completedAt: '2026-09-30T10:05:00Z', status: 'failed', triggeredBy: 'manual', executionId: 'run-1', testPlanId: 'plan-1',
  },
  keyMetrics: { totalTests: 3, passedTests: 2, failedTests: 1, skippedTests: 0, passRate: 66.67, averageTimePerTestMs: 1000, totalTestCasesDurationMs: 3000, executionDurationMs: 3000 },
  charts: {
    passFailSkippedDistribution: { passed: 2, failed: 1, skipped: 0 },
    priorityDistribution: { High: { passed: 2, failed: 1, skipped: 0, total: 3 } },
    severityDistribution: { Critical: { passed: 0, failed: 1, skipped: 0, total: 1 }, Minor: { passed: 2, failed: 0, skipped: 0, total: 2 } },
  },
  failedTestDetails: [{ ...row('r3', 'Pay by card', 'Failed', 'Checkout', 'Critical'), testVersion: null }],
  testGroupings: {
    Shop: {
      passed: 2, failed: 1, skipped: 0, total: 3,
      components: {
        Cart: { passed: 2, failed: 0, skipped: 0, total: 2, tests: [row('r1', 'Add to cart', 'Passed', 'Cart', 'Minor'), row('r2', 'Remove from cart', 'Passed', 'Cart', 'Minor')] },
        Checkout: { passed: 0, failed: 1, skipped: 0, total: 1, tests: [row('r3', 'Pay by card', 'Failed', 'Checkout', 'Critical')] },
      },
    },
  },
  allTests: [],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) =>
    Promise.resolve({ ok: true, json: async () => (String(url).includes('/issues') ? [] : report) }),
  ));
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TestReportPage />
    </QueryClientProvider>,
  );

describe('TestReportPage', () => {
  it('explains when queued work waits for the monthly execution budget', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...report, header: { ...report.header, status: 'queued', quotaDeferReason: 'execution_quota_exceeded', quotaDeferUntil: '2026-11-01T00:00:00.000Z' } }) })));
    renderPage();
    expect(await screen.findByTestId('quota-deferred')).toHaveTextContent('Monthly execution allowance exhausted');
  });
  it('draws the charts from the run instead of placeholders', async () => {
    renderPage();
    expect(await screen.findByText('Passed, failed and skipped')).toBeTruthy();
    expect(screen.queryByText(/Chart placeholder/)).toBeNull();
    expect(screen.getByText('67%')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'By severity: Critical' })).toBeTruthy();
  });

  it('filters the failed tests and the results by module, with counts of what is shown', async () => {
    renderPage();
    await screen.findByText('Passed, failed and skipped');

    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'Minor' } });
    expect(screen.getByText('Showing 2 of 3 results.')).toBeTruthy();
    // The only failure is Critical: the failed tests card has nothing left to show.
    expect(screen.queryByText(/Failed Tests \(/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: '__all__' } });
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'Failed' } });
    expect(screen.getByText('Showing 1 of 3 results.')).toBeTruthy();
    expect(screen.getByText(/Failed Tests \(1\)/)).toBeTruthy();

    fireEvent.click(screen.getByText('Clear filters'));
    expect(screen.queryByText(/Showing/)).toBeNull();
    const component = screen.getByLabelText('Component');
    expect(within(component).getAllByRole('option').map((option) => option.textContent)).toEqual(['All', 'Cart', 'Checkout']);
  });
});

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TestReportPage from './TestReportPage';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { role: 'viewer' } }) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {}))
        text = text.replace(`{{${name}}}`, String(value));
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

const row = (
  id: string,
  testName: string,
  status: string,
  component: string,
  severity: string,
) => ({
  id,
  testPlanExecutionId: 'run-1',
  uiTestId: 1,
  apiTestId: null,
  testType: 'ui',
  testName,
  browser: 'chromium',
  status,
  videoUrl: null,
  traceUrl: null,
  steps: [],
  reasonForFailure: status === 'Failed' ? 'boom' : null,
  screenshotUrl: null,
  detailedLog: null,
  startedAt: 0,
  completedAt: 0,
  durationMs: 1000,
  module: 'Shop',
  featureArea: null,
  scenario: null,
  component,
  priority: 'High',
  severity,
});

const report = {
  header: {
    testSuiteName: 'Nightly',
    environment: 'staging',
    browsers: ['chromium'],
    dateTime: '2026-09-30T10:00:00Z',
    completedAt: '2026-09-30T10:05:00Z',
    status: 'failed',
    triggeredBy: 'manual',
    executionId: 'run-1',
    testPlanId: 'plan-1',
  },
  keyMetrics: {
    totalTests: 3,
    passedTests: 2,
    failedTests: 1,
    skippedTests: 0,
    passRate: 66.67,
    averageTimePerTestMs: 1000,
    totalTestCasesDurationMs: 3000,
    executionDurationMs: 3000,
  },
  charts: {
    passFailSkippedDistribution: { passed: 2, failed: 1, skipped: 0 },
    priorityDistribution: { High: { passed: 2, failed: 1, skipped: 0, total: 3 } },
    severityDistribution: {
      Critical: { passed: 0, failed: 1, skipped: 0, total: 1 },
      Minor: { passed: 2, failed: 0, skipped: 0, total: 2 },
    },
  },
  failedTestDetails: [
    { ...row('r3', 'Pay by card', 'Failed', 'Checkout', 'Critical'), testVersion: null },
  ],
  testGroupings: {
    Shop: {
      passed: 2,
      failed: 1,
      skipped: 0,
      total: 3,
      components: {
        Cart: {
          passed: 2,
          failed: 0,
          skipped: 0,
          total: 2,
          tests: [
            row('r1', 'Add to cart', 'Passed', 'Cart', 'Minor'),
            row('r2', 'Remove from cart', 'Passed', 'Cart', 'Minor'),
          ],
        },
        Checkout: {
          passed: 0,
          failed: 1,
          skipped: 0,
          total: 1,
          tests: [row('r3', 'Pay by card', 'Failed', 'Checkout', 'Critical')],
        },
      },
    },
  },
  allTests: [],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => (String(url).includes('/issues') ? [] : report),
      }),
    ),
  );
});

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TestReportPage />
    </QueryClientProvider>,
  );

describe('TestReportPage: from a result to one attempt and row (P08)', () => {
  const unitId = `u_${'a'.repeat(24)}`;
  const at = (attempt: number, row: number) =>
    `/api/test-plan-executions/run-1/artifacts/units/${unitId}/attempt_${attempt}/row_${row}`;
  const unitEvidence = {
    unitId,
    decidingAttempt: 2,
    attempts: [1, 2].map((attempt) => ({
      attempt,
      state: 'finished',
      status: attempt === 1 ? 'failed' : 'passed',
      failureReason: attempt === 1 ? 'Row 2 of 2: card declined' : null,
      startedAt: '2026-09-30T10:00:00Z',
      finishedAt: '2026-09-30T10:01:00Z',
      screenshotUrl: null,
      videoUrl: null,
      traceUrl: null,
      harUrl: null,
      restricted: false,
      rows: [0, 1].map((datasetRow) => ({
        datasetRow,
        status: attempt === 1 && datasetRow === 1 ? 'failed' : 'passed',
        error: attempt === 1 && datasetRow === 1 ? 'card declined' : null,
        screenshotUrl: `${at(attempt, datasetRow)}/step.png`,
        videoUrl: null,
        traceUrl: `${at(attempt, datasetRow)}/Pay_trace.zip`,
        harUrl: null,
        restricted: false,
      })),
    })),
  };
  const withUnits = () => {
    const failed = { ...row('r3', 'Pay by card', 'Failed', 'Checkout', 'Critical'), unitEvidence };
    return {
      ...report,
      failedTestDetails: [{ ...failed, testVersion: null }],
      testGroupings: {
        Shop: {
          ...report.testGroupings.Shop,
          components: {
            ...report.testGroupings.Shop.components,
            Checkout: { ...report.testGroupings.Shop.components.Checkout, tests: [failed] },
          },
        },
      },
    };
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => (String(url).includes('/issues') ? [] : withUnits()),
        }),
      ),
    );
  });

  it('opens a result with no recorded steps on its attempts, the first failure included', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('open-steps-r3'));
    expect(await screen.findByTestId('slice-picker')).toBeTruthy();
    fireEvent.click(screen.getByTestId('attempt-1'));
    fireEvent.click(screen.getByTestId('row-1'));
    expect(screen.getByTestId('trace-link').getAttribute('href')).toBe(`${at(1, 1)}/Pay_trace.zip`);
    expect(screen.getByText('card declined')).toBeTruthy();
  });

  it('opens exactly the attempt and row a link names', async () => {
    window.history.pushState({}, '', `/report?unit=${unitId}&attempt=1&row=0`);
    try {
      renderPage();
      expect(await screen.findByTestId('slice-picker')).toBeTruthy();
      expect(screen.getByTestId('attempt-1').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('row-0').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('trace-link').getAttribute('href')).toBe(
        `${at(1, 0)}/Pay_trace.zip`,
      );
    } finally {
      window.history.pushState({}, '', '/');
    }
  });
});

describe('TestReportPage', () => {
  it('explains when queued work waits for the monthly execution budget', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ...report,
          header: {
            ...report.header,
            status: 'queued',
            quotaDeferReason: 'execution_quota_exceeded',
            quotaDeferUntil: '2026-11-01T00:00:00.000Z',
          },
        }),
      })),
    );
    renderPage();
    expect(await screen.findByTestId('quota-deferred')).toHaveTextContent(
      'Monthly execution allowance exhausted',
    );
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
    expect(
      within(component)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All', 'Cart', 'Checkout']);
  });
});

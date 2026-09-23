import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GeneralReportsPage from './GeneralReportsPage';

/**
 * A run the server has accepted and no worker has taken yet.
 *
 * `queued` replaced `pending` as the name of that state. A page that kept its own copy of the
 * list would hide fresh runs behind a filter that no longer matches anything the server writes.
 */

const queuedExecution = {
  id: 'execution-queued-1',
  scheduleId: null,
  testPlanId: 'plan-1',
  organizationId: 1,
  requestedByUserId: 1,
  status: 'queued',
  results: null,
  queuedAt: '2026-09-17T10:00:00.000Z',
  startedAt: null,
  completedAt: null,
  cancelRequestedAt: null,
  heartbeatAt: null,
  failureCode: null,
  failureMessage: null,
  environment: null,
  browsers: null,
  triggeredBy: 'manual',
  totalTests: null,
  passedTests: null,
  failedTests: null,
  skippedTests: null,
  executionDurationMs: null,
  testPlanName: 'Queued smoke test',
  scheduleName: null,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <GeneralReportsPage />
    </QueryClientProvider>,
  );
}

describe('GeneralReportsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/test-plans')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.startsWith('/api/test-plan-executions')) {
        return Promise.resolve(new Response(JSON.stringify({
          items: [queuedExecution],
          totalItems: 1,
          totalPages: 1,
          currentPage: 1,
          itemsPerPage: 10,
        }), { status: 200 }));
      }
      if (url.startsWith('/api/analytics/flaky')) {
        return Promise.resolve(new Response(JSON.stringify({
          window: { days: 30, since: '2026-08-18T00:00:00.000Z', resultsExamined: 0 },
          thresholds: { minimumRuns: 3, minimumFlips: 1 },
          items: [],
        }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a queued run, and offers queued as a status to filter on', async () => {
    renderPage();

    expect(await screen.findByText('Queued smoke test')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Status'));

    expect(await screen.findByRole('option', { name: 'queued' })).toBeInTheDocument();
    // The word the server no longer writes is no longer offered as if it matched something.
    expect(screen.queryByRole('option', { name: 'pending' })).not.toBeInTheDocument();
  });
});

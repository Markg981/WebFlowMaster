import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StepDetailsDialog, { type ReportStep } from './StepDetailsDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, options?: Record<string, unknown>) =>
      (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        String(options?.[name] ?? ''),
      ),
  }),
}));

/**
 * The report's per-test button was labelled "(Placeholder)" and did nothing, so a failure
 * was only ever a one-line reason on a table row — even though the runner had recorded every
 * step, and now records three images whenever a step differs from its baseline.
 */

const steps: ReportStep[] = [
  { name: 'Load Page', type: 'navigation', status: 'passed', details: 'Successfully navigated' },
  {
    name: 'Click Save',
    type: 'click',
    status: 'failed',
    details: 'Visual difference: 4.20% of pixels changed',
    error: 'Visual difference: 4.20% of pixels changed',
    screenshot: '/api/test-plan-executions/exec-1/artifacts/ui_5/step_click.png',
    visual: {
      outcome: 'diff',
      detail: 'Visual difference: 4.20% of pixels changed',
      diffRatio: 0.042,
      baselineImage: '/api/test-plan-executions/exec-1/artifacts/ui_5/visual_step_001_baseline.png',
      actualImage: '/api/test-plan-executions/exec-1/artifacts/ui_5/visual_step_001_actual.png',
      diffImage: '/api/test-plan-executions/exec-1/artifacts/ui_5/visual_step_001_diff.png',
    },
  },
];

describe('StepDetailsDialog: attempts and dataset rows (P08)', () => {
  const base = '/api/test-plan-executions/exec-1/artifacts/units/u_x';
  const links = (attempt: number, row: number | null, restricted = false) => {
    const dir = `${base}/attempt_${attempt}${row === null ? '' : `/row_${row}`}`;
    return {
      screenshotUrl: `${dir}/step.png`,
      videoUrl: `${dir}/Checkout_run.webm`,
      traceUrl: restricted ? null : `${dir}/Checkout_trace.zip`,
      harUrl: null,
      restricted,
    };
  };
  const rowsOf = (attempt: number, failing: number | null) =>
    [0, 1, 2].map((datasetRow) => ({
      datasetRow,
      status: datasetRow === failing ? ('failed' as const) : ('passed' as const),
      error: datasetRow === failing ? 'Sold out' : null,
      ...links(attempt, datasetRow),
    }));
  const unitEvidence = {
    unitId: 'u_x',
    decidingAttempt: 2,
    attempts: [
      {
        attempt: 1,
        state: 'finished' as const,
        status: 'failed',
        failureReason: 'Row 3 of 3: Sold out',
        startedAt: '2026-10-16T10:00:00Z',
        finishedAt: '2026-10-16T10:01:00Z',
        ...links(1, null),
        traceUrl: null,
        videoUrl: null,
        screenshotUrl: null,
        rows: rowsOf(1, 2),
      },
      {
        attempt: 2,
        state: 'finished' as const,
        status: 'passed',
        failureReason: null,
        startedAt: '2026-10-16T10:01:00Z',
        finishedAt: '2026-10-16T10:02:00Z',
        ...links(2, null),
        traceUrl: null,
        videoUrl: null,
        screenshotUrl: null,
        rows: rowsOf(2, null),
      },
    ],
  };
  const datasetSteps: ReportStep[] = [0, 1, 2].map((row) => ({
    name: `Row ${row + 1} of 3 — Pay`,
    type: 'click',
    status: 'passed',
    details: `paid row ${row + 1}`,
  }));
  const dialog = (extra: Record<string, unknown> = {}) => (
    <StepDetailsDialog
      open
      onOpenChange={() => {}}
      testName="Checkout"
      browser="chromium · it-IT"
      steps={datasetSteps}
      unitEvidence={unitEvidence}
      {...extra}
    />
  );

  it('opens on the attempt the result stands on, every row, with the recorded steps', () => {
    render(dialog());
    expect(screen.getByTestId('attempt-2')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('row-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText(/Row \d of 3 — Pay/)).toHaveLength(3);
  });

  it("opens exactly the selected attempt's and row's evidence", () => {
    render(dialog());

    fireEvent.click(screen.getByTestId('attempt-1'));
    fireEvent.click(screen.getByTestId('row-2'));

    expect(screen.getByTestId('trace-link')).toHaveAttribute(
      'href',
      `${base}/attempt_1/row_2/Checkout_trace.zip`,
    );
    expect(screen.getByTestId('run-video')).toHaveAttribute(
      'src',
      `${base}/attempt_1/row_2/Checkout_run.webm`,
    );
    expect(screen.getByAltText('Screenshot')).toHaveAttribute(
      'src',
      `${base}/attempt_1/row_2/step.png`,
    );
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    // The steps the report kept are the deciding attempt's: this one points to its trace.
    expect(screen.getByTestId('steps-not-kept')).toBeInTheDocument();

    // Back to the deciding attempt, one row: that row's steps and that row's files only.
    fireEvent.click(screen.getByTestId('attempt-2'));
    fireEvent.click(screen.getByTestId('row-1'));
    expect(screen.getByTestId('trace-link')).toHaveAttribute(
      'href',
      `${base}/attempt_2/row_1/Checkout_trace.zip`,
    );
    expect(screen.getAllByText(/Row \d of 3 — Pay/).map((el) => el.textContent)).toEqual([
      '1. Row 2 of 3 — Pay',
    ]);
  });

  it('opens on the slice it was asked for, and says when a trace is withheld', () => {
    const withheld = {
      ...unitEvidence,
      attempts: unitEvidence.attempts.map((a) => ({
        ...a,
        rows: a.rows.map((r) => ({ ...r, ...links(a.attempt, r.datasetRow, true) })),
      })),
    };
    render(dialog({ unitEvidence: withheld, initialAttempt: 1, initialRow: 0 }));
    expect(screen.getByTestId('attempt-1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('row-0')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('trace-link')).toBeNull();
    expect(screen.getByTestId('evidence-restricted')).toBeInTheDocument();
  });

  it('shows a result from before the manifest as it always did', () => {
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Legacy"
        steps={datasetSteps}
        traceUrl="/api/test-plan-executions/exec-1/artifacts/ui_5_chromium/Legacy_trace.zip"
      />,
    );
    expect(screen.queryByTestId('slice-picker')).toBeNull();
    expect(screen.getByTestId('trace-link')).toHaveAttribute(
      'href',
      '/api/test-plan-executions/exec-1/artifacts/ui_5_chromium/Legacy_trace.zip',
    );
  });
});

describe('StepDetailsDialog', () => {
  it('marks omitted evidence without rendering a broken image', () => {
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Storage cap"
        steps={[
          {
            name: 'Saved verdict',
            type: 'check',
            status: 'passed',
            details: 'Passed',
            evidenceUnavailable: true,
            screenshot: null,
          },
        ]}
      />,
    );
    expect(
      screen.getByText('Evidence unavailable: not retained by the artifact store.'),
    ).toBeInTheDocument();
    expect(screen.queryByAltText('Screenshot')).toBeNull();
  });
  it('lists the steps in order, with the failing one carrying its error', () => {
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Login works"
        browser="firefox"
        steps={steps}
      />,
    );

    expect(screen.getByText('Login works')).toBeInTheDocument();
    expect(screen.getByText('Steps recorded on firefox.')).toBeInTheDocument();
    expect(screen.getByText('1. Load Page')).toBeInTheDocument();
    expect(screen.getByText('2. Click Save')).toBeInTheDocument();
    expect(
      screen.getAllByText('Visual difference: 4.20% of pixels changed').length,
    ).toBeGreaterThan(0);
  });

  it('shows the baseline, this run and the difference as three labelled pictures', () => {
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Login works"
        browser="firefox"
        steps={steps}
      />,
    );

    expect(screen.getByAltText('Baseline')).toHaveAttribute(
      'src',
      '/api/test-plan-executions/exec-1/artifacts/ui_5/visual_step_001_baseline.png',
    );
    expect(screen.getByAltText('This run')).toBeInTheDocument();
    expect(screen.getByAltText('Difference')).toHaveAttribute(
      'src',
      '/api/test-plan-executions/exec-1/artifacts/ui_5/visual_step_001_diff.png',
    );
    // The step's own screenshot is the same image as "This run", so it is not shown twice.
    expect(screen.queryByAltText('Screenshot')).not.toBeInTheDocument();
  });

  it('shows a comparison that could not run as not verified, with its cause and no pictures', () => {
    const reason =
      'Visual comparison could not run (storage-unavailable): ECONNREFUSED. The step was not verified visually.';
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Home looks right"
        steps={[
          {
            name: 'Draw the page',
            type: 'executeScript',
            status: 'failed',
            details: reason,
            error: reason,
            visual: { outcome: 'error', cause: 'storage-unavailable', detail: reason },
          },
        ]}
      />,
    );

    expect(screen.getByText('not verified · storage-unavailable')).toBeInTheDocument();
    expect(screen.queryByAltText('Difference')).not.toBeInTheDocument();
  });

  it("shows a step's screenshot when there was no visual comparison", () => {
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Login works"
        browser={null}
        steps={[
          {
            name: 'Type password',
            type: 'input',
            status: 'passed',
            details: 'Success',
            screenshot: '/shot.png',
          },
        ]}
      />,
    );

    expect(screen.getByAltText('Screenshot')).toHaveAttribute('src', '/shot.png');
  });

  it('plays the run back when the plan kept a video of it', () => {
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Login works"
        browser="chromium"
        steps={steps}
        videoUrl="/api/test-plan-executions/exec-1/artifacts/ui_5/run.webm"
      />,
    );

    expect(screen.getByTestId('run-video')).toHaveAttribute(
      'src',
      '/api/test-plan-executions/exec-1/artifacts/ui_5/run.webm',
    );
  });

  it('offers the trace, and says what to open it with — a .zip is no use unexplained', () => {
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Login works"
        browser="chromium"
        steps={steps}
        traceUrl="/api/test-plan-executions/exec-1/artifacts/ui_5/trace.zip"
      />,
    );

    expect(screen.getByText(/Download the Playwright trace/i)).toHaveAttribute(
      'href',
      '/api/test-plan-executions/exec-1/artifacts/ui_5/trace.zip',
    );
    expect(screen.getByText(/show-trace/)).toBeInTheDocument();
  });

  it('shows no recording section for a run that kept none', () => {
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Login works"
        browser="chromium"
        steps={steps}
      />,
    );

    expect(screen.queryByTestId('run-video')).not.toBeInTheDocument();
    expect(screen.queryByText(/Download the Playwright trace/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('device-session')).not.toBeInTheDocument();
  });

  it('links a mobile test to its session on the grid, where the device video is', () => {
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Login on Android"
        browser="Google Pixel 8 · 14.0"
        steps={steps}
        sessionUrl="https://app-automate.browserstack.com/s/abc"
      />,
    );

    expect(screen.getByText(/Steps recorded on Google Pixel 8 · 14.0/)).toBeInTheDocument();
    expect(screen.getByTestId('device-session')).toHaveAttribute(
      'href',
      'https://app-automate.browserstack.com/s/abc',
    );
  });

  it("lists an accessibility check's violations, marks the ones that failed the step, and links each rule", () => {
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Checkout"
        browser="chromium"
        steps={[
          {
            name: 'Check accessibility',
            type: 'assertAccessible',
            status: 'failed',
            details: '',
            error:
              '1 accessibility violation serious or worse: button-name (critical, 7 elements).',
            accessibility: {
              url: 'https://shop.test/checkout',
              threshold: 'serious',
              blocking: 1,
              passes: 40,
              incomplete: 2,
              violations: [
                {
                  id: 'button-name',
                  impact: 'critical',
                  help: 'Buttons must have discernible text',
                  helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name',
                  tags: ['wcag2a'],
                  count: 7,
                  targets: ['#pay', '.close', '.next', '.prev', '.menu'],
                  blocking: true,
                },
                {
                  id: 'region',
                  impact: 'moderate',
                  help: 'All page content should be contained by landmarks',
                  helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/region',
                  tags: [],
                  count: 1,
                  targets: ['body > div'],
                  blocking: false,
                },
              ],
            },
          },
        ]}
      />,
    );

    expect(
      screen.getByText(/2 rules broken, 40 passed, 2 need a person to check/),
    ).toBeInTheDocument();
    const blocking = screen.getByTestId('violation-button-name');
    expect(blocking).toHaveTextContent('failed the step');
    expect(blocking).toHaveTextContent('#pay · .close · .next · .prev · .menu · +2');
    expect(screen.getByRole('link', { name: /button-name/ })).toHaveAttribute(
      'href',
      'https://dequeuniversity.com/rules/axe/4.10/button-name',
    );
    expect(screen.getByTestId('violation-region')).not.toHaveTextContent('failed the step');
  });

  it("shows the page's failed and slowest requests, and offers the HAR when it was kept", () => {
    const network = {
      requests: 42,
      failed: 27,
      transferredBytes: 2_560_000,
      failures: [
        {
          method: 'POST',
          url: 'https://shop.test/api/orders',
          status: 500,
          statusText: 'Internal Server Error',
          timeMs: 1200,
          resourceType: 'fetch',
        },
        {
          method: 'GET',
          url: 'https://cdn.test/app.js',
          status: 0,
          statusText: 'net::ERR_CONNECTION_REFUSED',
          timeMs: 30,
          resourceType: 'script',
        },
      ],
      slowest: [
        {
          method: 'GET',
          url: 'https://shop.test/api/catalog',
          status: 200,
          statusText: 'OK',
          timeMs: 8400,
          resourceType: 'fetch',
        },
      ],
    };
    const { rerender } = render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Checkout"
        browser="chromium"
        steps={steps}
        network={network}
        harUrl="/api/test-plan-executions/exec-1/artifacts/ui_5/checkout_network.har"
      />,
    );

    expect(screen.getByText('42 requests, 27 failed, 2.4 MB received')).toBeInTheDocument();
    expect(screen.getByTestId('network-failures')).toHaveTextContent(
      '500POSThttps://shop.test/api/orders1200 ms',
    );
    expect(screen.getByTestId('network-failures')).toHaveTextContent('net::ERR_CONNECTION_REFUSED');
    expect(screen.getByText('and 25 more in the HAR')).toBeInTheDocument();
    expect(screen.getByTestId('network-slowest')).toHaveTextContent('8400 ms');
    expect(screen.getByText(/Download the HAR/)).toHaveAttribute(
      'href',
      '/api/test-plan-executions/exec-1/artifacts/ui_5/checkout_network.har',
    );

    // A passing test under "on failure": the summary without the file.
    rerender(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Checkout"
        browser="chromium"
        steps={steps}
        network={network}
        harUrl={null}
      />,
    );
    expect(screen.getByTestId('network-panel')).toBeInTheDocument();
    expect(screen.queryByText(/Download the HAR/)).not.toBeInTheDocument();
  });

  it('says why there is nothing to show rather than opening empty', () => {
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Some API test"
        browser={null}
        steps={[]}
      />,
    );

    expect(screen.getByText(/no recorded steps/i)).toBeInTheDocument();
  });
});

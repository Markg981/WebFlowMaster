import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StepDetailsDialog, { type ReportStep } from './StepDetailsDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, options?: Record<string, unknown>) =>
      (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
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

describe('StepDetailsDialog', () => {
  it('lists the steps in order, with the failing one carrying its error', () => {
    render(<StepDetailsDialog open onOpenChange={() => {}} testName="Login works" browser="firefox" steps={steps} />);

    expect(screen.getByText('Login works')).toBeInTheDocument();
    expect(screen.getByText('Steps recorded on firefox.')).toBeInTheDocument();
    expect(screen.getByText('1. Load Page')).toBeInTheDocument();
    expect(screen.getByText('2. Click Save')).toBeInTheDocument();
    expect(screen.getAllByText('Visual difference: 4.20% of pixels changed').length).toBeGreaterThan(0);
  });

  it('shows the baseline, this run and the difference as three labelled pictures', () => {
    render(<StepDetailsDialog open onOpenChange={() => {}} testName="Login works" browser="firefox" steps={steps} />);

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

  it("shows a step's screenshot when there was no visual comparison", () => {
    render(
      <StepDetailsDialog
        open
        onOpenChange={() => {}}
        testName="Login works"
        browser={null}
        steps={[{ name: 'Type password', type: 'input', status: 'passed', details: 'Success', screenshot: '/shot.png' }]}
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
    render(<StepDetailsDialog open onOpenChange={() => {}} testName="Login works" browser="chromium" steps={steps} />);

    expect(screen.queryByTestId('run-video')).not.toBeInTheDocument();
    expect(screen.queryByText(/Download the Playwright trace/i)).not.toBeInTheDocument();
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
            error: '1 accessibility violation serious or worse: button-name (critical, 7 elements).',
            accessibility: {
              url: 'https://shop.test/checkout',
              threshold: 'serious',
              blocking: 1,
              passes: 40,
              incomplete: 2,
              violations: [
                {
                  id: 'button-name', impact: 'critical', help: 'Buttons must have discernible text',
                  helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name', tags: ['wcag2a'],
                  count: 7, targets: ['#pay', '.close', '.next', '.prev', '.menu'], blocking: true,
                },
                {
                  id: 'region', impact: 'moderate', help: 'All page content should be contained by landmarks',
                  helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/region', tags: [],
                  count: 1, targets: ['body > div'], blocking: false,
                },
              ],
            },
          },
        ]}
      />,
    );

    expect(screen.getByText(/2 rules broken, 40 passed, 2 need a person to check/)).toBeInTheDocument();
    const blocking = screen.getByTestId('violation-button-name');
    expect(blocking).toHaveTextContent('failed the step');
    expect(blocking).toHaveTextContent('#pay · .close · .next · .prev · .menu · +2');
    expect(screen.getByRole('link', { name: /button-name/ })).toHaveAttribute('href', 'https://dequeuniversity.com/rules/axe/4.10/button-name');
    expect(screen.getByTestId('violation-region')).not.toHaveTextContent('failed the step');
  });

  it('says why there is nothing to show rather than opening empty', () => {
    render(<StepDetailsDialog open onOpenChange={() => {}} testName="Some API test" browser={null} steps={[]} />);

    expect(screen.getByText(/no recorded steps/i)).toBeInTheDocument();
  });
});

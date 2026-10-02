import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Wand2, Image as ImageIcon } from 'lucide-react';
import type { AccessibilityFinding } from '@shared/accessibility';
import { PERFORMANCE_METRICS, formatMetric, type LighthouseFinding, type PerformanceFinding } from '@shared/web-performance';
import AccessibilityPanel from './AccessibilityPanel';
import NetworkPanel from './NetworkPanel';
import type { NetworkSummary } from '@shared/network';

/**
 * What a test actually did, step by step.
 *
 * The runner has recorded this for every UI test since there were reports — status, detail,
 * error, a screenshot per step, and now the three images of a visual comparison — and the
 * report displayed none of it: the button that should open it was labelled "(Placeholder)"
 * and did nothing, so the only account of a failure was the one-line reason on the row.
 */

export interface ReportStepVisual {
  outcome: string;
  detail: string;
  diffRatio?: number;
  baselineImage?: string | null;
  actualImage?: string | null;
  diffImage?: string | null;
}

export interface ReportStep {
  name: string;
  type: string;
  /** The test's own id for the step, and the group call it came from, when the runner recorded them. */
  stepId?: string;
  calledFrom?: string;
  status: 'passed' | 'failed';
  details: string;
  error?: string;
  healed?: boolean;
  rca?: string;
  screenshot?: string | null;
  visual?: ReportStepVisual;
  accessibility?: AccessibilityFinding;
  performance?: PerformanceFinding;
  lighthouse?: LighthouseFinding;
}

interface StepDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testName: string;
  browser?: string | null;
  steps: ReportStep[];
  /** A recording of the run, when the plan kept one. */
  videoUrl?: string | null;
  /** A Playwright trace: the DOM, the network and the console at every step. */
  traceUrl?: string | null;
  /** The kept HAR, when the plan kept one. */
  harUrl?: string | null;
  /** The page's failed and slowest requests, whenever the network was recorded. */
  network?: NetworkSummary | null;
  /** A mobile test's session on its grid, with the device's video and logs. */
  sessionUrl?: string | null;
}

/** The picture and what it is a picture of, since three unlabelled images say nothing. */
/** What a measurePerformance step measured, with the limits it checked. */
function SpeedPanel({ finding }: { finding: PerformanceFinding }) {
  const limited = new Map(finding.checks.map((c) => [c.metric, c]));
  return (
    <div className="mt-3 rounded-md border p-3 dark:border-slate-700" data-testid="speed-panel">
      <p className="mb-2 text-sm font-medium">Page speed · <span className="font-normal text-muted-foreground break-all">{finding.url}</span></p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {PERFORMANCE_METRICS.map((m) => {
          const c = limited.get(m);
          return (
            <div key={m} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{m}</dt>
              <dd className={`tabular-nums ${c?.ok === false ? 'font-semibold text-destructive' : ''}`}>
                {formatMetric(m, finding.metrics[m] ?? null)}{c ? ` (${c.op} ${formatMetric(m, c.value)})` : ''}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** What an auditLighthouse step scored, and its report. */
function LighthousePanel({ finding }: { finding: LighthouseFinding }) {
  const broken = new Set(finding.checks.filter((c) => c.ok === false).map((c) => c.metric));
  return (
    <div className="mt-3 rounded-md border p-3 dark:border-slate-700" data-testid="lighthouse-panel">
      <p className="mb-2 text-sm font-medium">
        Lighthouse · {finding.formFactor}
        {finding.reportUrl && <a href={finding.reportUrl} target="_blank" rel="noreferrer" className="ml-2 text-xs font-normal text-primary underline">report</a>}
      </p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(finding.scores).map(([category, score]) => (
          <Badge key={category} variant={broken.has(category as never) ? 'destructive' : 'secondary'}>{category} {score}</Badge>
        ))}
      </div>
    </div>
  );
}

function ImagePanel({ label, src }: { label: string; src?: string | null }) {
  if (!src) return null;
  return (
    <figure className="min-w-0 flex-1">
      <figcaption className="text-xs text-muted-foreground mb-1">{label}</figcaption>
      <a href={src} target="_blank" rel="noreferrer" title={`Open ${label.toLowerCase()} full size`}>
        <img src={src} alt={label} className="w-full rounded border dark:border-slate-700 bg-muted" loading="lazy" />
      </a>
    </figure>
  );
}

function VisualPanel({ visual }: { visual: ReportStepVisual }) {
  const isDiff = visual.outcome === 'diff';
  return (
    <div className={`mt-3 rounded-md border p-3 ${isDiff ? 'border-destructive/60' : 'dark:border-slate-700'}`}>
      <div className="flex items-center gap-2 mb-2">
        <ImageIcon className="h-4 w-4" />
        <span className="text-sm font-medium">Visual check</span>
        <Badge variant={isDiff ? 'destructive' : 'secondary'} className="whitespace-nowrap">
          {visual.outcome}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{visual.detail}</p>
      {(visual.baselineImage || visual.actualImage || visual.diffImage) && (
        <div className="flex flex-col sm:flex-row gap-3 mt-3">
          <ImagePanel label="Baseline" src={visual.baselineImage} />
          <ImagePanel label="This run" src={visual.actualImage} />
          <ImagePanel label="Difference" src={visual.diffImage} />
        </div>
      )}
    </div>
  );
}

const StepDetailsDialog: React.FC<StepDetailsDialogProps> = ({
  open,
  onOpenChange,
  testName,
  browser,
  steps,
  videoUrl,
  traceUrl,
  harUrl,
  network,
  sessionUrl,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{testName}</DialogTitle>
          <DialogDescription>
            {browser ? `Steps recorded on ${browser}.` : 'Steps recorded during this run.'}
          </DialogDescription>
        </DialogHeader>

        {sessionUrl && (
          <p className="text-xs text-muted-foreground">
            <a href={sessionUrl} target="_blank" rel="noreferrer" className="underline" data-testid="device-session">
              Open the session on the grid
            </a>{' '}
            — the device's video and logs, kept by the grid.
          </p>
        )}

        {(videoUrl || traceUrl) && (
          <div className="rounded-md border p-3 space-y-2 dark:border-slate-700">
            {videoUrl && (
              <video src={videoUrl} controls className="w-full rounded max-h-72 bg-black" data-testid="run-video" />
            )}
            {traceUrl && (
              <p className="text-xs text-muted-foreground">
                <a href={traceUrl} className="underline" download>
                  Download the Playwright trace
                </a>{' '}
                — it carries the DOM, the network and the console at every step. Open it with{' '}
                <code>npx playwright show-trace &lt;file&gt;</code> or at{' '}
                <a href="https://trace.playwright.dev" target="_blank" rel="noreferrer" className="underline">
                  trace.playwright.dev
                </a>
                .
              </p>
            )}
          </div>
        )}

        {network && <NetworkPanel summary={network} harUrl={harUrl} />}

        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">
            This result has no recorded steps. API tests and tests blocked by a precondition
            never reach the step runner.
          </p>
        ) : (
          <ScrollArea className="flex-1 pr-3">
            <ol className="space-y-3">
              {steps.map((step, index) => (
                <li
                  key={`${step.name}-${index}`}
                  className={`rounded-md border p-3 ${step.status === 'failed' ? 'border-destructive' : 'dark:border-slate-700'}`}
                >
                  <div className="flex items-start gap-2">
                    {step.status === 'failed' ? (
                      <XCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {index + 1}. {step.name}
                        </span>
                        <Badge variant="outline" className="whitespace-nowrap text-xs">
                          {step.type}
                        </Badge>
                        {step.healed && (
                          <Badge variant="secondary" className="whitespace-nowrap text-xs">
                            <Wand2 className="h-3 w-3 mr-1" /> healed
                          </Badge>
                        )}
                      </div>
                      <p className={`text-xs mt-1 ${step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {step.error || step.details}
                      </p>
                      {step.rca && <p className="text-xs mt-1 italic text-muted-foreground">{step.rca}</p>}
                    </div>
                  </div>

                  {step.visual && <VisualPanel visual={step.visual} />}
                  {step.accessibility && <AccessibilityPanel finding={step.accessibility} />}
                  {step.performance && <SpeedPanel finding={step.performance} />}
                  {step.lighthouse && <LighthousePanel finding={step.lighthouse} />}

                  {/* The step's own screenshot comes last, and not at all when a visual
                      comparison already showed this run's page beside its baseline. */}
                  {step.screenshot && !step.visual?.actualImage && (
                    <div className="mt-3">
                      <ImagePanel label="Screenshot" src={step.screenshot} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default StepDetailsDialog;

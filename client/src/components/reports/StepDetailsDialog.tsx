import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Wand2, Image as ImageIcon } from 'lucide-react';
import type { AccessibilityFinding } from '@shared/accessibility';
import type { DownloadFinding } from '@shared/downloads';
import {
  PERFORMANCE_METRICS,
  formatMetric,
  type LighthouseFinding,
  type PerformanceFinding,
} from '@shared/web-performance';
import AccessibilityPanel from './AccessibilityPanel';
import NetworkPanel from './NetworkPanel';
import type { NetworkSummary } from '@shared/network';
import type { AttemptView, EvidenceLinks, UnitEvidenceView } from '@shared/execution-identity';

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
  /** Why an `error` outcome happened (server/web/visual-testing.ts, VisualErrorCause). */
  cause?: string;
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
  evidenceUnavailable?: boolean;
  visual?: ReportStepVisual;
  accessibility?: AccessibilityFinding;
  performance?: PerformanceFinding;
  lighthouse?: LighthouseFinding;
  download?: DownloadFinding;
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
  /** A trace or HAR was kept, and only the editor role may open it: the page says so. */
  evidenceRestricted?: boolean;
  /** The page's failed and slowest requests, whenever the network was recorded. */
  network?: NetworkSummary | null;
  /** A mobile test's session on its grid, with the device's video and logs. */
  sessionUrl?: string | null;
  /**
   * Every attempt at this result's unit and every dataset row of each, with its own evidence
   * (shared/execution-identity.ts). Absent for a result from before runs kept a manifest.
   */
  unitEvidence?: UnitEvidenceView | null;
  /** The attempt and row to open on; by default the attempt the result stands on, all rows. */
  initialAttempt?: number | null;
  initialRow?: number | null;
}

/** The steps of one dataset row, out of the merged list ("Row 2 of 3 — Click"). */
function stepsOfRow(steps: ReportStep[], row: number): ReportStep[] {
  const prefix = `Row ${row + 1} of `;
  return steps.filter((step) => step.name.startsWith(prefix));
}

const sliceTone = (status: string | null) =>
  status === 'passed'
    ? 'secondary'
    : status === 'failed' || status === 'error'
      ? 'destructive'
      : 'outline';

/**
 * Which attempt, and which dataset row of it, the dialog shows. Each choice opens that slice's own
 * evidence — its screenshot, video, trace and HAR — and nothing of another attempt or row.
 */
function SlicePicker({
  evidence,
  attempt,
  row,
  onAttempt,
  onRow,
}: {
  evidence: UnitEvidenceView;
  attempt: AttemptView | null;
  row: number | null;
  onAttempt: (attempt: number) => void;
  onRow: (row: number | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2" data-testid="slice-picker">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('stepDetails.attempts', 'Attempts')}
      >
        <span className="text-xs text-muted-foreground">
          {t('stepDetails.attempts', 'Attempts')}
        </span>
        {evidence.attempts.map((a) => (
          <button
            key={a.attempt}
            type="button"
            data-testid={`attempt-${a.attempt}`}
            aria-pressed={attempt?.attempt === a.attempt}
            onClick={() => onAttempt(a.attempt)}
            className={`rounded-md border px-2 py-0.5 text-xs ${attempt?.attempt === a.attempt ? 'border-primary ring-1 ring-primary' : 'dark:border-slate-700'}`}
          >
            {t('stepDetails.attemptLabel', 'Attempt {{n}}', { n: a.attempt })}{' '}
            <Badge variant={sliceTone(a.status)} className="ml-1 text-[10px]">
              {a.status ?? t('stepDetails.running', 'running')}
            </Badge>
            {a.attempt === evidence.decidingAttempt && (
              <span className="ml-1 text-muted-foreground">
                {t('stepDetails.deciding', '· result')}
              </span>
            )}
          </button>
        ))}
      </div>
      {attempt && attempt.rows.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t('stepDetails.rows', 'Dataset rows')}
        >
          <span className="text-xs text-muted-foreground">
            {t('stepDetails.rows', 'Dataset rows')}
          </span>
          <button
            type="button"
            data-testid="row-all"
            aria-pressed={row === null}
            onClick={() => onRow(null)}
            className={`rounded-md border px-2 py-0.5 text-xs ${row === null ? 'border-primary ring-1 ring-primary' : 'dark:border-slate-700'}`}
          >
            {t('stepDetails.allRows', 'All rows')}
          </button>
          {attempt.rows.map((r) => (
            <button
              key={r.datasetRow}
              type="button"
              data-testid={`row-${r.datasetRow}`}
              aria-pressed={row === r.datasetRow}
              onClick={() => onRow(r.datasetRow)}
              className={`rounded-md border px-2 py-0.5 text-xs ${row === r.datasetRow ? 'border-primary ring-1 ring-primary' : 'dark:border-slate-700'}`}
            >
              {t('stepDetails.rowLabel', 'Row {{n}}', { n: r.datasetRow + 1 })}{' '}
              <Badge variant={sliceTone(r.status)} className="ml-1 text-[10px]">
                {r.status}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The picture and what it is a picture of, since three unlabelled images say nothing. */
/** What a measurePerformance step measured, with the limits it checked. */
function SpeedPanel({ finding }: { finding: PerformanceFinding }) {
  const limited = new Map(finding.checks.map((c) => [c.metric, c]));
  return (
    <div className="mt-3 rounded-md border p-3 dark:border-slate-700" data-testid="speed-panel">
      <p className="mb-2 text-sm font-medium">
        Page speed ·{' '}
        <span className="font-normal text-muted-foreground break-all">{finding.url}</span>
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {PERFORMANCE_METRICS.map((m) => {
          const c = limited.get(m);
          return (
            <div key={m} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{m}</dt>
              <dd
                className={`tabular-nums ${c?.ok === false ? 'font-semibold text-destructive' : ''}`}
              >
                {formatMetric(m, finding.metrics[m] ?? null)}
                {c ? ` (${c.op} ${formatMetric(m, c.value)})` : ''}
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
    <div
      className="mt-3 rounded-md border p-3 dark:border-slate-700"
      data-testid="lighthouse-panel"
    >
      <p className="mb-2 text-sm font-medium">
        Lighthouse · {finding.formFactor}
        {finding.reportUrl && (
          <a
            href={finding.reportUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-2 text-xs font-normal text-primary underline"
          >
            report
          </a>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(finding.scores).map(([category, score]) => (
          <Badge
            key={category}
            variant={broken.has(category as never) ? 'destructive' : 'secondary'}
          >
            {category} {score}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/** The file an expectDownload step took, what it held, and the checks on it. */
function DownloadPanel({ finding }: { finding: DownloadFinding }) {
  return (
    <div className="mt-3 rounded-md border p-3 dark:border-slate-700" data-testid="download-panel">
      <p className="mb-1 text-sm font-medium">
        Download ·{' '}
        {finding.fileUrl ? (
          <a
            href={finding.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            {finding.name}
          </a>
        ) : (
          finding.name
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {finding.type} · {Math.max(1, Math.round(finding.size / 1024))} KB
        {finding.rows !== undefined && ` · ${finding.rows} rows × ${finding.columns} columns`}
        {finding.pages !== undefined && ` · ${finding.pages} page(s)`}
      </p>
      {finding.checks.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {finding.checks.map((c) => (
            <li key={c.text} className={c.ok ? '' : 'font-semibold text-destructive'}>
              {c.ok ? '✓' : '✗'} {c.text}
              {!c.ok && c.actual ? ` — ${c.actual}` : ''}
            </li>
          ))}
        </ul>
      )}
      {finding.sample && (
        <p className="mt-2 line-clamp-3 break-all text-xs text-muted-foreground">
          {finding.sample}
        </p>
      )}
    </div>
  );
}

function ImagePanel({ label, src }: { label: string; src?: string | null }) {
  if (!src) return null;
  return (
    <figure className="min-w-0 flex-1">
      <figcaption className="text-xs text-muted-foreground mb-1">{label}</figcaption>
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        title={`Open ${label.toLowerCase()} full size`}
      >
        <img
          src={src}
          alt={label}
          className="w-full rounded border dark:border-slate-700 bg-muted"
          loading="lazy"
        />
      </a>
    </figure>
  );
}

function VisualPanel({ visual }: { visual: ReportStepVisual }) {
  const isDiff = visual.outcome === 'diff';
  // A comparison that could not run is not a regression: no red, and the cause beside it.
  const isError = visual.outcome === 'error';
  return (
    <div
      className={`mt-3 rounded-md border p-3 ${isDiff ? 'border-destructive/60' : isError ? 'border-amber-500/60' : 'dark:border-slate-700'}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <ImageIcon className="h-4 w-4" />
        <span className="text-sm font-medium">Visual check</span>
        <Badge
          variant={isDiff ? 'destructive' : isError ? 'outline' : 'secondary'}
          className="whitespace-nowrap"
        >
          {isError && visual.cause ? `not verified · ${visual.cause}` : visual.outcome}
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
  evidenceRestricted,
  network,
  sessionUrl,
  unitEvidence,
  initialAttempt,
  initialRow,
}) => {
  const { t } = useTranslation();
  const attempts = unitEvidence?.attempts ?? [];
  const deciding = unitEvidence?.decidingAttempt ?? null;
  const openOn = initialAttempt ?? deciding ?? attempts[attempts.length - 1]?.attempt ?? null;
  const [attemptNo, setAttemptNo] = useState<number | null>(openOn);
  const [rowNo, setRowNo] = useState<number | null>(initialRow ?? null);
  // Each opening starts on the slice it was opened for, not where the last one was left.
  useEffect(() => {
    if (!open) return;
    setAttemptNo(openOn);
    setRowNo(initialRow ?? null);
  }, [open, openOn, initialRow, unitEvidence]);

  const attempt = attempts.find((a) => a.attempt === attemptNo) ?? null;
  const row = attempt?.rows.find((r) => r.datasetRow === rowNo) ?? null;
  // The evidence shown is the selected slice's own: a row's, else its attempt's. Without a
  // manifest, the result's links as they always were.
  const slice: EvidenceLinks | null = row ?? attempt;
  const shown = slice
    ? {
        videoUrl: slice.videoUrl,
        traceUrl: slice.traceUrl,
        harUrl: slice.harUrl,
        restricted: slice.restricted,
        screenshotUrl: slice.screenshotUrl,
      }
    : { videoUrl, traceUrl, harUrl, restricted: evidenceRestricted, screenshotUrl: null };
  // The steps were recorded for the attempt the result stands on; another attempt shows its
  // evidence and why it ended, and says its steps are in its trace.
  const isDeciding = !attempt || attempt.attempt === deciding;
  const shownSteps = !isDeciding ? [] : row ? stepsOfRow(steps, row.datasetRow) : steps;
  const sliceError = row?.error ?? (row ? null : attempt?.failureReason) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{testName}</DialogTitle>
          <DialogDescription>
            {browser ? `Steps recorded on ${browser}.` : 'Steps recorded during this run.'}
          </DialogDescription>
        </DialogHeader>

        {unitEvidence && attempts.length > 0 && (
          <SlicePicker
            evidence={unitEvidence}
            attempt={attempt}
            row={row?.datasetRow ?? null}
            onAttempt={(n) => {
              setAttemptNo(n);
              setRowNo(null);
            }}
            onRow={setRowNo}
          />
        )}

        {slice && (sliceError || (!isDeciding && shown.screenshotUrl)) && (
          <div
            className="rounded-md border p-3 space-y-2 dark:border-slate-700"
            data-testid="slice-summary"
          >
            {sliceError && <p className="text-xs text-destructive">{sliceError}</p>}
            {shown.screenshotUrl && (
              <ImagePanel
                label={t('stepDetails.sliceScreenshot', 'Screenshot')}
                src={shown.screenshotUrl}
              />
            )}
          </div>
        )}

        {sessionUrl && (
          <p className="text-xs text-muted-foreground">
            <a
              href={sessionUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
              data-testid="device-session"
            >
              Open the session on the grid
            </a>{' '}
            — the device's video and logs, kept by the grid.
          </p>
        )}

        {(shown.videoUrl || shown.traceUrl) && (
          <div className="rounded-md border p-3 space-y-2 dark:border-slate-700">
            {shown.videoUrl && (
              <video
                src={shown.videoUrl}
                controls
                className="w-full rounded max-h-72 bg-black"
                data-testid="run-video"
              />
            )}
            {shown.traceUrl && (
              <p className="text-xs text-muted-foreground">
                <a href={shown.traceUrl} className="underline" download data-testid="trace-link">
                  Download the Playwright trace
                </a>{' '}
                — it carries the DOM, the network and the console at every step. Open it with{' '}
                <code>npx playwright show-trace &lt;file&gt;</code> or at{' '}
                <a
                  href="https://trace.playwright.dev"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  trace.playwright.dev
                </a>
                .
              </p>
            )}
          </div>
        )}

        {shown.restricted && (
          <p className="text-xs text-muted-foreground" data-testid="evidence-restricted">
            {t(
              'stepDetails.evidenceRestricted',
              'This run kept a Playwright trace or a network recording. They can hold passwords and tokens in clear, so only editors and owners can download them.',
            )}
          </p>
        )}

        {network && isDeciding && !row && <NetworkPanel summary={network} harUrl={shown.harUrl} />}
        {slice && shown.harUrl && (!network || !isDeciding || row) && (
          <p className="text-xs text-muted-foreground">
            <a href={shown.harUrl} className="underline" download data-testid="har-link">
              {t('stepDetails.downloadHar', 'Download the network recording (HAR)')}
            </a>
          </p>
        )}

        {!isDeciding ? (
          <p className="text-sm text-muted-foreground py-6" data-testid="steps-not-kept">
            {t(
              'stepDetails.stepsNotKept',
              'The report keeps the steps of the attempt the result stands on. This attempt’s own steps are in its trace and video, when the plan kept them.',
            )}
          </p>
        ) : shownSteps.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">
            This result has no recorded steps. API tests and tests blocked by a precondition never
            reach the step runner.
          </p>
        ) : (
          <ScrollArea className="flex-1 pr-3">
            <ol className="space-y-3">
              {shownSteps.map((step, index) => (
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
                      <p
                        className={`text-xs mt-1 ${step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}
                      >
                        {step.error || step.details}
                      </p>
                      {step.rca && (
                        <p className="text-xs mt-1 italic text-muted-foreground">{step.rca}</p>
                      )}
                    </div>
                  </div>

                  {step.evidenceUnavailable && (
                    <p className="text-xs mt-2 text-amber-700 dark:text-amber-400">
                      {t(
                        'quota.evidenceUnavailable',
                        'Evidence unavailable: not retained by the artifact store.',
                      )}
                    </p>
                  )}
                  {step.visual && <VisualPanel visual={step.visual} />}
                  {step.accessibility && <AccessibilityPanel finding={step.accessibility} />}
                  {step.performance && <SpeedPanel finding={step.performance} />}
                  {step.lighthouse && <LighthousePanel finding={step.lighthouse} />}
                  {step.download && <DownloadPanel finding={step.download} />}

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

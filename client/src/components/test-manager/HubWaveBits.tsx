import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2 } from 'lucide-react';
import type { HubResultStatus } from '@shared/hub-waves';
import {
  isLiveJob,
  type HubJob,
  type HubWaveRates,
  type HubWaveSummary,
} from '@/hooks/useHubWaves';

/** The small pieces every wave view shares: a status, the two rates, a job's progress. */

const STATUS_CLASS: Record<HubResultStatus, string> = {
  passed: 'bg-success/15 text-success hover:bg-success/15',
  failed: 'bg-destructive/15 text-destructive hover:bg-destructive/15',
  on_hold: 'bg-warning/15 text-warning hover:bg-warning/15',
  not_tested: 'bg-muted text-muted-foreground hover:bg-muted',
  pending: 'bg-secondary text-secondary-foreground hover:bg-secondary',
};

const STATUS_DEFAULT: Record<HubResultStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  on_hold: 'On hold',
  not_tested: 'Not tested',
  pending: 'Pending',
};

export function useStatusLabel() {
  const { t } = useTranslation();
  return (status: HubResultStatus) =>
    t(`hubWaves.status.${status}`, { defaultValue: STATUS_DEFAULT[status] });
}

export function HubResultStatusBadge({ status }: { status: HubResultStatus }) {
  const label = useStatusLabel();
  return <Badge className={STATUS_CLASS[status]}>{label(status)}</Badge>;
}

/** Executed and pass rate, as the QA team reports them. */
export function RatesCell({ rates }: { rates: HubWaveRates }) {
  const { t } = useTranslation();
  if (rates.total === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap text-sm tabular-nums">
      {t('hubWaves.rates.short', {
        defaultValue: '{{executed}}% run · {{pass}}% passed',
        executed: rates.executedPct,
        pass: rates.passRatePct,
      })}
    </span>
  );
}

/** Where a wave stands against WFM: not imported, imported, changed in the hub since, gone. */
export function WaveStateBadge({
  wave,
}: {
  wave: Pick<HubWaveSummary, 'missingSince' | 'imported' | 'changedSinceImport'>;
}) {
  const { t } = useTranslation();
  if (wave.missingSince)
    return <Badge variant="destructive">{t('hubWaves.state.missing', 'Not in the hub')}</Badge>;
  if (wave.imported && wave.changedSinceImport)
    return (
      <Badge className="bg-warning/15 text-warning hover:bg-warning/15">
        {t('hubWaves.state.changed', 'Changed since import')}
      </Badge>
    );
  if (wave.imported) return <Badge>{t('hubWaves.state.imported', 'Imported')}</Badge>;
  return <Badge variant="secondary">{t('hubWaves.state.notImported', 'Not imported')}</Badge>;
}

/** A running job: what it is doing, how far it got, and a way to stop it. */
export function HubJobBanner({
  job,
  canCancel,
  cancelling,
  onCancel,
}: {
  job: HubJob;
  canCancel: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  if (!isLiveJob(job)) return null;
  const { done = 0, total = 0, current } = job.progress ?? {};
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const title =
    job.kind === 'waves_sync'
      ? t('hubWaves.job.syncing', 'Reading the waves from the hub…')
      : t('hubWaves.job.importing', 'Importing the waves…');
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-3"
      role="status"
      data-testid="hub-wave-job"
    >
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
      <div className="min-w-[200px] flex-1 space-y-1">
        <p className="text-sm font-medium">
          {title}
          {current ? <span className="ml-2 text-muted-foreground">{current}</span> : null}
        </p>
        <Progress value={pct} aria-label={title} />
      </div>
      {canCancel && (
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={cancelling || job.cancelRequested}
          data-testid="hub-wave-job-cancel"
        >
          {job.cancelRequested
            ? t('hubWaves.job.stopping', 'Stopping…')
            : t('hubWaves.job.cancel', 'Stop')}
        </Button>
      )}
    </div>
  );
}

/** Fetches an export with the session cookie and saves it under the server's file name. */
export async function downloadFrom(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || `Export failed (${res.status})`);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
  URL.revokeObjectURL(href);
}

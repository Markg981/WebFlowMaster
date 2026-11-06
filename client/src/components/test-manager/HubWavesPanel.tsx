import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/dates';
import { Download, FolderGit2, Loader2, RefreshCw, Waves } from 'lucide-react';
import { hubErrorMessage, useHubSource } from '@/hooks/useTestCaseHub';
import {
  isLiveJob,
  useCancelHubJob,
  useHubJob,
  useHubWaves,
  useHubWavesOverview,
  useSyncHubWaves,
  type HubJob,
} from '@/hooks/useHubWaves';
import { HubJobBanner, RatesCell, WaveStateBadge, useStatusLabel } from './HubWaveBits';
import HubWaveDetailDialog from './HubWaveDetailDialog';
import HubWaveImportDialog from './HubWaveImportDialog';

/**
 * The QA team's waves, read from the hub: how each session went, the trend across them, and the
 * modules. From here a person reads the waves again, imports the chosen ones as WFM plans and
 * runs, and opens one to see its cases, run them again or take its results back to the hub.
 */

const HubWavesPanel: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = user?.role !== 'viewer';
  const statusLabel = useStatusLabel();

  const { data: source, isLoading: sourceLoading } = useHubSource();
  const { data: overview } = useHubWavesOverview(!!source);
  const { data: waves = [], isLoading: wavesLoading } = useHubWaves(!!source);

  const [jobId, setJobId] = useState<string | null>(null);
  const { data: job } = useHubJob(jobId);
  const cancel = useCancelHubJob();
  const sync = useSyncHubWaves();

  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  // A job started before the page was opened (by this person or a colleague) is followed too.
  useEffect(() => {
    if (!jobId && isLiveJob(overview?.lastJob)) setJobId(overview!.lastJob!.id);
  }, [overview, jobId]);

  // Said once, when the followed job ends.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!job || isLiveJob(job) || announced.current === job.id) return;
    announced.current = job.id;
    toast(jobToast(job));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const jobToast = (ended: HubJob) => {
    if (ended.status === 'failed')
      return {
        title: t('hubWaves.job.failed', 'The job failed'),
        description: ended.error ?? '',
        variant: 'destructive' as const,
      };
    if (ended.status === 'cancelled')
      return { title: t('hubWaves.job.cancelled', 'The job was stopped') };
    const summary = (ended.summary ?? {}) as Record<string, unknown>;
    if (ended.kind === 'waves_sync')
      return {
        title: t('hubWaves.job.synced', 'Waves read from the hub'),
        description: t('hubWaves.job.syncSummary', {
          defaultValue:
            '{{waves}} waves: {{added}} new, {{updated}} changed, {{missing}} no longer in the hub.',
          waves: Number(summary.waves ?? 0),
          added: Number(summary.added ?? 0),
          updated: Number(summary.updated ?? 0),
          missing: Number(summary.missing ?? 0),
        }),
      };
    const outcomes = Array.isArray(summary.waves)
      ? (summary.waves as Array<{ imported?: number; results?: number }>)
      : [];
    return {
      title: t('hubWaves.job.imported', 'Waves imported'),
      description: t('hubWaves.job.importSummary', {
        defaultValue: '{{waves}} waves, {{results}} results, {{imported}} cases imported as tests.',
        waves: outcomes.length,
        results: outcomes.reduce((sum, o) => sum + Number(o.results ?? 0), 0),
        imported: outcomes.reduce((sum, o) => sum + Number(o.imported ?? 0), 0),
      }),
    };
  };

  const live = isLiveJob(job);
  const startSync = () =>
    sync.mutate(undefined, {
      onSuccess: (started) => setJobId(started.id),
      onError: (error) =>
        toast({
          title: t('hubWaves.job.syncFailed', 'The waves could not be read'),
          description: hubErrorMessage(error, t),
          variant: 'destructive',
        }),
    });

  const toggle = (id: number, checked: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const selectable = waves.filter((wave) => !wave.missingSince);
  const allSelected = selectable.length > 0 && selectable.every((wave) => selected.has(wave.id));

  if (sourceLoading) {
    return (
      <Card className="space-y-3 p-6">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  }

  if (!source) {
    return (
      <Card>
        <EmptyState
          icon={FolderGit2}
          title={t('hubWaves.noSource.title', 'No test case hub yet')}
          description={t(
            'hubWaves.noSource.description',
            'Set up the QA test case hub first: its waves are read from the same repository.',
          )}
        />
      </Card>
    );
  }

  const syncButton = canEdit ? (
    <Button onClick={startSync} disabled={sync.isPending || live} data-testid="hub-waves-sync">
      {sync.isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-2 h-4 w-4" />
      )}
      {t('hubWaves.sync', 'Read the waves')}
    </Button>
  ) : undefined;

  const trend = (overview?.trend ?? []).map((point) => ({
    name: point.name,
    passed: point.counts.passed,
    failed: point.counts.failed,
    on_hold: point.counts.on_hold,
    other: point.counts.not_tested + point.counts.pending,
  }));

  return (
    <div className="space-y-4" data-testid="hub-waves">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Waves className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">{source.name}</span>
            {overview?.lastJob?.finishedAt && (
              <span className="text-muted-foreground">
                {t('hubWaves.lastJob', {
                  defaultValue: 'Last job {{date}}',
                  date: formatDateTime(overview.lastJob.finishedAt, i18n.language),
                })}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {canEdit && (
              <Button
                variant="outline"
                onClick={() => setImportOpen(true)}
                disabled={selected.size === 0 || live}
                data-testid="hub-waves-import"
              >
                <Download className="mr-2 h-4 w-4" />
                {t('hubWaves.importSelected', {
                  defaultValue: 'Import {{count}} waves',
                  count: selected.size,
                })}
              </Button>
            )}
            {syncButton}
          </div>
        </div>
        {job && (
          <HubJobBanner
            job={job}
            canCancel={canEdit}
            cancelling={cancel.isPending}
            onCancel={() => cancel.mutate(job.id)}
          />
        )}

        {overview && overview.waves > 0 && (
          <div className="grid gap-3 p-4 sm:grid-cols-5" data-testid="hub-waves-kpis">
            {[
              [t('hubWaves.kpi.waves', 'Waves'), overview.waves],
              [t('hubWaves.kpi.imported', 'Imported'), overview.imported],
              [t('hubWaves.kpi.cases', 'Cases tested'), overview.cases],
              [t('hubWaves.kpi.executed', 'Executed'), `${overview.rates.executedPct}%`],
              [t('hubWaves.kpi.passRate', 'Pass rate'), `${overview.rates.passRatePct}%`],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {wavesLoading ? (
        <Card className="space-y-3 p-6">
          <Skeleton className="h-40 w-full" />
        </Card>
      ) : waves.length === 0 ? (
        <Card>
          <EmptyState
            icon={Waves}
            title={t('hubWaves.empty.title', 'No waves yet')}
            description={t(
              'hubWaves.empty.description',
              'Read the waves to bring in the QA team’s sessions and their results from the hub.',
            )}
            action={syncButton}
          />
        </Card>
      ) : (
        <>
          {trend.length > 1 && (
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold">
                {t('hubWaves.trend', 'Results across the waves')}
              </h3>
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      stroke="hsl(var(--border))"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      stroke="hsl(var(--border))"
                      allowDecimals={false}
                    />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="passed" stackId="s" name={statusLabel('passed')} fill="hsl(var(--success))" />
                    <Bar dataKey="failed" stackId="s" name={statusLabel('failed')} fill="hsl(var(--destructive))" />
                    <Bar dataKey="on_hold" stackId="s" name={statusLabel('on_hold')} fill="hsl(var(--warning))" />
                    <Bar
                      dataKey="other"
                      stackId="s"
                      name={t('hubWaves.notRun', 'Not run')}
                      fill="hsl(var(--muted-foreground))"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  {canEdit && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(checked) =>
                          setSelected(checked === true ? new Set(selectable.map((w) => w.id)) : new Set())
                        }
                        aria-label={t('hubWaves.selectAll', 'Select every wave')}
                      />
                    </TableHead>
                  )}
                  <TableHead>{t('hubWaves.columns.wave', 'Wave')}</TableHead>
                  <TableHead>{t('hubWaves.columns.release', 'Release')}</TableHead>
                  <TableHead>{t('hubWaves.columns.type', 'Type')}</TableHead>
                  <TableHead>{t('hubWaves.columns.start', 'Start')}</TableHead>
                  <TableHead className="text-right">{t('hubWaves.columns.cases', 'Cases')}</TableHead>
                  <TableHead className="text-right">{statusLabel('failed')}</TableHead>
                  <TableHead>{t('hubWaves.columns.rates', 'Progress')}</TableHead>
                  <TableHead>{t('hubWaves.columns.state', 'In WebFlowMaster')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {waves.map((wave) => (
                  <TableRow key={wave.id} data-testid={`hub-wave-row-${wave.waveId}`}>
                    {canEdit && (
                      <TableCell>
                        <Checkbox
                          checked={selected.has(wave.id)}
                          disabled={!!wave.missingSince}
                          onCheckedChange={(checked) => toggle(wave.id, checked === true)}
                          aria-label={t('hubWaves.select', {
                            defaultValue: 'Select {{name}}',
                            name: wave.name,
                          })}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <button
                        type="button"
                        className="text-left font-medium hover:underline"
                        onClick={() => setDetailId(wave.id)}
                        data-testid={`hub-wave-open-${wave.waveId}`}
                      >
                        {wave.name}
                      </button>
                      <div className="font-mono text-xs text-muted-foreground">{wave.waveId}</div>
                    </TableCell>
                    <TableCell>{wave.release ?? '—'}</TableCell>
                    <TableCell>{wave.waveType ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">{wave.startDate ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{wave.rates.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{wave.counts.failed}</TableCell>
                    <TableCell>
                      <RatesCell rates={wave.rates} />
                    </TableCell>
                    <TableCell>
                      <WaveStateBadge wave={wave} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {overview && overview.modules.length > 0 && (
            <Card className="overflow-hidden">
              <h3 className="border-b px-4 py-3 text-sm font-semibold">
                {t('hubWaves.modules', 'Modules across every wave')}
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('hubWaves.columns.module', 'Module')}</TableHead>
                    <TableHead className="text-right">{t('hubWaves.columns.results', 'Results')}</TableHead>
                    <TableHead className="text-right">{statusLabel('failed')}</TableHead>
                    <TableHead>{t('hubWaves.columns.rates', 'Progress')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.modules.map((row) => (
                    <TableRow key={row.module ?? ''}>
                      <TableCell>{row.module ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.rates.total}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.counts.failed}</TableCell>
                      <TableCell>
                        <RatesCell rates={row.rates} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}

      <HubWaveImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        waveIds={Array.from(selected)}
        onStarted={(started) => {
          setJobId(started.id);
          setSelected(new Set());
        }}
      />
      <HubWaveDetailDialog waveRowId={detailId} onOpenChange={(open) => !open && setDetailId(null)} />
    </div>
  );
};

export default HubWavesPanel;

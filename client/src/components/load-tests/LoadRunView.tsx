import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, ComposedChart, Area, Line, Bar, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceArea } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { LoadRunStatus, LoadStats, LoadSummary } from '@shared/load-test';

/**
 * One run of a load test, followed while it runs (the runner writes its summary every 2 s) and
 * kept once it is over: the timeline, the statistics per step and the verdict.
 */

export interface LoadRun {
  id: string;
  loadTestId: number;
  status: LoadRunStatus;
  summary: LoadSummary | null;
  error: string | null;
  cancelRequested: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export function useLoadRunStatusLabel() {
  const { t } = useTranslation();
  return (status: LoadRunStatus) =>
    ({
      running: t('loadTests.status.running', 'Running'),
      passed: t('loadTests.status.passed', 'Passed'),
      failed: t('loadTests.status.failed', 'Failed'),
      cancelled: t('loadTests.status.cancelled', 'Cancelled'),
      error: t('loadTests.status.error', 'Could not run'),
    })[status];
}

export const statusVariant = (status: LoadRunStatus) =>
  status === 'passed' ? 'default' : status === 'failed' || status === 'error' ? 'destructive' : 'secondary';

interface Props {
  runId: string;
  canEdit: boolean;
  onFinished?: () => void;
}

export default function LoadRunView({ runId, canEdit, onFinished }: Props) {
  const { t } = useTranslation();
  const label = useLoadRunStatusLabel();
  const finishedOnce = React.useRef(false);
  const { data: run, refetch } = useQuery<LoadRun>({
    queryKey: ['loadRun', runId],
    queryFn: async () => {
      const response = await fetch(`/api/load-test-runs/${runId}`, { credentials: 'include' });
      if (!response.ok) throw new Error(t('loadTests.runLoadFailed', 'Could not load the run.'));
      return response.json();
    },
    refetchInterval: (query) => (query.state.data && query.state.data.status !== 'running' ? false : 2000),
  });

  React.useEffect(() => {
    if (run && run.status !== 'running' && !finishedOnce.current) {
      finishedOnce.current = true;
      onFinished?.();
    }
  }, [run, onFinished]);

  const cancel = async () => {
    await fetch(`/api/load-test-runs/${runId}/cancel`, { method: 'POST', credentials: 'include' });
    await refetch();
  };

  if (!run) return <p className="text-sm text-muted-foreground">{t('loadTests.loading', 'Loading…')}</p>;
  const summary = run.summary;
  const progress = summary ? Math.round((summary.elapsedSec / Math.max(1, summary.totalSec)) * 100) : 0;
  const rows: Array<{ name: string; stats: LoadStats }> = summary
    ? [...summary.steps.map((s) => ({ name: s.name, stats: s })), { name: t('loadTests.overall', 'All requests'), stats: summary.overall }]
    : [];
  const timeline = (summary?.timeline ?? []).map((p) => ({ ...p, rps: Math.round((p.requests / (summary?.bucketSec || 1)) * 10) / 10 }));

  return (
    <div className="space-y-4" data-testid={`load-run-${run.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={statusVariant(run.status)}>{label(run.status)}</Badge>
        <span className="text-sm text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</span>
        {summary && (
          <span className="text-sm">
            {t('loadTests.progress', '{{elapsed}} of {{total}} s · {{vus}} virtual users now, {{peak}} at the peak', {
              elapsed: summary.elapsedSec,
              total: summary.totalSec,
              vus: summary.activeVus,
              peak: summary.peakVus,
            })}
          </span>
        )}
        {canEdit && run.status === 'running' && (
          <Button variant="outline" size="sm" disabled={run.cancelRequested} onClick={() => void cancel()}>
            {run.cancelRequested ? t('loadTests.cancelling', 'Stopping…') : t('loadTests.stop', 'Stop the run')}
          </Button>
        )}
      </div>
      {run.status === 'running' && <Progress value={progress} aria-label={t('loadTests.progressLabel', 'Run progress')} />}
      {run.error && <p role="alert" className="text-sm text-destructive">{run.error}</p>}

      {summary && summary.timeline.length > 0 && (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={timeline} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="t" unit=" s" fontSize={12} />
              <YAxis yAxisId="left" fontSize={12} />
              <YAxis yAxisId="right" orientation="right" unit=" ms" fontSize={12} />
              <Tooltip />
              <Legend />
              {summary.warmUpSec > 0 && <ReferenceArea yAxisId="left" x1={0} x2={summary.warmUpSec} fillOpacity={0.08} label={t('loadTests.warmUpShort', 'Warm-up')} />}
              <Area yAxisId="left" type="stepAfter" dataKey="vus" name={t('loadTests.chart.vus', 'Virtual users')} fill="hsl(var(--primary))" fillOpacity={0.15} stroke="hsl(var(--primary))" />
              <Bar yAxisId="left" dataKey="rps" name={t('loadTests.chart.rps', 'Requests/s')} fill="hsl(var(--muted-foreground))" fillOpacity={0.4} />
              <Line yAxisId="right" type="monotone" dataKey="p95Ms" name={t('loadTests.chart.p95', 'p95 (ms)')} stroke="hsl(var(--destructive))" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {summary && (
        <>
          <p className="text-sm">
            {t('loadTests.totals', '{{requests}} requests judged at {{rps}} req/s · {{completed}} iterations completed, {{failed}} failed · warm-up: {{warm}} requests, not judged', {
              requests: summary.overall.requests,
              rps: summary.overall.rps,
              completed: summary.iterations.completed,
              failed: summary.iterations.failed,
              warm: summary.warmUp.requests,
            })}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('loadTests.columns.step', 'Step')}</TableHead>
                <TableHead className="text-right">{t('loadTests.columns.requests', 'Requests')}</TableHead>
                <TableHead className="text-right">{t('loadTests.columns.errors', 'Errors')}</TableHead>
                <TableHead className="text-right">p50</TableHead>
                <TableHead className="text-right">p90</TableHead>
                <TableHead className="text-right">p95</TableHead>
                <TableHead className="text-right">p99</TableHead>
                <TableHead className="text-right">max</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ name, stats }, index) => (
                <TableRow key={index} className={index === rows.length - 1 ? 'font-medium' : undefined}>
                  <TableCell>{name}</TableCell>
                  <TableCell className="text-right">{stats.requests}</TableCell>
                  <TableCell className="text-right">{`${stats.errors} (${stats.errorRatePct}%)`}</TableCell>
                  <TableCell className="text-right">{stats.p50Ms} ms</TableCell>
                  <TableCell className="text-right">{stats.p90Ms} ms</TableCell>
                  <TableCell className="text-right">{stats.p95Ms} ms</TableCell>
                  <TableCell className="text-right">{stats.p99Ms} ms</TableCell>
                  <TableCell className="text-right">{stats.maxMs} ms</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {summary.sampleErrors.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('loadTests.sampleErrors', 'First errors')}</p>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {summary.sampleErrors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

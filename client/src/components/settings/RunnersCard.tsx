import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Pause, Play } from 'lucide-react';

/**
 * The machines that run plans. Owners only (the server enforces it).
 *
 * Mostly for two moments: every run is sitting in "queued" and somebody needs to know whether
 * any runner is up at all; and a machine is about to be upgraded, so it is drained, and its job
 * count is watched until it reaches zero.
 */

export interface RunnerRow {
  id: string;
  hostname: string;
  pid: number;
  version: string | null;
  concurrency: number;
  browserTaskConcurrency: number;
  browsers: string[];
  activeJobs: number;
  status: 'online' | 'draining' | 'offline';
  startedAt: string;
  lastSeenAt: string;
}

const STATUS_STYLE: Record<RunnerRow['status'], string> = {
  online: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  draining: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  offline: 'bg-muted text-muted-foreground',
};

export default function RunnersCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data: runners = [], isLoading, isError } = useQuery<RunnerRow[]>({
    queryKey: ['runners'],
    queryFn: async () => {
      const response = await fetch('/api/runners', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load the runners');
      return response.json();
    },
    // A drain is watched until its job count reaches zero.
    refetchInterval: 10_000,
  });

  const act = async (runner: RunnerRow, action: 'drain' | 'resume') => {
    setBusy(runner.id);
    setError('');
    try {
      const response = await fetch(`/api/runners/${encodeURIComponent(runner.id)}/${action}`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Could not change the runner');
      await queryClient.invalidateQueries({ queryKey: ['runners'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const online = runners.filter((r) => r.status === 'online').length;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('runners.loading', 'Loading…')}</p>
        ) : isError ? (
          <p className="text-sm text-destructive">{t('runners.error', 'The runners could not be loaded.')}</p>
        ) : runners.length === 0 || online === 0 ? (
          <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="runners-none">
            {t('runners.none', 'No runner is taking work: every new run will wait in the queue. Start a worker (npm run dev:worker, or the worker service).')}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('runners.summary', '{{online}} of {{total}} runners taking work.', { online, total: runners.length })}
          </p>
        )}

        {runners.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('runners.columns.runner', 'Runner')}</TableHead>
                  <TableHead>{t('runners.columns.status', 'Status')}</TableHead>
                  <TableHead>{t('runners.columns.jobs', 'Jobs')}</TableHead>
                  <TableHead>{t('runners.columns.browsers', 'Browsers')}</TableHead>
                  <TableHead>{t('runners.columns.lastSeen', 'Last seen')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runners.map((runner) => (
                  <TableRow key={runner.id} data-testid={`runner-${runner.id}`}>
                    <TableCell className="text-xs">
                      <span className="font-medium">{runner.hostname}</span>
                      <span className="block text-muted-foreground">
                        {runner.version ? `v${runner.version} · ` : ''}pid {runner.pid}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[runner.status]}`}>
                        {t(`runners.status.${runner.status}`, runner.status)}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {runner.status === 'offline' ? '—' : `${runner.activeJobs} / ${runner.concurrency + runner.browserTaskConcurrency}`}
                    </TableCell>
                    <TableCell className="text-xs">
                      {runner.browsers.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {runner.browsers.map((browser) => (
                            <Badge key={browser} variant="outline" className="text-[10px]">{browser}</Badge>
                          ))}
                        </span>
                      ) : (
                        <span className="text-destructive">{t('runners.noBrowsers', 'none installed')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(runner.lastSeenAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {runner.status === 'online' && (
                        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => act(runner, 'drain')}>
                          {busy === runner.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4 mr-1" />}
                          {t('runners.drain', 'Drain')}
                        </Button>
                      )}
                      {runner.status === 'draining' && (
                        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => act(runner, 'resume')}>
                          {busy === runner.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
                          {t('runners.resume', 'Resume')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t(
            'runners.drainHint',
            'Draining lets a runner finish what it is running and take nothing new. When its jobs reach zero it can be stopped safely.',
          )}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

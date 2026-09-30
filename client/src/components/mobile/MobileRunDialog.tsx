import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, CircleDashed, ExternalLink, Loader2, Play, XCircle } from 'lucide-react';
import type { MobileRunStatus, MobileStepResult } from '@shared/mobile';
import type { GridOption, MobileTestRow } from './MobileTestDialog';

/**
 * Running a mobile test on a grid's device, and following it: the grid finds a device and installs
 * the app (a minute or two), then each step appears as it runs.
 */

interface Run {
  id: string;
  status: MobileRunStatus;
  device: string;
  steps: MobileStepResult[];
  error: string | null;
  screenshot: string | null;
  sessionUrl: string | null;
}

interface Props {
  test: MobileTestRow | null;
  grids: GridOption[];
  onClose: () => void;
  onFinished: () => void;
}

const NO_ENVIRONMENT = '__none__';
const FINISHED: MobileRunStatus[] = ['passed', 'failed', 'error'];

export default function MobileRunDialog({ test, grids, onClose, onFinished }: Props) {
  const { t } = useTranslation();
  const [gridId, setGridId] = useState('');
  const [environmentId, setEnvironmentId] = useState(NO_ENVIRONMENT);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGridId(grids[0]?.id ?? '');
    setEnvironmentId(NO_ENVIRONMENT);
    setRunId(null);
    setError(null);
  }, [test, grids]);

  const { data: environments = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['environments'],
    queryFn: async () => {
      const response = await fetch('/api/environments');
      const rows = response.ok ? await response.json() : [];
      return Array.isArray(rows) ? rows : [];
    },
    enabled: test !== null,
  });

  const { data: run } = useQuery<Run>({
    queryKey: ['mobileRun', runId],
    queryFn: async () => {
      const response = await fetch(`/api/mobile-test-runs/${runId}`);
      if (!response.ok) throw new Error('run');
      return response.json();
    },
    enabled: runId !== null,
    refetchInterval: (query) => (query.state.data && FINISHED.includes(query.state.data.status) ? false : 2000),
  });

  useEffect(() => {
    if (run && FINISHED.includes(run.status)) onFinished();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/mobile-tests/${test!.id}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gridId, environmentId: environmentId === NO_ENVIRONMENT ? null : Number(environmentId) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('mobileTests.run.startFailed', 'The run did not start.'));
      setRunId(body.id);
    } catch (startError) {
      setError((startError as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const statusLabel = (status: MobileRunStatus) =>
    ({
      queued: t('mobileTests.run.queued', 'Waiting for a device…'),
      running: t('mobileTests.run.running', 'Running'),
      passed: t('mobileTests.run.passed', 'Passed'),
      failed: t('mobileTests.run.failed', 'Failed'),
      error: t('mobileTests.run.error', 'Could not run'),
    })[status];

  return (
    <Dialog open={test !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('mobileTests.run.title', 'Run {{name}}', { name: test?.name ?? '' })}</DialogTitle>
          <DialogDescription>
            {t('mobileTests.run.description', '{{device}} on the grid you choose. Finding the device and installing the app takes a minute or two.', {
              device: [test?.deviceName, test?.osVersion].filter(Boolean).join(' '),
            })}
          </DialogDescription>
        </DialogHeader>

        {!runId && (
          grids.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('mobileTests.run.noGrid', 'No BrowserStack or LambdaTest grid yet: add one in Settings → Browser grids.')}
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="mobileRunGrid">{t('mobileTests.run.grid', 'Grid')}</Label>
                <Select value={gridId} onValueChange={setGridId}>
                  <SelectTrigger id="mobileRunGrid" className="mt-1" aria-label={t('mobileTests.run.grid', 'Grid')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {grids.map((grid) => (
                      <SelectItem key={grid.id} value={grid.id}>
                        {grid.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="mobileRunEnvironment">{t('mobileTests.run.environment', 'Environment')}</Label>
                <Select value={environmentId} onValueChange={setEnvironmentId}>
                  <SelectTrigger id="mobileRunEnvironment" className="mt-1" aria-label={t('mobileTests.run.environment', 'Environment')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ENVIRONMENT}>{t('mobileTests.run.noEnvironment', 'None')}</SelectItem>
                    {environments.map((environment) => (
                      <SelectItem key={environment.id} value={String(environment.id)}>
                        {environment.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )
        )}

        {runId && (
          <div className="space-y-3" data-testid="mobile-run">
            <div className="flex items-center gap-2">
              {!run || !FINISHED.includes(run.status) ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <Badge variant={run?.status === 'passed' ? 'default' : run?.status === 'failed' || run?.status === 'error' ? 'destructive' : 'secondary'}>
                {statusLabel(run?.status ?? 'queued')}
              </Badge>
              {run?.sessionUrl && (
                <a href={run.sessionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline">
                  {t('mobileTests.run.session', 'Video and logs on the grid')} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <ol className="space-y-1 text-sm">
              {(run?.steps ?? []).map((step) => (
                <li key={step.index} className="flex items-start gap-2">
                  {step.status === 'passed' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" aria-label={t('mobileTests.run.passed', 'Passed')} />
                  ) : step.status === 'failed' ? (
                    <XCircle className="mt-0.5 h-4 w-4 text-destructive" aria-label={t('mobileTests.run.failed', 'Failed')} />
                  ) : (
                    <CircleDashed className="mt-0.5 h-4 w-4 text-muted-foreground" aria-label={t('mobileTests.run.skipped', 'Skipped')} />
                  )}
                  <span>
                    {step.index + 1}. {step.action}
                    {step.target ? <code className="ml-1 text-xs">{step.target}</code> : null}
                    {step.detail ? <span className="ml-1 text-muted-foreground">{step.detail}</span> : null}
                    {step.error ? <span className="block text-destructive">{step.error}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
            {run?.status === 'error' && run.error && (
              <p className="text-sm text-destructive" role="alert">
                {run.error}
              </p>
            )}
            {run?.screenshot && (
              <img src={`data:image/png;base64,${run.screenshot}`} alt={t('mobileTests.run.screenshot', 'The device at the end of the run')} className="max-h-96 rounded border" />
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('mobileTests.close', 'Close')}
          </Button>
          {(!runId || (run && FINISHED.includes(run.status))) && grids.length > 0 && (
            <Button onClick={start} disabled={starting || !gridId}>
              {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {runId ? t('mobileTests.run.again', 'Run again') : t('mobileTests.run.start', 'Run')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

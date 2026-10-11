import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueries, type Query } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  artifactStorageStatus?: 'quota_exceeded' | 'error' | null;
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
  const [runIds, setRunIds] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gridChoices = JSON.stringify(grids.map(({ id }) => id));
  useEffect(() => {
    // The grid it runs on in plans, when it names one that is still there.
    setGridId(grids.find((grid) => grid.id === test?.gridId)?.id ?? grids[0]?.id ?? '');
    setEnvironmentId(NO_ENVIRONMENT);
    setRunId(null);
    setRunIds([]);
    setError(null);
    // Reset for another test or another set of grids, not for a refetch that returns the same grids
    // as a new array: that would clear what the person was choosing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test?.id, gridChoices]);

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
    refetchInterval: (query) =>
      query.state.data && FINISHED.includes(query.state.data.status) ? false : 2000,
  });

  useEffect(() => {
    if (!runIds.length && run && FINISHED.includes(run.status)) onFinished();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  const matrixResults = useQueries({
    queries: runIds.map((id) => ({
      queryKey: ['mobileRun', id],
      queryFn: async (): Promise<Run> => {
        const response = await fetch(`/api/mobile-test-runs/${id}`);
        if (!response.ok) throw new Error('run');
        return response.json();
      },
      refetchInterval: (query: Query<Run>) =>
        query.state.data && FINISHED.includes(query.state.data.status) ? false : 2000,
    })),
  });
  const matrixFinished =
    runIds.length > 0 &&
    matrixResults.every((result) => result.data && FINISHED.includes(result.data.status));
  useEffect(() => {
    if (matrixFinished) onFinished();
    // Once, when the matrix finishes: onFinished is a new function at every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrixFinished]);
  const start = async (matrix = false) => {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/mobile-tests/${test!.id}/${matrix ? 'matrix-runs' : 'runs'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gridId,
            environmentId: environmentId === NO_ENVIRONMENT ? null : Number(environmentId),
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error || t('mobileTests.run.startFailed', 'The run did not start.'));
      setRunIds(matrix ? body.runs.map((row: Run) => row.id) : []);
      setRunId(matrix ? body.runs[0]?.id : body.id);
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
          <DialogTitle>
            {t('mobileTests.run.title', 'Run {{name}}', { name: test?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'mobileTests.run.description',
              '{{device}} on the grid you choose. Finding the device and installing the app takes a minute or two.',
              {
                device: [test?.deviceName, test?.osVersion].filter(Boolean).join(' '),
              },
            )}
          </DialogDescription>
        </DialogHeader>

        {!runId &&
          (grids.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'mobileTests.run.noGrid',
                'No BrowserStack or LambdaTest grid yet: add one in Settings → Browser grids.',
              )}
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="mobileRunGrid">{t('mobileTests.run.grid', 'Grid')}</Label>
                <Select value={gridId} onValueChange={setGridId}>
                  <SelectTrigger
                    id="mobileRunGrid"
                    className="mt-1"
                    aria-label={t('mobileTests.run.grid', 'Grid')}
                  >
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
                <Label htmlFor="mobileRunEnvironment">
                  {t('mobileTests.run.environment', 'Environment')}
                </Label>
                <Select value={environmentId} onValueChange={setEnvironmentId}>
                  <SelectTrigger
                    id="mobileRunEnvironment"
                    className="mt-1"
                    aria-label={t('mobileTests.run.environment', 'Environment')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ENVIRONMENT}>
                      {t('mobileTests.run.noEnvironment', 'None')}
                    </SelectItem>
                    {environments.map((environment) => (
                      <SelectItem key={environment.id} value={String(environment.id)}>
                        {environment.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}

        {runIds.length > 0 && (
          <div className="space-y-2" data-testid="mobile-matrix-results">
            {matrixResults.map((result, index) => (
              <Button
                key={runIds[index]}
                variant={runId === runIds[index] ? 'secondary' : 'outline'}
                className="w-full justify-between"
                onClick={() => setRunId(runIds[index])}
              >
                <span>{result.data?.device ?? test?.deviceMatrix?.[index]?.deviceName}</span>
                <span>
                  {result.error
                    ? t('mobileTests.run.loadFailed', 'Could not load run')
                    : result.data
                      ? statusLabel(result.data.status)
                      : t('mobileTests.run.queued', 'Waiting for a device…')}
                </span>
              </Button>
            ))}
          </div>
        )}
        {runId && (
          <div className="space-y-3" data-testid="mobile-run">
            <div className="flex items-center gap-2">
              {!run || !FINISHED.includes(run.status) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              <Badge
                variant={
                  run?.status === 'passed'
                    ? 'default'
                    : run?.status === 'failed' || run?.status === 'error'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {statusLabel(run?.status ?? 'queued')}
              </Badge>
              {run?.sessionUrl && (
                <a
                  href={run.sessionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm underline"
                >
                  {t('mobileTests.run.session', 'Video and logs on the grid')}{' '}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <ol className="space-y-1 text-sm">
              {(run?.steps ?? []).map((step, visit) => (
                <li key={visit} className="flex items-start gap-2">
                  {step.status === 'passed' ? (
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 text-green-600"
                      aria-label={t('mobileTests.run.passed', 'Passed')}
                    />
                  ) : step.status === 'failed' ? (
                    <XCircle
                      className="mt-0.5 h-4 w-4 text-destructive"
                      aria-label={t('mobileTests.run.failed', 'Failed')}
                    />
                  ) : (
                    <CircleDashed
                      className="mt-0.5 h-4 w-4 text-muted-foreground"
                      aria-label={t('mobileTests.run.skipped', 'Skipped')}
                    />
                  )}
                  <span>
                    {step.index + 1}. {step.groupName ? `${step.groupName} › ` : ''}
                    {step.action}
                    {step.iterationKey ? ` (${step.iterationKey})` : ''}
                    {step.target ? <code className="ml-1 text-xs">{step.target}</code> : null}
                    {step.detail ? (
                      <span className="ml-1 text-muted-foreground">{step.detail}</span>
                    ) : null}
                    {step.error ? (
                      <span className="block text-destructive">{step.error}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
            {run?.status === 'error' && run.error && (
              <p className="text-sm text-destructive" role="alert">
                {run.error}
              </p>
            )}
            {run?.artifactStorageStatus && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {t(
                  run.artifactStorageStatus === 'quota_exceeded'
                    ? 'quota.evidenceQuota'
                    : 'quota.evidenceError',
                )}
              </p>
            )}
            {run?.screenshot && (
              <img
                src={`data:image/png;base64,${run.screenshot}`}
                alt={t('mobileTests.run.screenshot', 'The device at the end of the run')}
                className="max-h-96 rounded border"
              />
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
            <Button
              onClick={() => start()}
              disabled={starting || !gridId || (runIds.length > 0 && !matrixFinished)}
            >
              {starting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {runId ? t('mobileTests.run.again', 'Run again') : t('mobileTests.run.start', 'Run')}
            </Button>
          )}
          {(test?.deviceMatrix?.length ?? 0) > 0 && grids.length > 0 && (
            <Button
              variant="outline"
              onClick={() => start(true)}
              disabled={starting || !gridId || (runIds.length > 0 && !matrixFinished)}
            >
              {t('mobileTests.flow.runMatrix', 'Run device matrix')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

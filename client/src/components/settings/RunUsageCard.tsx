import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { apiRequest } from '@/lib/queryClient';

export interface RunUsage {
  running: number;
  queued: number;
  maxConcurrentRuns: number;
  maxQueuedRuns: number;
  /** Runners taking work across the installation. Zero: every run waits. */
  runnersOnline?: number;
}

/**
 * The organization's runs against its limits.
 *
 * A run that sits "queued" while nothing seems to happen looks like a broken system. Usually it
 * is the limit on runs at once doing its job; this is where a team can see that, and see how
 * close it is to the limit on runs waiting, past which new runs are refused.
 */
export default function RunUsageCard() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery<RunUsage>({
    queryKey: ['organizationUsage'],
    queryFn: async () => (await apiRequest('GET', '/api/organization/usage')).json(),
    refetchInterval: 10_000,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t('runUsage.loading', 'Loading…')}</p>;
  if (isError || !data) return <p className="text-sm text-destructive">{t('runUsage.error', 'Usage could not be loaded.')}</p>;

  const row = (label: string, used: number, limit: number, hint: string, testId: string) => (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className={used >= limit ? 'text-amber-700 dark:text-amber-400 font-semibold' : 'text-muted-foreground'}>
          {used} / {limit}
        </span>
      </div>
      <Progress value={limit > 0 ? Math.min(100, (used / limit) * 100) : 0} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        {data.runnersOnline === 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="usage-no-runner">
            {t('runUsage.noRunner', 'No runner is online, so runs wait in the queue until one starts.')}
          </p>
        )}
        {row(
          t('runUsage.running', 'Running now'),
          data.running,
          data.maxConcurrentRuns,
          t('runUsage.runningHint', 'Runs past this limit wait in the queue and start as others finish.'),
          'usage-running',
        )}
        {row(
          t('runUsage.queued', 'Waiting in the queue'),
          data.queued,
          data.maxQueuedRuns,
          t('runUsage.queuedHint', 'At this limit, new runs are refused until some have started.'),
          'usage-queued',
        )}
        <p className="text-xs text-muted-foreground">
          {t('runUsage.operator', 'Limits are set by the administrator of this installation.')}
        </p>
      </CardContent>
    </Card>
  );
}

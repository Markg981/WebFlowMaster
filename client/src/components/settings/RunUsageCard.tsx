import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { apiRequest } from '@/lib/queryClient';
import type { QuotaMode, QuotaUsage } from '@shared/tenant-quotas';

export interface RunUsage extends Partial<QuotaUsage> {
  running: number;
  queued: number;
  maxConcurrentRuns: number;
  maxQueuedRuns: number;
  /** Runners taking work across the installation. Zero: every run waits. */
  runnersOnline?: number;
  mode?: QuotaMode;
  maxTests?: number;
  maxArtifactBytes?: number;
  maxMonthlyExecutionMinutes?: number;
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

  const row = (label: string, used: number, limit: number, hint: string, testId: string, format: (value: number) => string = String) => (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className={limit > 0 && used >= limit ? 'text-amber-700 dark:text-amber-400 font-semibold' : 'text-muted-foreground'}>
          {format(used)} / {limit > 0 ? format(limit) : t('quota.unlimited', 'Unlimited')}
        </span>
      </div>
      <Progress value={limit > 0 ? Math.min(100, (used / limit) * 100) : 0} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        {data.mode && <p data-testid="quota-mode" className="text-sm font-medium">
          {data.mode === 'off' ? t('quota.off', 'Quotas disabled') : data.mode === 'monitor' ? t('quota.monitor', 'Monitoring only') : t('quota.enforce', 'Limits enforced')}
        </p>}
        {data.runnersOnline === 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="usage-no-runner">
            {t('runUsage.noRunner', 'No runner is online, so runs wait in the queue until one starts.')}
          </p>
        )}
        {row(
          t('runUsage.running', 'Running now'),
          data.running,
          data.mode && data.mode !== 'enforce' ? 0 : data.maxConcurrentRuns,
          t('runUsage.runningHint', 'Runs past this limit wait in the queue and start as others finish.'),
          'usage-running',
        )}
        {row(
          t('runUsage.queued', 'Waiting in the queue'),
          data.queued,
          data.mode && data.mode !== 'enforce' ? 0 : data.maxQueuedRuns,
          t('runUsage.queuedHint', 'At this limit, new runs are refused until some have started.'),
          'usage-queued',
        )}
        {data.tests !== undefined && row(t('quota.tests', 'Saved tests'), data.tests, data.maxTests ?? 0,
          t('quota.testsHint', 'Includes saved UI, BDD, API and mobile tests.'), 'usage-tests')}
        {data.artifactBytes !== undefined && <div data-testid="usage-artifacts">
          {data.artifactsReconciledAt ? row(t('quota.artifacts', 'Retained artifact storage'), data.artifactBytes + (data.reservedArtifactBytes ?? 0), data.maxArtifactBytes ?? 0,
            t('quota.artifactsHint', 'Includes execution evidence, visual baselines and reserved storage.'), 'usage-artifact-bytes', value => `${(value / 1_048_576).toFixed(2)} MiB`)
            : <p className="text-sm">{t('quota.artifacts', 'Retained artifact storage')}: {t('quota.notMeasured', 'Not measured yet')}</p>}
        </div>}
        {data.executionMs !== undefined && row(t('quota.resources', 'Monthly execution minutes'), Math.round(data.executionMs / 6000) / 10, data.maxMonthlyExecutionMinutes ?? 0,
          t('quota.resourcesHint', 'UTC calendar month. Queued time is excluded; running executions may finish beyond the allowance.'), 'usage-resources')}
        {data.periodStart && data.periodEnd && <p className="text-xs text-muted-foreground">{data.periodStart.slice(0, 10)} – {data.periodEnd.slice(0, 10)} (UTC)</p>}
        <p className="text-xs text-muted-foreground">{t('quota.independent', 'Quotas work independently of payments. Unlimited local use is available through configuration.')}</p>
        <p className="text-xs text-muted-foreground">
          {t('runUsage.operator', 'Limits are set by the administrator of this installation.')}
        </p>
      </CardContent>
    </Card>
  );
}

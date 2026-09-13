import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { FileText, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusChip } from '@/components/ui/status-chip';

export interface RecentExecution {
  id: number | string;
  planName: string | null;
  status: string | null;
  startedAt: string | number | Date | null;
  duration: number | null;
}

interface QuickAccessReportsProps {
  data?: RecentExecution[];
  isLoading?: boolean;
}

/**
 * The last few runs, with a way into each one's report.
 *
 * This was a placeholder that said "Report data will be available soon." above 240px of
 * empty card — on the dashboard, where it took the space of something useful. The data it
 * needed was already arriving: `/api/analytics/dashboard` returns the five most recent
 * executions under `recent`, and the page fetched them and threw them away.
 */
const formatDuration = (ms: number | null) => {
  if (ms === null || ms === undefined || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const toDate = (value: RecentExecution['startedAt']): Date | null => {
  if (value === null || value === undefined) return null;
  // The aggregation returns seconds for some rows and an ISO string for others.
  const date = value instanceof Date ? value : new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const QuickAccessReports: React.FC<QuickAccessReportsProps> = ({ data, isLoading }) => {
  const { t } = useTranslation();
  const executions = data ?? [];

  return (
    <div className="flex flex-col rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">
          {t('dashboard.quickAccessReports.recentTestReports.title')}
        </h3>
        {executions.length > 0 && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/reports">{t('dashboard.testSchedulingsTable.viewAll.link')}</Link>
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex min-h-[180px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : executions.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t('dashboard.emptyReports.title')}
          description={t('dashboard.emptyReports.description')}
          className="min-h-[180px]"
        />
      ) : (
        <ul className="divide-y">
          {executions.map((execution) => {
            const startedAt = toDate(execution.startedAt);
            return (
              <li key={execution.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {execution.planName || t('dashboard.quickAccessReports.unnamedPlan')}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {startedAt ? format(startedAt, 'PPp') : '—'} · {formatDuration(execution.duration)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusChip status={execution.status ?? undefined} />
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/reports?search=${encodeURIComponent(execution.planName ?? '')}`}>
                      {t('dashboard.quickAccessReports.open')}
                    </Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default QuickAccessReports;

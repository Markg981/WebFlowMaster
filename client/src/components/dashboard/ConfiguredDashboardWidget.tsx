import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { apiRequest } from '@/lib/queryClient';
import type { DashboardWidget } from '@shared/dashboard-layout';
import KpiPanel from './KpiPanel';
import TestStatusPieChart from './TestStatusPieChart';
import TestTrendBarChart from './TestTrendBarChart';
import TestSchedulingsTable from './TestSchedulingsTable';
import QuickAccessReports from './QuickAccessReports';
import { Button } from '@/components/ui/button';

export default function ConfiguredDashboardWidget({ widget }: { widget: DashboardWidget }) {
  const { user } = useAuth(); const { t } = useTranslation();
  const query = useQuery({ queryKey: ['dashboardWidget', user?.organizationId, user?.id, widget.type, widget.config], enabled: !!user,
    queryFn: async () => (await apiRequest('POST', '/api/analytics/dashboard/widget', widget)).json(),
  });
  if (query.isError) return <div role="alert">{t('dashboards.widgetFailed', 'Could not load this widget.')} <Button variant="outline" onClick={() => query.refetch()}>{t('dashboardOverviewPage.retry', 'Retry')}</Button></div>;
  if (query.data?.unavailable) return <div role="status" className="rounded border p-4">{t('dashboards.projectUnavailable', 'Project unavailable. You do not have access to this widget’s project.')}</div>;
  const data = query.data;
  return <>
    {widget.title && <h2 className="mb-2 break-words font-semibold">{widget.title}</h2>}
    {widget.type === 'kpis' && <KpiPanel data={data?.kpis} isLoading={query.isLoading} />}
    {widget.type === 'status' && <TestStatusPieChart data={data?.distribution} isLoading={query.isLoading} />}
    {widget.type === 'trend' && <TestTrendBarChart data={data?.trend} isLoading={query.isLoading} />}
    {widget.type === 'reports' && <QuickAccessReports data={data?.recent} isLoading={query.isLoading} />}
    {widget.type === 'schedules' && <TestSchedulingsTable scoped data={(data?.schedules ?? []).map((s: Record<string, unknown>) => ({ ...s, nextRunAt: new Date(s.nextRunAt as string) }))} isLoading={query.isLoading} />}
  </>;
}

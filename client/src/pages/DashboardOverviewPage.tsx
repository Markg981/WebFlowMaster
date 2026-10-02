import { PageHeader } from '@/components/layout/PageHeader';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_DASHBOARD_LAYOUT, dashboardLayoutSchema, type DashboardLayout, type DashboardWidgetId } from '@shared/dashboard-layout';
import { useAuth } from '@/hooks/use-auth';
import { apiRequest } from '@/lib/queryClient';
import KpiPanel from '@/components/dashboard/KpiPanel';
import TestStatusPieChart from '@/components/dashboard/TestStatusPieChart';
import TestTrendBarChart from '@/components/dashboard/TestTrendBarChart';
import TestSchedulingsTable from '@/components/dashboard/TestSchedulingsTable';
import QuickAccessReports from '@/components/dashboard/QuickAccessReports';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DashboardOverviewPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const layoutKey = ['dashboardLayout', user?.organizationId, user?.id];
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const layoutQuery = useQuery({
    queryKey: layoutKey,
    enabled: !!user,
    queryFn: async () => dashboardLayoutSchema.parse(await (await apiRequest('GET', '/api/dashboard/layout')).json()),
  });
  const layout = layoutQuery.data ?? DEFAULT_DASHBOARD_LAYOUT;
  const saveLayout = useMutation({
    mutationFn: async (next: DashboardLayout | null) => dashboardLayoutSchema.parse(await (await (
      next ? apiRequest('PUT', '/api/dashboard/layout', next) : apiRequest('DELETE', '/api/dashboard/layout')
    )).json()),
    onSuccess: next => { queryClient.setQueryData(layoutKey, next); setDraft(null); },
  });
  const labels: Record<DashboardWidgetId, string> = {
    kpis: t('dashboardOverviewPage.customize.kpis', 'Key metrics'),
    status: t('dashboardOverviewPage.customize.status', 'Test status'),
    trend: t('dashboardOverviewPage.customize.trend', 'Test trend'),
    schedules: t('dashboardOverviewPage.customize.schedules', 'Schedules'),
    reports: t('dashboardOverviewPage.customize.reports', 'Recent reports'),
  };
  const moveWidget = (index: number, offset: number) => {
    if (!draft) return;
    const widgets = [...draft.widgets];
    [widgets[index], widgets[index + offset]] = [widgets[index + offset], widgets[index]];
    setDraft({ widgets });
  };

  const {
    data: analyticsData,
    isLoading: isLoadingAnalytics,
    isError: analyticsFailed,
    refetch: refetchAnalytics,
    isFetching: isRefetchingAnalytics,
  } = useQuery({
    queryKey: ['analyticsDashboard'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/analytics/dashboard');
      return res.json();
    },
  });

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };

  const itemVariants = {
    hidden: { y: 16, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { duration: 0.35, ease: 'easeOut' } },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="flex w-full flex-col gap-6 p-6 xl:p-8"
    >
      <motion.div variants={itemVariants}>
        <PageHeader
          title={t('dashboardOverviewPage.dashboardOverview.title')}
          description={t('dashboardOverviewPage.description')}
        />
        <Button className="mt-3" variant="outline" disabled={!layoutQuery.data || saveLayout.isPending} aria-expanded={!!draft} aria-controls="dashboard-customization" onClick={() => {
          saveLayout.reset();
          setDraft(draft ? null : { widgets: layout.widgets.map(widget => ({ ...widget })) });
        }}>{t('dashboardOverviewPage.customize.open', 'Customize dashboard')}</Button>
      </motion.div>

      {layoutQuery.isLoading && <p role="status">{t('dashboardOverviewPage.customize.loading', 'Loading your layout…')}</p>}
      {layoutQuery.isError && <div role="alert" className="flex items-center gap-3 text-destructive">
        <span>{t('dashboardOverviewPage.customize.loadFailed', 'Could not load your layout.')}</span>
        <Button variant="outline" disabled={layoutQuery.isFetching} onClick={() => layoutQuery.refetch()}>{t('dashboardOverviewPage.customize.retry', 'Retry')}</Button>
      </div>}
      {draft && <fieldset id="dashboard-customization" className="rounded-lg border p-4" disabled={saveLayout.isPending}>
        <legend className="px-2 font-semibold">{t('dashboardOverviewPage.customize.open', 'Customize dashboard')}</legend>
        <p className="mb-3 text-sm text-muted-foreground">{t('dashboardOverviewPage.customize.description', 'Choose which widgets to show and change their order. Changes apply only to your dashboard.')}</p>
        <ol className="space-y-2">
          {draft.widgets.map((widget, index) => <li key={widget.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={widget.visible} onChange={event => setDraft({ widgets: draft.widgets.map(w => w.id === widget.id ? { ...w, visible: event.target.checked } : w) })} />{labels[widget.id]}</label>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={index === 0} aria-label={`${t('dashboardOverviewPage.customize.move', 'Move')} ${labels[widget.id]} ${t('dashboardOverviewPage.customize.up', 'up')}`} onClick={() => moveWidget(index, -1)}>{t('dashboardOverviewPage.customize.up', 'up')}</Button>
              <Button size="sm" variant="outline" disabled={index === draft.widgets.length - 1} aria-label={`${t('dashboardOverviewPage.customize.move', 'Move')} ${labels[widget.id]} ${t('dashboardOverviewPage.customize.down', 'down')}`} onClick={() => moveWidget(index, 1)}>{t('dashboardOverviewPage.customize.down', 'down')}</Button>
            </div>
          </li>)}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => saveLayout.mutate(draft)}>{t('dashboardOverviewPage.customize.save', 'Save layout')}</Button>
          <Button variant="outline" onClick={() => saveLayout.mutate(null)}>{t('dashboardOverviewPage.customize.reset', 'Reset layout')}</Button>
          <Button variant="ghost" onClick={() => setDraft(null)}>{t('dashboardOverviewPage.customize.cancel', 'Cancel')}</Button>
        </div>
        {saveLayout.isPending && <p role="status">{t('dashboardOverviewPage.customize.saving', 'Saving your layout…')}</p>}
        {saveLayout.isError && <p role="alert" className="mt-3 text-destructive">{t('dashboardOverviewPage.customize.saveFailed', 'Could not save your layout. Try again.')}</p>}
      </fieldset>}

      {/* A failed query and an account with nothing in it used to render identically: the
          panels simply showed zeroes. That is how a dashboard wired to a route which did not
          exist looked like a quiet, working, empty one for as long as it did. */}
      {analyticsFailed && (
        <motion.div
          variants={itemVariants}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
          role="alert"
        >
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            <span>{t('dashboardOverviewPage.loadFailed')}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchAnalytics()}
            disabled={isRefetchingAnalytics}
          >
            {isRefetchingAnalytics && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('dashboardOverviewPage.retry')}
          </Button>
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-x-5 gap-y-6 lg:grid-cols-2 [&>*]:min-w-0">
        {layout.widgets.filter(widget => widget.visible).map(widget => <motion.div key={widget.id} variants={itemVariants} data-testid="dashboard-widget" data-widget-id={widget.id} className={widget.id === 'status' || widget.id === 'trend' ? '' : 'lg:col-span-2'}>
          {widget.id === 'kpis' && <KpiPanel data={analyticsData?.kpis} isLoading={isLoadingAnalytics} />}
          {widget.id === 'status' && <TestStatusPieChart data={analyticsData?.distribution} isLoading={isLoadingAnalytics} />}
          {widget.id === 'trend' && <TestTrendBarChart data={analyticsData?.trend} isLoading={isLoadingAnalytics} />}
          {widget.id === 'schedules' && <TestSchedulingsTable />}
          {widget.id === 'reports' && <QuickAccessReports data={analyticsData?.recent} isLoading={isLoadingAnalytics} />}
        </motion.div>)}
      </div>
    </motion.div>
  );
};

export default DashboardOverviewPage;

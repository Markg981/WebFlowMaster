import { PageHeader } from '@/components/layout/PageHeader';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import KpiPanel from '@/components/dashboard/KpiPanel';
import TestStatusPieChart from '@/components/dashboard/TestStatusPieChart';
import TestTrendBarChart from '@/components/dashboard/TestTrendBarChart';
import TestSchedulingsTable from '@/components/dashboard/TestSchedulingsTable';
import QuickAccessReports from '@/components/dashboard/QuickAccessReports';
import RunTestNowButton from '@/components/dashboard/RunTestNowButton';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DashboardOverviewPage: React.FC = () => {
  const { t } = useTranslation();

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
      </motion.div>

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

      <motion.div variants={itemVariants}>
        <KpiPanel data={analyticsData?.kpis} isLoading={isLoadingAnalytics} />
      </motion.div>

      <motion.div variants={itemVariants} className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TestStatusPieChart data={analyticsData?.distribution} isLoading={isLoadingAnalytics} />
        <TestTrendBarChart data={analyticsData?.trend} isLoading={isLoadingAnalytics} />
      </motion.div>

      <motion.div variants={itemVariants}>
        <TestSchedulingsTable />
      </motion.div>

      <motion.div variants={itemVariants}>
        {/* The five most recent executions arrive with the same query that feeds the charts;
            this panel used to be a placeholder while they were fetched and discarded. */}
        <QuickAccessReports data={analyticsData?.recent} isLoading={isLoadingAnalytics} />
      </motion.div>

      <motion.div variants={itemVariants}>
        <RunTestNowButton />
      </motion.div>
    </motion.div>
  );
};

export default DashboardOverviewPage;

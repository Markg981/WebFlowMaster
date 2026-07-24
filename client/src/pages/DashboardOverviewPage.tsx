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

const DashboardOverviewPage: React.FC = () => {
  const { t } = useTranslation();

  const { data: analyticsData, isLoading: isLoadingAnalytics } = useQuery({
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
      className="mx-auto flex max-w-[1400px] flex-col gap-6 p-6"
    >
      <motion.header variants={itemVariants}>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('dashboardOverviewPage.overview.eyebrow', 'Overview')}
        </div>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight">
          {t('dashboardOverviewPage.dashboardOverview.title')}
        </h1>
        <div className="tick-rule tick-rule--accent mt-3" />
      </motion.header>

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
        <QuickAccessReports />
      </motion.div>

      <motion.div variants={itemVariants}>
        <RunTestNowButton />
      </motion.div>
    </motion.div>
  );
};

export default DashboardOverviewPage;

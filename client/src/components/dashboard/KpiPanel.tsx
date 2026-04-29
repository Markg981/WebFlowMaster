import React from 'react';
import { useTranslation } from 'react-i18next';
import KpiCard from './KpiCard';
import { ListChecks, Percent, Clock, PlayCircle, Loader2 } from 'lucide-react';

interface KpiPanelProps {
  data?: {
    totalRuns: number;
    successRate: number;
    avgDuration: number;
    lastRun: any;
  };
  isLoading?: boolean;
}

const KpiPanel: React.FC<KpiPanelProps> = ({ data, isLoading }) => {
  const { t } = useTranslation();

  const formatDuration = (ms: number) => {
    if (!ms) return '0s';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const kpis = [
    {
      title: t('dashboard.kpiPanel.totalTests.title', 'Total Executions'),
      icon: <ListChecks size={20} />,
      value: isLoading ? <Loader2 className="animate-spin h-5 w-5" /> : (data?.totalRuns || 0).toString(),
    },
    {
      title: t('dashboard.kpiPanel.successRate.title', 'Success Rate'),
      icon: <Percent size={20} />,
      value: isLoading ? <Loader2 className="animate-spin h-5 w-5" /> : `${data?.successRate || 0}%`,
    },
    {
      title: t('dashboard.kpiPanel.avgDuration.title', 'Avg Duration'),
      icon: <Clock size={20} />,
      value: isLoading ? <Loader2 className="animate-spin h-5 w-5" /> : formatDuration(data?.avgDuration || 0),
    },
    {
      title: t('dashboard.kpiPanel.lastRun.title', 'Last Run Status'),
      icon: <PlayCircle size={20} />,
      value: isLoading ? <Loader2 className="animate-spin h-5 w-5" /> : (data?.lastRun?.status || 'N/A').toUpperCase(),
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {kpis.map((kpi, index) => (
        <KpiCard
          key={index}
          title={kpi.title}
          icon={kpi.icon}
          value={kpi.value as any}
        />
      ))}
    </div>
  );
};

export default KpiPanel;

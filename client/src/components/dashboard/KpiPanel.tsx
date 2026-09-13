import React from 'react';
import { useTranslation } from 'react-i18next';
import KpiCard from './KpiCard';
import { ListChecks, Percent, Clock, PlayCircle, Loader2 } from 'lucide-react';

interface KpiPanelProps {
  data?: {
    totalRuns: number;
    successRate: number;
    avgDuration: number;
    lastRun: { status?: string | null } | null;
  };
  isLoading?: boolean;
}

/** Nothing has run, so there is no figure — as distinct from a figure that happens to be 0. */
const NO_VALUE = '—';

const KpiPanel: React.FC<KpiPanelProps> = ({ data, isLoading }) => {
  const { t } = useTranslation();

  const formatDuration = (ms: number) => {
    if (!ms) return '0s';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const spinner = <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />;

  /**
   * With no executions at all, a success rate of "0%" is a lie that looks like a
   * measurement: it reads as "everything failed" when the truth is that nothing has run.
   * The same goes for an average duration of "0s". Only the count is honestly zero.
   */
  const hasRuns = (data?.totalRuns ?? 0) > 0;

  const kpis = [
    {
      title: t('dashboard.kpiPanel.successRate.title', 'Success Rate'),
      icon: <Percent size={18} />,
      value: isLoading ? spinner : hasRuns ? `${data?.successRate ?? 0}%` : NO_VALUE,
      hint: !isLoading && !hasRuns ? t('dashboard.kpiPanel.noRunsHint') : undefined,
      emphasis: true,
    },
    {
      title: t('dashboard.kpiPanel.totalTests.title', 'Total Executions'),
      icon: <ListChecks size={18} />,
      value: isLoading ? spinner : (data?.totalRuns ?? 0).toString(),
    },
    {
      title: t('dashboard.kpiPanel.avgDuration.title', 'Avg Duration'),
      icon: <Clock size={18} />,
      value: isLoading ? spinner : hasRuns ? formatDuration(data?.avgDuration || 0) : NO_VALUE,
    },
    {
      title: t('dashboard.kpiPanel.lastRun.title', 'Last Run Status'),
      icon: <PlayCircle size={18} />,
      value: isLoading
        ? spinner
        : data?.lastRun?.status
          ? data.lastRun.status.toUpperCase()
          : NO_VALUE,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi, index) => (
        <KpiCard
          key={index}
          title={kpi.title}
          icon={kpi.icon}
          value={kpi.value as any}
          hint={kpi.hint}
          emphasis={kpi.emphasis}
        />
      ))}
    </div>
  );
};

export default KpiPanel;

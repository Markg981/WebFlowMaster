import React from 'react';
import { useTranslation } from 'react-i18next';
// Removed useQuery import
import KpiCard from './KpiCard';
import { ListChecks, Percent, Clock, PlayCircle } from 'lucide-react'; // Removed AlertCircle, Loader2

// Mock API functions (REMOVED)
// const fetchTotalTests = async () => { ... };
// const fetchSuccessPercentage = async () => { ... };
// const fetchAverageTestDuration = async () => { ... };
// const fetchLastRunInfo = async () => { ... };

const KpiPanel: React.FC = () => {
  const { t } = useTranslation();
  // useQuery hooks (REMOVED)
  // const { data: totalTestsData, ... } = useQuery(...);
  // const { data: successPercentageData, ... } = useQuery(...);
  // const { data: avgDurationData, ... } = useQuery(...);
  // const { data: lastRunData, ... } = useQuery(...);

  const placeholderValue = t('apiTesterPage.text1'); // Placeholder for KPI values

  const kpis = [
    {
      title: t('dashboard.kpiPanel.totalTests.title'),
      // data, isLoading, isError, error properties removed
      icon: <ListChecks size={20} />,
      value: placeholderValue, // Directly pass placeholder
    },
    {
      title: t('dashboard.kpiPanel.successRate.title'),
      icon: <Percent size={20} />,
      value: placeholderValue,
    },
    {
      title: t('dashboard.kpiPanel.avgDuration.title'),
      icon: <Clock size={20} />,
      value: placeholderValue,
    },
    {
      title: t('dashboard.kpiPanel.lastRun.title'),
      icon: <PlayCircle size={20} />,
      value: placeholderValue, // Simplified, status part removed
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {kpis.map((kpi, index) => (
        <KpiCard
          key={index}
          title={kpi.title} // This is now a t() call result
          icon={kpi.icon}
          value={kpi.value} // This is also a t() call result
        />
      ))}
    </div>
  );
};

export default KpiPanel;

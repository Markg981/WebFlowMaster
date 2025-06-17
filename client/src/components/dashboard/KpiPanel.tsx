import React from 'react';
// Removed useQuery import
import KpiCard from './KpiCard';
import { ListChecks, Percent, Clock, PlayCircle } from 'lucide-react'; // Removed AlertCircle, Loader2

// Mock API functions (REMOVED)
// const fetchTotalTests = async () => { ... };
// const fetchSuccessPercentage = async () => { ... };
// const fetchAverageTestDuration = async () => { ... };
// const fetchLastRunInfo = async () => { ... };

const KpiPanel: React.FC = () => {
  // useQuery hooks (REMOVED)
  // const { data: totalTestsData, ... } = useQuery(...);
  // const { data: successPercentageData, ... } = useQuery(...);
  // const { data: avgDurationData, ... } = useQuery(...);
  // const { data: lastRunData, ... } = useQuery(...);

  const placeholderValue = "---"; // Placeholder for KPI values

  const kpis = [
    {
      title: 'Total Tests',
      // data, isLoading, isError, error properties removed
      icon: <ListChecks size={20} />,
      value: placeholderValue, // Directly pass placeholder
    },
    {
      title: 'Success Rate',
      icon: <Percent size={20} />,
      value: placeholderValue,
    },
    {
      title: 'Avg. Duration',
      icon: <Clock size={20} />,
      value: placeholderValue,
    },
    {
      title: 'Last Run',
      icon: <PlayCircle size={20} />,
      value: placeholderValue, // Simplified, status part removed
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {kpis.map((kpi, index) => (
        <KpiCard
          key={index}
          title={kpi.title}
          icon={kpi.icon}
          value={kpi.value} // Directly pass the value
        />
      ))}
    </div>
  );
};

export default KpiPanel;

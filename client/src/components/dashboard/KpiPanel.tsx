import React from 'react';
import { useQuery } from '@tanstack/react-query';
import KpiCard from './KpiCard';
import { ListChecks, Percent, Clock, PlayCircle, AlertCircle, Loader2 } from 'lucide-react';

// Mock API functions
const fetchTotalTests = async () => {
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
  // To simulate an error, uncomment the next line:
  // if (Math.random() > 0.7) throw new Error('Failed to fetch total tests');
  return { count: 1250 };
};

const fetchSuccessPercentage = async () => {
  await new Promise(resolve => setTimeout(resolve, 700));
  return { percentage: 92.5 };
};

const fetchAverageTestDuration = async () => {
  await new Promise(resolve => setTimeout(resolve, 600));
  return { duration: '1m 32s' };
};

const fetchLastRunInfo = async () => {
  await new Promise(resolve => setTimeout(resolve, 800));
  // Simulate potential failure for last run
  // if (Math.random() > 0.8) return { lastRun: 'Today, 10:45 AM', status: 'failure' as 'success' | 'failure' };
  return { lastRun: 'Today, 10:45 AM', status: 'success' as 'success' | 'failure' };
};

const KpiPanel: React.FC = () => {
  const { data: totalTestsData, isLoading: isLoadingTotalTests, isError: isErrorTotalTests, error: errorTotalTests } = useQuery({ queryKey: ['totalTests'], queryFn: fetchTotalTests });
  const { data: successPercentageData, isLoading: isLoadingSuccessPercentage, isError: isErrorSuccessPercentage, error: errorSuccessPercentage } = useQuery({ queryKey: ['successPercentage'], queryFn: fetchSuccessPercentage });
  const { data: avgDurationData, isLoading: isLoadingAvgDuration, isError: isErrorAvgDuration, error: errorAvgDuration } = useQuery({ queryKey: ['avgTestDuration'], queryFn: fetchAverageTestDuration });
  const { data: lastRunData, isLoading: isLoadingLastRun, isError: isErrorLastRun, error: errorLastRun } = useQuery({ queryKey: ['lastRunInfo'], queryFn: fetchLastRunInfo });

  const kpis = [
    {
      title: 'Total Tests',
      data: totalTestsData?.count,
      isLoading: isLoadingTotalTests,
      isError: isErrorTotalTests,
      error: errorTotalTests,
      icon: <ListChecks size={20} />,
      valueFormatter: (val: number | undefined) => val?.toLocaleString() ?? 'N/A',
    },
    {
      title: 'Success Rate',
      data: successPercentageData?.percentage,
      isLoading: isLoadingSuccessPercentage,
      isError: isErrorSuccessPercentage,
      error: errorSuccessPercentage,
      icon: <Percent size={20} />,
      valueFormatter: (val: number | undefined) => (val !== undefined ? `${val.toFixed(1)}%` : 'N/A'),
    },
    {
      title: 'Avg. Duration',
      data: avgDurationData?.duration,
      isLoading: isLoadingAvgDuration,
      isError: isErrorAvgDuration,
      error: errorAvgDuration,
      icon: <Clock size={20} />,
      valueFormatter: (val: string | undefined) => val ?? 'N/A',
    },
    {
      title: 'Last Run',
      isLoading: isLoadingLastRun,
      isError: isErrorLastRun,
      error: errorLastRun,
      icon: <PlayCircle size={20} />,
      valueFormatter: () => {
        if (!lastRunData) return 'N/A';
        let statusText = '';
        if (lastRunData.status === 'success') statusText = ' (Success)';
        else if (lastRunData.status === 'failure') statusText = ' (Failed)';
        return `${lastRunData.lastRun}${statusText}`;
      },
      // Special data field for this KPI as it combines two pieces of info
      data: lastRunData,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {kpis.map((kpi, index) => (
        <KpiCard
          key={index}
          title={kpi.title}
          icon={kpi.icon}
          value={
            kpi.isLoading ? <div className="flex justify-center items-center h-8"><Loader2 className="animate-spin h-7 w-7" /></div> :
            kpi.isError ? <div className="flex justify-center items-center h-8" title={(kpi.error as Error)?.message || 'Error'}><AlertCircle className="text-destructive h-7 w-7" /></div> :
            kpi.valueFormatter(kpi.data as any) // Type assertion used due to varied data types
          }
        />
      ))}
    </div>
  );
};

export default KpiPanel;

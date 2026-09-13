import React from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Loader2, TrendingUp } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';

interface TestTrendBarChartProps {
  data?: Array<{ date: string; passed: number; failed: number; total: number }>;
  isLoading?: boolean;
}

const TestTrendBarChart: React.FC<TestTrendBarChartProps> = ({ data, isLoading }) => {
  const { t } = useTranslation();

  // The aggregation fills in every one of the last 30 days, so a non-empty array does not
  // mean anything ran. What matters is whether any day carries a run — otherwise the chart
  // drew thirty empty columns and called it a trend.
  const hasRuns = (data ?? []).some((day) => day.passed > 0 || day.failed > 0);

  return (
    <div className="bg-card text-card-foreground p-4 rounded-lg border shadow-sm h-80 w-full flex flex-col">
      <h3 className="mb-4 text-base font-semibold">{t('dashboard.testTrendBarChart.weeklyTestTrends.title', '30-Day Execution Trends')}</h3>
      <div className="flex-1 w-full h-full min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin h-8 w-8 text-muted-foreground" />
          </div>
        ) : !hasRuns ? (
          /* No action here on purpose: the status chart beside it already offers the only
             useful one, and the same button twice on one screen reads as a template. */
          <EmptyState
            compact
            icon={TrendingUp}
            title={t('dashboard.emptyTrend.title')}
            description={t('dashboard.emptyTrend.description')}
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(val) => val.substring(5)} stroke="hsl(var(--border))" />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} stroke="hsl(var(--border))" />
              <Tooltip
                contentStyle={{ borderRadius: '10px', backgroundColor: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', border: '1px solid hsl(var(--border))', boxShadow: 'var(--shadow-md)', fontSize: '12px' }}
                itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
                cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="passed" name={t('dashboard.executionStatus.passed')} stackId="a" fill="hsl(var(--success))" radius={[0, 0, 4, 4]} />
              <Bar dataKey="failed" name={t('dashboard.executionStatus.failed')} stackId="a" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default TestTrendBarChart;

import React from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Loader2 } from 'lucide-react';

interface TestTrendBarChartProps {
  data?: Array<{ date: string; passed: number; failed: number; total: number }>;
  isLoading?: boolean;
}

const TestTrendBarChart: React.FC<TestTrendBarChartProps> = ({ data, isLoading }) => {
  const { t } = useTranslation();

  return (
    <div className="bg-card text-card-foreground p-4 rounded-lg border shadow-sm h-80 w-full flex flex-col">
      <h3 className="text-lg font-semibold mb-4 text-center">{t('dashboard.testTrendBarChart.weeklyTestTrends.title', '30-Day Execution Trends')}</h3>
      <div className="flex-1 w-full h-full min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin h-8 w-8 text-muted-foreground" />
          </div>
        ) : !data || data.length === 0 ? (
          <div className="flex items-center justify-center h-full">
             <p className="text-muted-foreground text-center">No trend data available.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(val) => val.substring(5)} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', backgroundColor: 'var(--card)', color: 'var(--card-foreground)' }} 
                cursor={{ fill: 'var(--muted)' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="passed" name="Passed" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
              <Bar dataKey="failed" name="Failed" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default TestTrendBarChart;

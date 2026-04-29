import React from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Loader2 } from 'lucide-react';

interface TestStatusPieChartProps {
  data?: Array<{ name: string; value: number; fill: string }>;
  isLoading?: boolean;
}

const TestStatusPieChart: React.FC<TestStatusPieChartProps> = ({ data, isLoading }) => {
  const { t } = useTranslation();

  return (
    <div className="bg-card text-card-foreground p-4 rounded-lg border shadow-sm h-80 w-full flex flex-col">
      <h3 className="text-lg font-semibold mb-4 text-center">{t('dashboard.testStatusPieChart.testStatusOverview.title', 'Execution Status Breakdown')}</h3>
      <div className="flex-1 w-full h-full min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin h-8 w-8 text-muted-foreground" />
          </div>
        ) : !data || data.every(d => d.value === 0) ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-center">No test executions found.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.filter(d => d.value > 0)}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
                stroke="none"
              >
                {data.filter(d => d.value > 0).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ borderRadius: '8px', backgroundColor: 'var(--card)', color: 'var(--card-foreground)', border: '1px solid var(--border)' }} 
                itemStyle={{ color: 'var(--foreground)' }}
              />
              <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default TestStatusPieChart;

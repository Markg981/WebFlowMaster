import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Loader2, AlertCircle } from 'lucide-react';

// Mock API function
const fetchTestStatusSummary = async () => {
  await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay
  // To simulate an error: if (Math.random() > 0.8) throw new Error('Failed to fetch test status summary');
  return { passed: 300, failed: 50, running: 10, skipped: 5 };
};

const COLORS = { passed: '#4CAF50', failed: '#F44336', running: '#2196F3', skipped: '#FFC107' };
const STATUS_DISPLAY_NAMES = { passed: 'Passed', failed: 'Failed', running: 'In Execution', skipped: 'Skipped' }; // For better legend/tooltip names
type TestStatus = keyof typeof COLORS; // 'passed' | 'failed' | 'running' | 'skipped'

const TestStatusPieChart: React.FC = () => {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['testStatusSummary'], queryFn: fetchTestStatusSummary });

  if (isLoading) return <div className="flex items-center justify-center h-80 w-full bg-card text-card-foreground p-4 rounded-lg shadow"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;
  if (isError || !data) return (
    <div className="flex flex-col items-center justify-center h-80 w-full bg-card text-card-foreground p-4 rounded-lg shadow text-destructive">
      <AlertCircle className="h-8 w-8 mb-2" />
      <p>Error loading chart data.</p>
      {error && <p className="text-xs mt-1">{(error as Error).message}</p>}
    </div>
  );

  const chartData = (Object.keys(data) as TestStatus[]).map((key) => ({
    name: STATUS_DISPLAY_NAMES[key] || key.charAt(0).toUpperCase() + key.slice(1),
    value: data[key],
  })).filter(item => item.value > 0); // Filter out zero values for cleaner chart

  if (chartData.length === 0) {
    return (
        <div className="flex flex-col items-center justify-center h-80 w-full bg-card text-card-foreground p-4 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Test Status Overview</h3>
            <p>No data available to display.</p>
        </div>
    );
  }

  return (
    <div className="bg-card text-card-foreground p-4 rounded-lg shadow h-80 w-full">
      <h3 className="text-lg font-semibold mb-2 text-center">Test Status Overview</h3>
      <ResponsiveContainer width="100%" height="90%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            labelLine={false}
            outerRadius="80%" // Make pie larger relative to container
            fill="#8884d8"
            dataKey="value"
            label={({ name, percent, value }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[entry.name.toLowerCase().replace('in execution', 'running') as TestStatus]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [`${value} tests`, name]}
            contentStyle={{
              backgroundColor: 'hsl(var(--card))', // Use card background for tooltip
              borderColor: 'hsl(var(--border))',
              color: 'hsl(var(--card-foreground))', // Use card foreground for tooltip text
            }}
            cursor={{ fill: 'hsl(var(--muted) / 0.5)' }} // Muted fill for cursor
          />
          <Legend
            wrapperStyle={{ bottom: 0, left: '50%', transform: 'translateX(-50%)', fontSize: '12px' }}
            formatter={(value) => <span className="text-muted-foreground dark:text-gray-400">{value}</span>} // Style legend text
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TestStatusPieChart;

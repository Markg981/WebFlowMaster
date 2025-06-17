import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Loader2, AlertCircle } from 'lucide-react';

// Mock API function
const fetchTestTrends = async () => {
  await new Promise(resolve => setTimeout(resolve, 1200)); // Simulate network delay
  // To simulate an error: if (Math.random() > 0.8) throw new Error('Failed to fetch test trends');
  return [
    { date: 'Mon', passed: 60, failed: 8, running: 3 },
    { date: 'Tue', passed: 55, failed: 5, running: 2 },
    { date: 'Wed', passed: 70, failed: 2, running: 0 },
    { date: 'Thu', passed: 65, failed: 6, running: 5 },
    { date: 'Fri', passed: 75, failed: 3, running: 1 },
    { date: 'Sat', passed: 80, failed: 1, running: 0 },
    { date: 'Sun', passed: 72, failed: 4, running: 2 },
  ];
};

const TestTrendBarChart: React.FC = () => {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['testTrends'], queryFn: fetchTestTrends });

  if (isLoading) return <div className="flex items-center justify-center h-80 w-full bg-card text-card-foreground p-4 rounded-lg shadow"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;
  if (isError || !data) return (
    <div className="flex flex-col items-center justify-center h-80 w-full bg-card text-card-foreground p-4 rounded-lg shadow text-destructive">
      <AlertCircle className="h-8 w-8 mb-2" />
      <p>Error loading chart data.</p>
      {error && <p className="text-xs mt-1">{(error as Error).message}</p>}
    </div>
  );

  if (data.length === 0) {
    return (
        <div className="flex flex-col items-center justify-center h-80 w-full bg-card text-card-foreground p-4 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4 text-center">Weekly Test Trends</h3>
            <p>No data available to display.</p>
        </div>
    );
  }

  return (
    <div className="bg-card text-card-foreground p-4 rounded-lg shadow h-80 w-full">
      <h3 className="text-lg font-semibold mb-2 text-center">Weekly Test Trends</h3>
      <ResponsiveContainer width="100%" height="90%">
        <BarChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} /> {/* Themed grid lines */}
          <XAxis dataKey="date" fontSize={12} tick={{ fill: 'hsl(var(--muted-foreground))' }} tickLine={{ stroke: 'hsl(var(--muted-foreground))' }} />
          <YAxis fontSize={12} tick={{ fill: 'hsl(var(--muted-foreground))' }} tickLine={{ stroke: 'hsl(var(--muted-foreground))' }} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))', // Use card background
              borderColor: 'hsl(var(--border))',
              color: 'hsl(var(--card-foreground))', // Use card foreground for text
            }}
            labelStyle={{ color: 'hsl(var(--foreground))' }} // Already themed, but ensure consistency
            cursor={{ fill: 'hsl(var(--muted) / 0.5)' }} // Muted fill for cursor
          />
          <Legend
            wrapperStyle={{ bottom: -5, left: '50%', transform: 'translateX(-50%)', fontSize: '12px' }}
            formatter={(value) => <span className="text-muted-foreground dark:text-gray-400">{value}</span>} // Style legend text
          />
          <Bar dataKey="passed" fill="#4CAF50" name="Passed" stackId="a" />
          <Bar dataKey="failed" fill="#F44336" name="Failed" stackId="a" />
          <Bar dataKey="running" fill="#2196F3" name="In Execution" stackId="a" /> {/* #2196F3 is a standard blue, should be fine */}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TestTrendBarChart;

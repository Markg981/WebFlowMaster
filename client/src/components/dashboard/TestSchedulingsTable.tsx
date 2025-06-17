import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, CalendarDays, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { Badge, BadgeProps } from '@/components/ui/badge'; // Import Badge and BadgeProps

interface ScheduledTest {
  id: string;
  dateTime: string;
  testSuite: string;
  status: 'Scheduled' | 'Completed' | 'Failed' | 'In Progress' | 'Cancelled';
  environment: string;
  triggeredBy?: string;
}

// Mock API function
const fetchTestSchedulings = async (): Promise<ScheduledTest[]> => {
  await new Promise(resolve => setTimeout(resolve, 900));
  // if (Math.random() > 0.8) throw new Error('Failed to fetch test schedulings');
  return [
    { id: 'sched1', dateTime: '2023-11-20 10:00', testSuite: 'Login & Signup Suite', status: 'Completed', environment: 'Production', triggeredBy: 'NightlyJob' },
    { id: 'sched2', dateTime: '2023-11-20 14:00', testSuite: 'Payment Gateway Tests', status: 'Failed', environment: 'Staging', triggeredBy: 'Jane Doe' },
    { id: 'sched3', dateTime: '2023-11-21 09:00', testSuite: 'User Profile Features', status: 'Scheduled', environment: 'Production', triggeredBy: 'AutoScheduler' },
    { id: 'sched4', dateTime: '2023-11-21 11:00', testSuite: 'API Performance Tests', status: 'In Progress', environment: 'QA Env', triggeredBy: 'CI Pipeline' },
    { id: 'sched5', dateTime: '2023-11-22 15:30', testSuite: 'Data Migration Checks', status: 'Scheduled', environment: 'Development', triggeredBy: 'John Smith' },
    { id: 'sched6', dateTime: '2023-11-19 18:00', testSuite: 'Full Regression Cycle', status: 'Completed', environment: 'Production', triggeredBy: 'NightlyJob' },
    { id: 'sched7', dateTime: '2023-11-21 16:00', testSuite: 'Mobile App Sync Test', status: 'Cancelled', environment: 'Staging', triggeredBy: 'Jane Doe' },
  ].sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime()); // Sort by date descending
};

// Helper to get variant and className for Badge
const getStatusBadgeStyle = (status: ScheduledTest['status']): { variant: BadgeProps['variant'], className?: string } => {
  switch (status) {
    case 'Completed':
      // Ensured text-white for light/dark, specific bg for dark if needed, border for consistency
      return { variant: 'default', className: 'bg-green-600 hover:bg-green-600/80 text-white border-transparent dark:bg-green-700 dark:hover:bg-green-700/80' };
    case 'Failed':
      // Destructive variant should handle dark mode well by default via component's CVA
      return { variant: 'destructive' };
    case 'Scheduled':
      return { variant: 'outline', className: 'border-blue-500 text-blue-500 dark:border-blue-400 dark:text-blue-400' };
    case 'In Progress':
      return { variant: 'outline', className: 'border-yellow-500 text-yellow-500 dark:border-yellow-400 dark:text-yellow-400' };
    case 'Cancelled':
      // Secondary variant might need specific dark mode styling if its default is not optimal
      return { variant: 'secondary', className: 'dark:bg-gray-600 dark:text-gray-300 dark:hover:bg-gray-600/80 dark:border-gray-500' };
    default:
      return { variant: 'default' }; // Default variant should also be checked for dark mode
  }
};

const getStatusIcon = (status: ScheduledTest['status']) => {
  const iconProps = { size: 14, className: 'mr-1.5' }; // Adjusted size and margin
  switch (status) {
    case 'Completed': return <CheckCircle {...iconProps} />;
    case 'Failed': return <XCircle {...iconProps} />;
    case 'Scheduled': return <CalendarDays {...iconProps} />;
    case 'In Progress': return <Clock {...iconProps} />;
    case 'Cancelled': return <AlertTriangle {...iconProps} />;
    default: return null;
  }
};

const TestSchedulingsTable: React.FC = () => {
  const { data: schedulings, isLoading, isError, error } = useQuery({ queryKey: ['testSchedulings'], queryFn: fetchTestSchedulings });

  if (isLoading) return <div className="bg-card text-card-foreground p-4 rounded-lg shadow flex items-center justify-center h-72"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;
  if (isError || !schedulings) return (
    <div className="bg-card text-card-foreground p-4 rounded-lg shadow flex flex-col items-center justify-center h-72 text-destructive">
      <AlertCircle className="h-8 w-8 mb-2" />
      <p>Error loading schedulings.</p>
      {error && <p className="text-xs mt-1">{(error as Error).message}</p>}
    </div>
  );

  if (schedulings.length === 0) return (
    <div className="bg-card text-card-foreground p-4 rounded-lg shadow flex flex-col items-center justify-center h-72 text-muted-foreground">
      <CalendarDays className="h-8 w-8 mb-2" />
      <p>No test schedulings found.</p>
    </div>
  );

  return (
    <div className="bg-card text-card-foreground p-4 rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">Upcoming & Recent Schedulings</h3> {/* Changed to text-lg */}
      <div className="overflow-x-auto max-h-[22rem]"> {/* Approx h-80, adjusted from max-h-96 */}
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/40 sticky top-0">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Date/Time</th>
              <th scope="col" className="px-4 py-3 font-medium">Test Suite</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Environment</th>
              <th scope="col" className="px-4 py-3 font-medium">Triggered By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {schedulings.map((item) => {
              const badgeStyle = getStatusBadgeStyle(item.status);
              return (
                <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(item.dateTime).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{item.testSuite}</td>
                  <td className="px-4 py-3">
                    <Badge variant={badgeStyle.variant} className={badgeStyle.className}>
                      {getStatusIcon(item.status)}
                      {item.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{item.environment}</td>
                  <td className="px-4 py-3 text-muted-foreground">{item.triggeredBy ?? 'N/A'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TestSchedulingsTable;

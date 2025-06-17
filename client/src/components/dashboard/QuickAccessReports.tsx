import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Loader2, AlertCircle, FileText, ListChecks, Image } from 'lucide-react';
import { Badge, BadgeProps } from '@/components/ui/badge'; // Badge component
import { Button } from '@/components/ui/button'; // Button component

interface TestRunReportInfo {
  id: string;
  testName: string;
  completedAt: string;
  status: 'Passed' | 'Failed' | 'Skipped' | 'In Progress';
  reportUrl: string;
  logsUrl: string;
  screenshotsUrl: string;
}

// Mock API function
const fetchRecentTestRuns = async (): Promise<TestRunReportInfo[]> => {
  await new Promise(resolve => setTimeout(resolve, 750));
  // if (Math.random() > 0.8) throw new Error('Failed to fetch recent test runs');
  return [
    { id: 'run101', testName: 'User Authentication Flow', completedAt: '2023-11-21 09:15', status: 'Passed', reportUrl: '/reports/run101', logsUrl: '/reports/run101/logs', screenshotsUrl: '/reports/run101/screenshots' },
    { id: 'run102', testName: 'Product Search & Filter', completedAt: '2023-11-21 08:30', status: 'Failed', reportUrl: '/reports/run102', logsUrl: '/reports/run102/logs', screenshotsUrl: '/reports/run102/screenshots' },
    { id: 'run103', testName: 'Checkout Process E2E', completedAt: '2023-11-20 17:45', status: 'Passed', reportUrl: '/reports/run103', logsUrl: '/reports/run103/logs', screenshotsUrl: '/reports/run103/screenshots' },
    { id: 'run104', testName: 'API Rate Limiting Test', completedAt: '2023-11-20 12:00', status: 'Skipped', reportUrl: '/reports/run104', logsUrl: '/reports/run104/logs', screenshotsUrl: '/reports/run104/screenshots' },
    { id: 'run105', testName: 'Dashboard Widget Loading', completedAt: '2023-11-21 10:00', status: 'In Progress', reportUrl: '/reports/run105', logsUrl: '/reports/run105/logs', screenshotsUrl: '/reports/run105/screenshots' },
  ].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
};

// Consistent status badge styling, adapted from TestSchedulingsTable
const getStatusBadgeStyle = (status: TestRunReportInfo['status']): { variant: BadgeProps['variant'], className?: string } => {
  switch (status) {
    case 'Passed':
      return { variant: 'default', className: 'bg-green-600 hover:bg-green-600/80 text-white border-transparent dark:bg-green-700 dark:hover:bg-green-700/80' };
    case 'Failed':
      return { variant: 'destructive' }; // Assumes destructive variant handles dark mode well
    case 'Skipped':
      // Ensuring text-muted-foreground like styling for skipped, which is often theme-aware for light/dark
      return { variant: 'outline', className: 'border-gray-400 text-gray-500 dark:border-gray-500 dark:text-gray-400' };
    case 'In Progress':
      return { variant: 'outline', className: 'border-blue-500 text-blue-500 dark:border-blue-400 dark:text-blue-400' };
    default:
      return { variant: 'default' }; // Default variant should be checked for dark mode
  }
};

const QuickAccessReports: React.FC = () => {
  const { data: reports, isLoading, isError, error } = useQuery({ queryKey: ['recentTestRuns'], queryFn: fetchRecentTestRuns });

  const containerClasses = "bg-card text-card-foreground p-4 rounded-lg shadow mt-6";
  const feedbackContainerClasses = `${containerClasses} flex flex-col items-center justify-center min-h-[240px]`; {/* Increased min-height slightly */}

  if (isLoading) return <div className={feedbackContainerClasses}><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;
  if (isError || !reports) return (
    <div className={`${feedbackContainerClasses} text-destructive`}>
      <AlertCircle className="h-8 w-8 mb-2" />
      <p>Error loading reports.</p>
      {error && <p className="text-xs mt-1">{(error as Error).message}</p>}
    </div>
  );
  if (reports.length === 0) return (
    <div className={`${feedbackContainerClasses} text-muted-foreground`}>
      <FileText className="h-8 w-8 mb-2" />
      <p>No recent test reports found.</p>
    </div>
  );

  return (
    <div className={containerClasses}>
      <h3 className="text-lg font-semibold mb-4">Recent Test Reports</h3> {/* Changed to text-lg */}
      <div className="space-y-3"> {/* Reduced space-y for slightly tighter packing */}
        {reports.map((report) => {
          const badgeStyle = getStatusBadgeStyle(report.status);
          return (
            <div key={report.id} className="p-3 border border-border rounded-lg hover:shadow-lg transition-shadow bg-background/30 dark:bg-background/50">
              <div className="flex flex-col sm:flex-row justify-between sm:items-start mb-1.5">
                <h4 className="text-md font-semibold text-primary mb-1 sm:mb-0">
                  <Link href={report.reportUrl} className="hover:underline">{report.testName}</Link>
                </h4>
                <Badge variant={badgeStyle.variant} className={`capitalize text-xs ${badgeStyle.className}`}>{report.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-2.5">
                Completed: {new Date(report.completedAt).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
              <div className="flex space-x-2 flex-wrap gap-y-2"> {/* Added gap-y-2 for wrapping buttons */}
                <Button variant="outline" size="sm" asChild>
                  <Link href={report.reportUrl}><FileText size={14} className="mr-1.5" /> View Report</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href={report.logsUrl}><ListChecks size={14} className="mr-1.5" /> Logs</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href={report.screenshotsUrl}><Image size={14} className="mr-1.5" /> Screenshots</Link>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default QuickAccessReports;

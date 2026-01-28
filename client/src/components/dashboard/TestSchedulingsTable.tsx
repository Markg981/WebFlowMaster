import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fetchAllSchedules, TestPlanScheduleEnhanced } from '@/lib/api/schedules';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, CalendarDays } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'wouter';

const TestSchedulingsTable: React.FC = () => {
  const { t } = useTranslation();

  const { data: schedules = [], isLoading, error } = useQuery<TestPlanScheduleEnhanced[]>({
    queryKey: ['allActiveSchedulesForDashboard'], // Unique query key
    queryFn: async () => {
      const allSchedules = await fetchAllSchedules();
      // Filter for active schedules and sort by nextRunAt ascending
      return allSchedules
        .filter(s => s.isActive)
        .sort((a, b) => (a.nextRunAt?.getTime() || 0) - (b.nextRunAt?.getTime() || 0));
    },
    // Refetch interval can be added if real-time updates are desired, e.g., refetchInterval: 60000, // every minute
  });

  const displayedSchedules = schedules.slice(0, 5); // Display top 5 upcoming active schedules

  return (
    <div className="bg-card text-card-foreground p-4 rounded-lg shadow">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">{t('dashboard.testSchedulingsTable.upcomingActiveSchedules.title')}</h3>
        <Link href="/test-suites" className="text-sm text-primary hover:underline flex items-center">
          {t('dashboard.testSchedulingsTable.viewAll.link')} <CalendarDays className="ml-1 h-4 w-4" />
        </Link>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="ml-2">{t('dashboard.testSchedulingsTable.loading.text')}</p>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center h-40 text-destructive">
          <AlertCircle className="h-8 w-8 mb-2" />
          <p>{t('dashboard.testSchedulingsTable.error.text')}</p>
          <p className="text-xs">{error.message}</p>
        </div>
      )}

      {!isLoading && !error && displayedSchedules.length === 0 && (
        <div className="flex items-center justify-center h-40">
          <p className="text-muted-foreground">{t('dashboard.testSchedulingsTable.noUpcomingSchedules.text')}</p>
        </div>
      )}

      {!isLoading && !error && displayedSchedules.length > 0 && (
        <div className="overflow-x-auto max-h-80"> {/* Added max-h for scrollability if many items */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dashboard.testSchedulingsTable.table.testPlan.header')}</TableHead>
                <TableHead>{t('dashboard.testSchedulingsTable.table.scheduleName.header')}</TableHead>
                <TableHead>{t('dashboard.testSchedulingsTable.table.environment.header')}</TableHead>
                <TableHead>{t('dashboard.testSchedulingsTable.table.nextRun.header')}</TableHead>
                <TableHead>{t('dashboard.testSchedulingsTable.table.frequency.header')}</TableHead>
                <TableHead>{t('dashboard.testSchedulingsTable.table.status.header')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedSchedules.map((schedule) => (
                <TableRow key={schedule.id}>
                  <TableCell className="font-medium">
                     <Link href={`/test-suites?planId=${schedule.testPlanId}&tab=schedules`} className="hover:underline text-primary">
                        {schedule.testPlanName || schedule.testPlanId}
                     </Link>
                  </TableCell>
                  <TableCell>{schedule.scheduleName}</TableCell>
                  <TableCell>
                    {schedule.environment ? <Badge variant="outline">{schedule.environment}</Badge> : <span className="text-xs text-muted-foreground">{t('dashboard.testSchedulingsTable.notSet.text')}</span>}
                    </TableCell>
                  <TableCell>
                    {schedule.nextRunAt ? format(schedule.nextRunAt, 'PPpp') : t('dashboard.testSchedulingsTable.notScheduled.text')}
                  </TableCell>
                  <TableCell className="text-xs">{schedule.frequency}</TableCell>
                  <TableCell>
                    <Badge variant={schedule.isActive ? 'default' : 'secondary'} className={schedule.isActive ? 'bg-green-500 hover:bg-green-600' : ''}>
                      {schedule.isActive ? t('dashboard.testSchedulingsTable.status.active') : t('dashboard.testSchedulingsTable.status.inactive')}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default TestSchedulingsTable;

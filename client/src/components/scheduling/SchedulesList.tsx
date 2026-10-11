import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TestPlanScheduleEnhanced } from '@/lib/api/schedules';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FileEdit, Trash2 } from 'lucide-react';
import { formatInZone } from '@/lib/dates';

interface SchedulesListProps {
  schedules: TestPlanScheduleEnhanced[];
  /** Without these the list is read-only: no actions column. */
  onEdit?: (schedule: TestPlanScheduleEnhanced) => void;
  onDelete?: (scheduleId: string) => void;
  isLoading: boolean;
  error?: Error | null;
}

const SchedulesList: React.FC<SchedulesListProps> = ({
  schedules,
  onEdit,
  onDelete,
  isLoading,
  error,
}) => {
  const { t } = useTranslation();

  /** "Daily", or "CRON (0 2 * * 1)" for a custom one. */
  const frequencyLabel = (frequency: string) => {
    if (frequency.startsWith('cron:')) return `CRON (${frequency.substring(5)})`;
    const humanized = frequency.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
    return t(`schedulingPage.form.frequency.${frequency}`, humanized);
  };

  if (isLoading) {
    return <p>{t('schedulingPage.list.loading', 'Loading schedules...')}</p>;
  }

  if (error) {
    return (
      <p className="text-destructive">
        {t('schedulingPage.list.loadFailed', 'Error loading schedules: {{message}}', {
          message: error.message,
        })}
      </p>
    );
  }

  if (!schedules || schedules.length === 0) {
    return (
      <p>{t('schedulingPage.list.empty', 'No schedules found. Create one to get started!')}</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('schedulingPage.list.columns.name', 'Name')}</TableHead>
            <TableHead>{t('schedulingPage.form.testPlan', 'Test Plan')}</TableHead>
            <TableHead>{t('schedulingPage.form.frequencyLabel', 'Frequency')}</TableHead>
            <TableHead>{t('schedulingPage.form.nextRunAt', 'Next Run At')}</TableHead>
            <TableHead>{t('schedulingPage.form.environment', 'Environment')}</TableHead>
            <TableHead>{t('schedulingPage.form.browsers', 'Browsers')}</TableHead>
            <TableHead>{t('schedulingPage.list.columns.status', 'Status')}</TableHead>
            {onEdit && onDelete && (
              <TableHead>{t('schedulingPage.list.columns.actions', 'Actions')}</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedules.map((schedule) => (
            <TableRow key={schedule.id}>
              <TableCell className="font-medium">{schedule.scheduleName}</TableCell>
              <TableCell>{schedule.testPlanName || schedule.testPlanId}</TableCell>
              <TableCell>{frequencyLabel(schedule.frequency)}</TableCell>
              {/* Rendered in the schedule's own zone, and labelled with it. The column
                  used to say "(UTC)" while formatting in the reader's local zone, so the
                  heading and the number disagreed for everyone outside UTC. */}
              <TableCell className="whitespace-nowrap">
                {formatInZone(schedule.nextRunAt, schedule.timezone)}
                <span className="ml-2 text-xs text-muted-foreground">
                  {schedule.timezone || 'UTC'}
                </span>
              </TableCell>
              <TableCell>{schedule.environment || '-'}</TableCell>
              <TableCell>
                {schedule.browsers && schedule.browsers.length > 0
                  ? schedule.browsers.join(', ')
                  : '-'}
              </TableCell>
              <TableCell>
                <Badge
                  variant={schedule.isActive ? 'default' : 'outline'}
                  className={schedule.isActive ? 'bg-success hover:bg-success/90 text-white' : ''}
                >
                  {schedule.isActive
                    ? t('schedulingPage.list.active', 'Active')
                    : t('schedulingPage.list.inactive', 'Inactive')}
                </Badge>
              </TableCell>
              {onEdit && onDelete && (
                <TableCell className="space-x-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(schedule)}
                    title={t('schedulingPage.editSchedule.title', 'Edit Schedule')}
                    aria-label={t('schedulingPage.editSchedule.title', 'Edit Schedule')}
                  >
                    <FileEdit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(schedule.id)}
                    title={t('schedulingPage.list.deleteSchedule', 'Delete Schedule')}
                    aria-label={t('schedulingPage.list.deleteSchedule', 'Delete Schedule')}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default SchedulesList;

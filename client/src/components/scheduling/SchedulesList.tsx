import React from 'react';
import type { TestPlanScheduleEnhanced } from '@/lib/api/schedules';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Pencil2Icon, TrashIcon } from '@radix-ui/react-icons';
import { format } from 'date-fns';

interface SchedulesListProps {
  schedules: TestPlanScheduleEnhanced[];
  onEdit: (schedule: TestPlanScheduleEnhanced) => void;
  onDelete: (scheduleId: string) => void;
  isLoading: boolean;
  error?: Error | null;
}

const SchedulesList: React.FC<SchedulesListProps> = ({ schedules, onEdit, onDelete, isLoading, error }) => {
  if (isLoading) {
    return <p>Loading schedules...</p>;
  }

  if (error) {
    return <p className="text-red-500">Error loading schedules: {error.message}</p>;
  }

  if (!schedules || schedules.length === 0) {
    return <p>No schedules found. Create one to get started!</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Test Plan</TableHead>
            <TableHead>Frequency</TableHead>
            <TableHead>Next Run At (UTC)</TableHead>
            <TableHead>Environment</TableHead>
            <TableHead>Browsers</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedules.map((schedule) => (
            <TableRow key={schedule.id}>
              <TableCell className="font-medium">{schedule.scheduleName}</TableCell>
              <TableCell>{schedule.testPlanName || schedule.testPlanId}</TableCell>
              <TableCell>
                {schedule.frequency.startsWith('cron:')
                  ? `CRON (${schedule.frequency.substring(5)})`
                  : schedule.frequency.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
              </TableCell>
              <TableCell>{format(schedule.nextRunAt, 'yyyy-MM-dd HH:mm')}</TableCell>
              <TableCell>{schedule.environment || '-'}</TableCell>
              <TableCell>
                {schedule.browsers && schedule.browsers.length > 0
                  ? schedule.browsers.join(', ')
                  : '-'}
              </TableCell>
              <TableCell>
                <Badge variant={schedule.isActive ? 'default' : 'outline'}
                       className={schedule.isActive ? 'bg-green-500 hover:bg-green-600 text-white' : ''}>
                  {schedule.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
              <TableCell className="space-x-2">
                <Button variant="ghost" size="icon" onClick={() => onEdit(schedule)} title="Edit Schedule">
                  <Pencil2Icon className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => onDelete(schedule.id)} title="Delete Schedule">
                  <TrashIcon className="h-4 w-4 text-red-500" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default SchedulesList;

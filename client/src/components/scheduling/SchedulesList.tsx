import React from 'react';
import type { TestPlanScheduleEnhanced } from '@/lib/api/schedules';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FileEdit, Trash2 } from 'lucide-react'; // Changed from @radix-ui/react-icons

interface SchedulesListProps {
  schedules: TestPlanScheduleEnhanced[];
  onEdit: (schedule: TestPlanScheduleEnhanced) => void;
  onDelete: (scheduleId: string) => void;
  isLoading: boolean;
  error?: Error | null;
}

/** A moment as it reads on the wall clock of a given zone. */
function formatInZone(value: Date | string | number, timeZone?: string | null): string {
  const date = value instanceof Date ? value : new Date(value);
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: timeZone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(date).replace(',', '');
  } catch {
    // An unknown zone should not blank the row; show UTC and let the label say what it is.
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
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
            <TableHead>Next Run At</TableHead>
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
                <Badge variant={schedule.isActive ? 'default' : 'outline'}
                       className={schedule.isActive ? 'bg-green-500 hover:bg-green-600 text-white' : ''}>
                  {schedule.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
              <TableCell className="space-x-2">
                <Button variant="ghost" size="icon" onClick={() => onEdit(schedule)} title="Edit Schedule">
                  <FileEdit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => onDelete(schedule.id)} title="Delete Schedule">
                  <Trash2 className="h-4 w-4 text-red-500" />
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

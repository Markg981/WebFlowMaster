import React from 'react';
import { useTranslation } from 'react-i18next';
// Removed useQuery, Loader2, AlertCircle, CalendarDays, CheckCircle, XCircle, Clock, AlertTriangle
// Removed Badge, BadgeProps

// interface ScheduledTest (REMOVED)
// Mock API function fetchTestSchedulings (REMOVED)
// getStatusBadgeStyle function (REMOVED)
// getStatusIcon function (REMOVED)

const TestSchedulingsTable: React.FC = () => {
  const { t } = useTranslation();
  // useQuery hook (REMOVED)
  // Loading, Error, No Data states (REMOVED)

  // The main card structure is kept.
  // The table and its specific layout (overflow, max-h) are replaced by a centered message.
  // h-72 is used to maintain a consistent height similar to when it had loading/error states.
  return (
    <div className="bg-card text-card-foreground p-4 rounded-lg shadow h-72 flex flex-col"> {/* Added flex flex-col */}
      <h3 className="text-lg font-semibold mb-4">{t('dashboard.testSchedulingsTable.upcomingRecentSchedulings.title')}</h3>
      <div className="flex-1 flex items-center justify-center"> {/* This div will center the placeholder message */}
        <p className="text-muted-foreground text-center">
          {t('dashboard.testSchedulingsTable.schedulingDataWillBeAvailable.description')}
        </p>
      </div>
    </div>
  );
};

export default TestSchedulingsTable;

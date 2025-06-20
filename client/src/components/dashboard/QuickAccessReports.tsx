import React from 'react';
import { useTranslation } from 'react-i18next';
// Removed useQuery, Link, Loader2, AlertCircle, FileText, ListChecks, Image
// Removed Badge, BadgeProps, Button

// interface TestRunReportInfo (REMOVED)
// Mock API function fetchRecentTestRuns (REMOVED)
// getStatusBadgeStyle function (REMOVED)

const QuickAccessReports: React.FC = () => {
  const { t } = useTranslation();
  // useQuery hook (REMOVED)
  // Loading, Error, No Data states (REMOVED)

  const containerClasses = "bg-card text-card-foreground p-4 rounded-lg shadow mt-6";
  // The min-h-[240px] from feedbackContainerClasses is applied here to the content area.
  const contentAreaClasses = "flex-1 flex items-center justify-center min-h-[240px]";


  return (
    <div className={`${containerClasses} flex flex-col`}> {/* Added flex flex-col to allow title and content area to stack */}
      <h3 className="text-lg font-semibold mb-4">{t('dashboard.quickAccessReports.recentTestReports.title')}</h3>
      <div className={contentAreaClasses}>
        <p className="text-muted-foreground text-center">
          {t('dashboard.quickAccessReports.reportDataWillBeAvailable.description')}
        </p>
      </div>
    </div>
  );
};

export default QuickAccessReports;

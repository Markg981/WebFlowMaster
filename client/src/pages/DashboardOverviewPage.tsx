import React from 'react';
import { Link, useRoute } from 'wouter'; // Added useRoute
import { useTranslation } from 'react-i18next'; // Added useTranslation
import KpiPanel from '@/components/dashboard/KpiPanel';
import TestStatusPieChart from '@/components/dashboard/TestStatusPieChart';
import TestTrendBarChart from '@/components/dashboard/TestTrendBarChart';
import TestSchedulingsTable from '@/components/dashboard/TestSchedulingsTable';
import QuickAccessReports from '@/components/dashboard/QuickAccessReports';
import RunTestNowButton from '@/components/dashboard/RunTestNowButton';

const DashboardOverviewPage: React.FC = () => {
  const { t } = useTranslation();
  const [isDashboardActive] = useRoute('/dashboard');
  // For other links, we can add useRoute if they have actual pages later
  // For now, they will use a consistent non-active style.

  const linkBaseStyle = "block py-2 px-3 rounded-md text-sm font-medium";
  const activeLinkStyle = "bg-primary/10 text-primary"; // Adjusted active style for better visibility with bg-card
  const inactiveLinkStyle = "text-foreground hover:bg-muted hover:text-foreground"; // text-foreground for better contrast on bg-card

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 bg-card text-card-foreground p-4 space-y-4 border-r border-border shrink-0">
        <h2 className="text-xl font-semibold px-3">Navigation</h2> {/* Added padding to align with links */}
        <nav>
          <ul className="space-y-1"> {/* Reduced space-y slightly */}
            <li>
              <Link href="/dashboard">
                <a className={`${linkBaseStyle} ${isDashboardActive ? activeLinkStyle : inactiveLinkStyle}`}>
                  {t('nav.dashboard')}
                </a>
              </Link>
            </li>
            <li>
              <Link href="#/tests"> {/* Placeholder href */}
                <a className={`${linkBaseStyle} ${inactiveLinkStyle}`}>
                  {t('nav.tests')}
                </a>
              </Link>
            </li>
            <li>
              <Link href="#/suites"> {/* Placeholder href */}
                <a className={`${linkBaseStyle} ${inactiveLinkStyle}`}>
                  {t('nav.suites')}
                </a>
              </Link>
            </li>
            <li>
              <Link href="#/schedulazioni"> {/* Placeholder href */}
                <a className={`${linkBaseStyle} ${inactiveLinkStyle}`}>
                  {t('nav.schedulazioni')}
                </a>
              </Link>
            </li>
            <li>
              <Link href="#/reports"> {/* Placeholder href */}
                <a className={`${linkBaseStyle} ${inactiveLinkStyle}`}>
                  {t('nav.reports')}
                </a>
              </Link>
            </li>
          </ul>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-6 overflow-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-bold">Dashboard Overview</h1>
        </header>

        <KpiPanel />

        {/* Charts Section */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TestStatusPieChart />
          <TestTrendBarChart />
        </div>

        {/* Test Schedulings Table Section */}
        <div className="mt-6">
          <TestSchedulingsTable />
        </div>

        {/* Quick Access Reports Section */}
        {/* mt-6 is handled by the component itself, so no need for an extra div with margin unless further styling is needed */}
        <QuickAccessReports />

        {/* Run Test Now Button Section */}
        {/* mt-8 and text-center is handled by the component's wrapper div */}
        <RunTestNowButton />
      </main>
    </div>
  );
};

export default DashboardOverviewPage;

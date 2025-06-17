import React, { useState } from 'react'; // Added useState
import { Link, useRoute } from 'wouter';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button'; // Added Button import
import {
  Home, PlusSquare, ListChecksIcon as TestsIcon, LibrarySquare as SuitesIcon, // Renamed ListChecks to avoid conflict
  CalendarClock, FileTextIcon as ReportsIcon, Settings as SettingsIcon, // Renamed FileText
  PanelLeftClose, PanelRightClose, UserCircle // Added UserCircle for collapsed user info
} from 'lucide-react'; // Added icons
import KpiPanel from '@/components/dashboard/KpiPanel';
import TestStatusPieChart from '@/components/dashboard/TestStatusPieChart';
import TestTrendBarChart from '@/components/dashboard/TestTrendBarChart';
import TestSchedulingsTable from '@/components/dashboard/TestSchedulingsTable';
import QuickAccessReports from '@/components/dashboard/QuickAccessReports';
import RunTestNowButton from '@/components/dashboard/RunTestNowButton';

const DashboardOverviewPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [isDashboardActive] = useRoute('/dashboard');
  const [isCreateTestActive] = useRoute('/');
  const [isSettingsActive] = useRoute('/settings');
  // Placeholder active states for other links - assuming false for now
  const isTestsActive = false;
  const isSuitesActive = false;
  const isSchedulazioniActive = false;
  const isReportsActive = false;

  const linkBaseStyle = "flex items-center py-2 px-3 rounded-md text-sm font-medium";
  const activeLinkStyle = "bg-primary/10 text-primary";
  const inactiveLinkStyle = "text-foreground hover:bg-muted hover:text-foreground";

  const iconBaseStyle = "mr-3 h-5 w-5"; // For non-collapsed state
  const collapsedIconStyle = "h-6 w-6"; // For collapsed state, icons might be larger and centered

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`bg-card text-card-foreground border-r border-border shrink-0 flex flex-col transition-all duration-300 ease-in-out ${
          isSidebarCollapsed ? 'w-20 p-2' : 'w-64 p-4'
        }`}
      >
        <div>
          <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'} mb-4`}>
            {!isSidebarCollapsed && <h2 className="text-xl font-semibold px-3">Navigation</h2>}
            {/* Collapse button for larger screens, always visible if sidebar is not for mobile toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className={isSidebarCollapsed ? 'self-center' : ''}
            >
              {isSidebarCollapsed ? <PanelRightClose /> : <PanelLeftClose />}
            </Button>
          </div>
          <nav>
            <ul className="space-y-1">
              <li>
                <Link href="/dashboard">
                  <a title={t('nav.dashboard')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isDashboardActive ? activeLinkStyle : inactiveLinkStyle}`}>
                    <Home className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                    {!isSidebarCollapsed && <span>{t('nav.dashboard')}</span>}
                  </a>
                </Link>
              </li>
              <li>
                <Link href="/">
                  <a title={t('nav.createTest')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isCreateTestActive ? activeLinkStyle : inactiveLinkStyle}`}>
                    <PlusSquare className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                    {!isSidebarCollapsed && <span>{t('nav.createTest')}</span>}
                  </a>
                </Link>
              </li>
              <li>
                <Link href="#/tests">
                  <a title={t('nav.tests')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isTestsActive ? activeLinkStyle : inactiveLinkStyle}`}>
                    <TestsIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                    {!isSidebarCollapsed && <span>{t('nav.tests')}</span>}
                  </a>
                </Link>
              </li>
              <li>
                <Link href="#/suites">
                  <a title={t('nav.suites')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isSuitesActive ? activeLinkStyle : inactiveLinkStyle}`}>
                    <SuitesIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                    {!isSidebarCollapsed && <span>{t('nav.suites')}</span>}
                  </a>
                </Link>
              </li>
              <li>
                <Link href="#/schedulazioni">
                  <a title={t('nav.schedulazioni')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isSchedulazioniActive ? activeLinkStyle : inactiveLinkStyle}`}>
                    <CalendarClock className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                    {!isSidebarCollapsed && <span>{t('nav.schedulazioni')}</span>}
                  </a>
                </Link>
              </li>
              <li>
                <Link href="#/reports">
                  <a title={t('nav.reports')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isReportsActive ? activeLinkStyle : inactiveLinkStyle}`}>
                    <ReportsIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                    {!isSidebarCollapsed && <span>{t('nav.reports')}</span>}
                  </a>
                </Link>
              </li>
              <li>
                <Link href="/settings">
                  <a title={t('nav.settings')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isSettingsActive ? activeLinkStyle : inactiveLinkStyle}`}>
                    <SettingsIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                    {!isSidebarCollapsed && <span>{t('nav.settings')}</span>}
                  </a>
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className={`mt-auto pt-4 border-t border-border ${isSidebarCollapsed ? 'px-0' : 'px-3'}`}>
          {user ? (
            isSidebarCollapsed ? (
              <div className="flex justify-center items-center py-2" title={user.username}>
                <UserCircle className="h-7 w-7 text-muted-foreground" />
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold text-foreground truncate">{user.username}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email || 'No email provided'}</p>
              </>
            )
          ) : (
            isSidebarCollapsed ? (
              <div className="flex justify-center items-center py-2" title="User not loaded">
                 <UserCircle className="h-7 w-7 text-muted-foreground opacity-50" />
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold text-muted-foreground">User not loaded</p>
                <p className="text-xs text-muted-foreground">...</p>
              </>
            )
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className={`flex-1 p-6 overflow-auto transition-all duration-300 ease-in-out ${
          isSidebarCollapsed ? 'ml-20' : 'ml-64' // Adjust based on actual final collapsed/expanded widths
      }`}>
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

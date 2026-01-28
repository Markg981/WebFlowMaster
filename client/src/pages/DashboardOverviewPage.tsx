import React, { useState } from 'react'; // Added useState
import { Link, useRoute } from 'wouter';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button'; // Added Button import
import {
  Home, PlusSquare, ListChecksIcon as TestsIcon, LibrarySquare as SuitesIcon,
  CalendarClock, FileTextIcon as ReportsIcon, Settings as SettingsIcon, Network, // Added Network icon
  PanelLeftClose, PanelRightClose, UserCircle, TestTube, FileSpreadsheet // Added TestTube
} from 'lucide-react';
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
  const [isCreateTestActive] = useRoute('/dashboard/create-test'); // Changed path
  const [isApiTesterActive] = useRoute('/dashboard/api-tester'); // For the new API Tester link
  const [isSettingsActive] = useRoute('/settings');
  const [isSuitesActive] = useRoute('/test-suites'); // Updated active state for Test Suites
  const [isSchedulingActive] = useRoute('/scheduling'); // Corrected variable name and added useRoute
  const [isReportsActive] = useRoute('/reports'); // Updated for the new general reports page
  const [isTestManagerActive] = useRoute('/test-manager');

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
        <div> {/* This div wraps the header and nav, separate from user info at the bottom */}
          {/* Sidebar Header: Logo, Title (when expanded), and Collapse Button */}
          <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'} p-1 mb-2 h-12`}> {/* Fixed height for header */}
            <div className="flex items-center">
              <TestTube className={`h-7 w-7 text-primary transition-all duration-300 ${isSidebarCollapsed ? 'ml-0' : 'mr-2'}`} />
              {!isSidebarCollapsed && (
                <span className="font-semibold text-lg whitespace-nowrap">{t('dashboardOverviewPage.webtestPlatform.text')}</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" // Added focus styling
            >
              {isSidebarCollapsed ? <PanelRightClose size={20} /> : <PanelLeftClose size={20} />}
            </Button>
          </div>

          {/* Navigation Links */}
          <nav className={isSidebarCollapsed ? "mt-2" : "mt-0"}> {/* Adjust margin based on collapse state */}
            <ul className="space-y-1">
              <li>
                <Link href="/dashboard" title={t('nav.dashboard')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isDashboardActive ? activeLinkStyle : inactiveLinkStyle}`}>
                  <Home className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                  {!isSidebarCollapsed && <span>{t('nav.dashboard')}</span>}
                </Link>
              </li>
              <li>
                <Link href="/dashboard/api-tester" title={t('nav.apiTester', 'API Tester')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isApiTesterActive ? activeLinkStyle : inactiveLinkStyle}`}>
                  <Network className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                  {!isSidebarCollapsed && <span>{t('nav.apiTester', 'API Tester')}</span>}
                </Link>
              </li>
              <li>
                <Link href="/dashboard/create-test" title={t('nav.createTest')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isCreateTestActive ? activeLinkStyle : inactiveLinkStyle}`}>
                  <PlusSquare className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                  {!isSidebarCollapsed && <span>{t('nav.createTest')}</span>}
                </Link>
              </li>
              <li>
                <Link href="/test-manager" title="Test Manager" className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isTestManagerActive ? activeLinkStyle : inactiveLinkStyle}`}>
                  <FileSpreadsheet className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                  {!isSidebarCollapsed && <span>Test Manager</span>}
                </Link>
              </li>
              <li>
                <Link href="/test-suites" title={t('nav.suites')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isSuitesActive ? activeLinkStyle : inactiveLinkStyle}`}>
                  <SuitesIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                  {!isSidebarCollapsed && <span>{t('nav.suites')}</span>}
                </Link>
              </li>
              <li>
                <Link href="/scheduling" title={t('nav.scheduling', 'Scheduling')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isSchedulingActive ? activeLinkStyle : inactiveLinkStyle}`}>
                  <CalendarClock className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                  {!isSidebarCollapsed && <span>{t('nav.scheduling', 'Scheduling')}</span>}
                </Link>
              </li>
              <li>
                <Link href="/reports" title={t('nav.reports')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isReportsActive ? activeLinkStyle : inactiveLinkStyle}`}>
                  <ReportsIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                  {!isSidebarCollapsed && <span>{t('nav.reports')}</span>}
                </Link>
              </li>
              <li>
                <Link href="/settings" title={t('nav.settings')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isSettingsActive ? activeLinkStyle : inactiveLinkStyle}`}>
                  <SettingsIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />
                  {!isSidebarCollapsed && <span>{t('nav.settings')}</span>}
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
                {/* <p className="text-xs text-muted-foreground truncate">{user.email || t('dashboardOverviewPage.noEmailProvided.text')}</p> - Email removed as not in schema */}
              </>
            )
          ) : (
            isSidebarCollapsed ? (
              <div className="flex justify-center items-center py-2" title={t('dashboardOverviewPage.userNotLoaded.text')}>
                 <UserCircle className="h-7 w-7 text-muted-foreground opacity-50" />
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold text-muted-foreground">{t('dashboardOverviewPage.userNotLoaded.text')}</p>
                <p className="text-xs text-muted-foreground">...</p>
              </>
            )
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className={`flex-1 py-6 pr-4 pl-0 overflow-auto transition-all duration-300 ease-in-out ${
          isSidebarCollapsed ? 'ml-20' : 'ml-8' // Adjust based on actual final collapsed/expanded widths
      }`}>
        <header className="mb-6 px-0 mx-0">
          <h1 className="text-3xl font-bold">{t('dashboardOverviewPage.dashboardOverview.title')}</h1>
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

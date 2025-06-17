import React from 'react';
import { Link } from 'wouter';
import KpiPanel from '@/components/dashboard/KpiPanel';
import TestStatusPieChart from '../../components/dashboard/TestStatusPieChart';
import TestTrendBarChart from '../../components/dashboard/TestTrendBarChart';
import TestSchedulingsTable from '../../components/dashboard/TestSchedulingsTable';
import QuickAccessReports from '../../components/dashboard/QuickAccessReports';
import RunTestNowButton from '../../components/dashboard/RunTestNowButton'; // Import Run Test Now Button

const DashboardOverviewPage: React.FC = () => {
  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 bg-card text-card-foreground p-4 space-y-4 border-r border-border shrink-0"> {/* Added shrink-0 to prevent sidebar from shrinking */}
        <h2 className="text-xl font-semibold">Navigation</h2>
        <nav>
          <ul className="space-y-2">
            <li><Link href="/dashboard" className="hover:text-primary hover:underline">Dashboard</Link></li>
            <li><Link href="/tests" className="hover:text-primary hover:underline">Tests</Link></li>
            <li><Link href="/suites" className="hover:text-primary hover:underline">Suites</Link></li>
            <li><Link href="/schedulazioni" className="hover:text-primary hover:underline">Schedulazioni</Link></li>
            <li><Link href="/reports" className="hover:text-primary hover:underline">Report</Link></li>
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

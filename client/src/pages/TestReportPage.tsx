// client/src/pages/TestReportPage.tsx
import React, { useState } from 'react';
import { useRoute, Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { fetchTestExecutionReport } from '@/lib/api/reports';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ExternalLink, Download, Share2, ListFilter, CheckCircle2, XCircle, SkipForward, AlertCircle, Clock,
  ChevronRight, FileText, Image as ImageIcon, RefreshCw, Home, PlusSquare, ListChecksIcon as TestsIcon,
  LibrarySquare as SuitesIcon, CalendarClock, FileTextIcon as ReportsIcon, Settings as SettingsIcon, Network,
  PanelLeftClose, PanelRightClose, UserCircle, TestTube
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { useAuth } from '@/hooks/use-auth'; // For sidebar user info
import { useTranslation } from 'react-i18next'; // For sidebar translations

// Placeholder for chart component (remains the same)
const PlaceholderChart = ({ title, data }: { title: string, data: any }) => (
  <Card className="flex-1 min-w-[300px]">
    <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
    <CardContent className="h-[200px] flex items-center justify-center">
      <p className="text-sm text-muted-foreground">{data && Object.keys(data).length > 0 ? `Chart placeholder (Data: ${Object.keys(data).length} series)` : "No data for chart"}</p>
    </CardContent>
  </Card>
);

// Report data type definition (remains the same)
export interface TestPlanExecutionReport {
  header: {
    testSuiteName: string;
    environment: string;
    browsers: string[];
    dateTime: string;
    completedAt: string | null;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'error' | 'cancelled';
    triggeredBy: 'scheduled' | 'manual' | 'api';
    executionId: string;
    testPlanId: string;
  };
  keyMetrics: {
    totalTests: number; passedTests: number; failedTests: number; skippedTests: number;
    passRate: number; averageTimePerTestMs: number; totalTestCasesDurationMs: number;
    executionDurationMs: number | null;
  };
  charts: {
    passFailSkippedDistribution: { passed: number; failed: number; skipped: number; };
    priorityDistribution: Record<string, { passed: number; failed: number; skipped: number; total: number; }>;
    severityDistribution: Record<string, { passed: number; failed: number; skipped: number; total: number; }>;
  };
  failedTestDetails: Array<{
    id: string; testName: string; reasonForFailure: string | null; screenshotUrl: string | null;
    detailedLog: string | null; component: string | null; priority: string | null;
    severity: string | null; durationMs: number | null; uiTestId: number | null;
    apiTestId: number | null; testType: 'ui' | 'api';
  }>;
  testGroupings: Record<string, {
    passed: number; failed: number; skipped: number; total: number;
    components: Record<string, {
      passed: number; failed: number; skipped: number; total: number;
      tests: Array<{
        id: string; testPlanExecutionId: string; uiTestId: number | null; apiTestId: number | null;
        testType: 'ui' | 'api'; testName: string; status: 'Passed' | 'Failed' | 'Skipped' | 'Pending' | 'Error';
        reasonForFailure: string | null; screenshotUrl: string | null; detailedLog: string | null;
        startedAt: number; completedAt: number | null; durationMs: number | null;
        module: string | null; featureArea: string | null; scenario: string | null; component: string | null;
        priority: string | null; severity: string | null;
      }>;
    }>;
  }>;
  allTests: Array<any>;
}


const TestReportPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, params] = useRoute<{ planId: string; executionId: string }>("/test-plans/:planId/executions/:executionId/report");
  const executionId = params?.executionId;

  // Sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Active route states for sidebar
  const [isDashboardActive] = useRoute('/dashboard');
  const [isCreateTestActive] = useRoute('/dashboard/create-test');
  const [isApiTesterActive] = useRoute('/dashboard/api-tester');
  const [isSettingsActive] = useRoute('/settings');
  const [isSuitesActive] = useRoute('/test-suites');
  const [isSchedulingActive] = useRoute('/scheduling');
  // For detailed report, mark /reports as active or a more specific pattern
  const [isReportsActive] = useRoute('/reports');
  const [isCurrentReportActive] = useRoute('/test-plans/:planId/executions/:executionId/report');


  // Filter states (remain for future use, not directly used by layout)
  // const [selectedComponent, setSelectedComponent] = useState<string | null>(null);
  // const [selectedSeverity, setSelectedSeverity] = useState<string | null>(null);
  // const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);

  const { data: reportData, isLoading, error, refetch, isFetching } = useQuery<TestPlanExecutionReport, Error>(
    ['testExecutionReport', executionId],
    () => {
      if (!executionId) return Promise.reject(new Error("Execution ID is missing"));
      return fetchTestExecutionReport(executionId);
    },
    {
      enabled: !!executionId,
      refetchInterval: data => (data?.header?.status === 'running' || data?.header?.status === 'pending') ? 5000 : false,
    }
  );

  const getStatusIcon = (status: string | null | undefined, sizeClass = "h-5 w-5") => {
    if (!status) return <AlertCircle className={`${sizeClass} text-gray-500`} />;
    switch (status.toLowerCase()) {
      case 'passed': case 'completed': return <CheckCircle2 className={`${sizeClass} text-green-500`} />;
      case 'failed': case 'error': return <XCircle className={`${sizeClass} text-red-500`} />;
      case 'skipped': return <SkipForward className={`${sizeClass} text-yellow-500`} />;
      case 'running': case 'pending': return <Clock className={`${sizeClass} text-blue-500 animate-spin`} />;
      case 'cancelled': return <AlertCircle className={`${sizeClass} text-orange-500`} />;
      default: return <AlertCircle className={`${sizeClass} text-gray-500`} />;
    }
  };

  const getStatusColor = (status: string | null | undefined) => {
    if (!status) return "text-gray-600 dark:text-gray-400";
    // ... (status color logic remains the same)
    switch (status.toLowerCase()) {
      case 'passed': return "text-green-600 dark:text-green-400";
      case 'completed': return "text-green-600 dark:text-green-400";
      case 'failed': return "text-red-600 dark:text-red-400";
      case 'error': return "text-red-600 dark:text-red-400";
      case 'skipped': return "text-yellow-600 dark:text-yellow-400";
      case 'running': return "text-blue-600 dark:text-blue-400";
      case 'pending': return "text-blue-600 dark:text-blue-400";
      case 'cancelled': return "text-orange-600 dark:text-orange-400";
      default: return "text-gray-600 dark:text-gray-400";
    }
  };

  const formatDuration = (ms: number | null | undefined) => {
    if (ms === null || ms === undefined || ms < 0) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds.padStart(2, '0')}s`;
  };

  // Sidebar link styles
  const linkBaseStyle = "flex items-center py-2 px-3 rounded-md text-sm font-medium";
  const activeLinkStyle = "bg-primary/10 text-primary";
  const inactiveLinkStyle = "text-foreground hover:bg-muted hover:text-foreground";
  const iconBaseStyle = "mr-3 h-5 w-5";
  const collapsedIconStyle = "h-6 w-6";

  const pageContent = () => {
    if (isLoading) return <div className="p-6 text-center">Loading test report...</div>;
    if (error) return <div className="p-6 text-red-500 text-center">Error loading report: {error.message} <Button onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />Retry</Button></div>;
    if (!reportData) return <div className="p-6 text-center">No report data found. <Button onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />Refresh</Button></div>;

    const { header, keyMetrics, charts, failedTestDetails, testGroupings } = reportData;

    return (
      <div className="space-y-6">
        {/* Header Section */}
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
              <div className="mb-2 md:mb-0">
                <CardTitle className="text-2xl flex items-center">
                  {getStatusIcon(header.status, "h-7 w-7 mr-2")}
                  {header.testSuiteName}
                </CardTitle>
                <CardDescription>
                  Execution ID: {header.executionId} (Plan: <Link href={`/test-suites?planId=${header.testPlanId}`} className="underline hover:text-primary">{header.testPlanId}</Link>)
                </CardDescription>
              </div>
              <div className="flex items-center space-x-2">
                {(header.status === 'running' || header.status === 'pending') && (
                  <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => console.log("Export PDF clicked")}><Download className="mr-2 h-4 w-4" /> PDF</Button>
                <Button variant="outline" size="sm" onClick={() => console.log("Export CSV clicked")}><Download className="mr-2 h-4 w-4" /> CSV</Button>
                <Button variant="outline" size="sm" onClick={() => console.log("Share report clicked")}><Share2 className="mr-2 h-4 w-4" /> Share</Button>
              </div>
            </div>
            <div className="text-sm text-muted-foreground pt-2 grid grid-cols-1 md:grid-cols-2 gap-x-4">
              <p><strong>Environment:</strong> {header.environment || 'N/A'} {header.browsers && header.browsers.length > 0 ? `(${header.browsers.join(', ')})` : ''}</p>
              <p><strong>Triggered by:</strong> {header.triggeredBy || 'N/A'}</p>
              <p><strong>Started:</strong> {new Date(header.dateTime).toLocaleString()}</p>
              {header.completedAt ?
                <p><strong>Completed:</strong> {new Date(header.completedAt).toLocaleString()}</p> :
                <p><strong>Status:</strong> <span className={`font-semibold ${getStatusColor(header.status)}`}>{header.status.toUpperCase()}</span></p>
              }
              {keyMetrics.executionDurationMs !== null && <p><strong>Total Duration:</strong> {formatDuration(keyMetrics.executionDurationMs)}</p>}
            </div>
          </CardHeader>
        </Card>

        {/* Key Metrics Overview (content remains the same) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card><CardHeader className="pb-2"><CardDescription>Total Tests</CardDescription><CardTitle className="text-4xl">{keyMetrics.totalTests}</CardTitle></CardHeader><CardContent><Progress value={keyMetrics.totalTests > 0 ? 100 : 0} aria-label="Total tests" /></CardContent></Card>
            <Card className="border-green-500/50 dark:border-green-700/50"><CardHeader className="pb-2"><CardDescription>Passed</CardDescription><CardTitle className={`text-4xl ${getStatusColor('passed')}`}>{keyMetrics.passedTests}</CardTitle></CardHeader><CardContent><Progress value={keyMetrics.passRate} className="[&>div]:bg-green-500" /><p className="text-xs text-muted-foreground mt-1">{keyMetrics.passRate.toFixed(2)}% Pass Rate</p></CardContent></Card>
            <Card className="border-red-500/50 dark:border-red-700/50"><CardHeader className="pb-2"><CardDescription>Failed</CardDescription><CardTitle className={`text-4xl ${getStatusColor('failed')}`}>{keyMetrics.failedTests}</CardTitle></CardHeader><CardContent><Progress value={keyMetrics.totalTests > 0 ? (keyMetrics.failedTests/keyMetrics.totalTests)*100 : 0} className="[&>div]:bg-red-500" /><p className="text-xs text-muted-foreground mt-1">{keyMetrics.totalTests > 0 ? ((keyMetrics.failedTests/keyMetrics.totalTests)*100).toFixed(2) : '0.00'}% Failure Rate</p></CardContent></Card>
            <Card className="border-yellow-500/50 dark:border-yellow-600/50"><CardHeader className="pb-2"><CardDescription>Skipped / Avg. Test Time</CardDescription><div className="flex justify-between items-baseline"><CardTitle className={`text-4xl ${getStatusColor('skipped')}`}>{keyMetrics.skippedTests}</CardTitle><span className="text-sm text-muted-foreground">{formatDuration(keyMetrics.averageTimePerTestMs)}/test</span></div></CardHeader><CardContent><Progress value={keyMetrics.totalTests > 0 ? (keyMetrics.skippedTests/keyMetrics.totalTests)*100 : 0} className="[&>div]:bg-yellow-500" /><p className="text-xs text-muted-foreground mt-1">Sum of test durations: {formatDuration(keyMetrics.totalTestCasesDurationMs)}</p></CardContent></Card>
        </div>

        {/* Charts (content remains the same) */}
        <Card><CardHeader><CardTitle>Visualizations</CardTitle></CardHeader><CardContent className="flex flex-col md:flex-row flex-wrap gap-4"><PlaceholderChart title="Pass/Fail/Skipped Distribution" data={charts.passFailSkippedDistribution} /><PlaceholderChart title="Distribution by Priority" data={charts.priorityDistribution} /><PlaceholderChart title="Distribution by Severity" data={charts.severityDistribution} /></CardContent></Card>

        {/* Filters (content remains the same) */}
        <Card><CardHeader><CardTitle className="flex items-center"><ListFilter className="mr-2 h-5 w-5" /> Filters</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-4">
            <Button variant="outline" size="sm" onClick={() => console.log("Filter by Component clicked")}>Component: All</Button>
            <Button variant="outline" size="sm" onClick={() => console.log("Filter by Severity clicked")}>Severity: All</Button>
            <Button variant="outline" size="sm" onClick={() => console.log("Filter by Outcome clicked")}>Outcome: All</Button>
        </CardContent></Card>

        {/* Failed Tests Table (content remains the same) */}
        {failedTestDetails.length > 0 && (<Card className="border-destructive"><CardHeader><CardTitle className={`${getStatusColor('failed')}`}>Failed Tests ({failedTestDetails.length})</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="min-w-[200px]">Test Name</TableHead><TableHead className="min-w-[250px]">Reason for Failure</TableHead><TableHead>Component</TableHead><TableHead>Priority</TableHead><TableHead>Severity</TableHead><TableHead>Duration</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{failedTestDetails.map((test) => (<TableRow key={test.id}><TableCell className="font-medium py-2">{test.testName}</TableCell><TableCell className="text-xs max-w-xs truncate py-2" title={test.reasonForFailure || undefined}>{test.reasonForFailure || 'No reason provided'}</TableCell><TableCell className="py-2"><Badge variant="outline" className="whitespace-nowrap">{test.component || 'N/A'}</Badge></TableCell><TableCell className="py-2"><Badge variant={test.priority === 'Critical' || test.priority === 'High' ? 'destructive' : 'secondary'} className="whitespace-nowrap">{test.priority || 'N/A'}</Badge></TableCell><TableCell className="py-2"><Badge variant={test.severity === 'Blocker' || test.severity === 'Critical' ? 'destructive' : 'secondary'} className="whitespace-nowrap">{test.severity || 'N/A'}</Badge></TableCell><TableCell className="py-2 whitespace-nowrap">{formatDuration(test.durationMs)}</TableCell><TableCell className="py-2 space-x-1">{test.screenshotUrl && <Button variant="ghost" size="icon-xs" asChild><a href={test.screenshotUrl} target="_blank" rel="noreferrer" title="View Screenshot"><ImageIcon className="h-4 w-4" /></a></Button>}{test.detailedLog && <Button variant="ghost" size="icon-xs" title="View Logs (Placeholder)"><FileText className="h-4 w-4" /></Button>}</TableCell></TableRow>))}</TableBody></Table></CardContent></Card>)}

        {/* Accordion (content remains the same) */}
        <Card><CardHeader><CardTitle>Test Case Results by Module</CardTitle></CardHeader><CardContent>{Object.keys(testGroupings).length === 0 && <p className="text-muted-foreground">No test results to display by module.</p>}<Accordion type="single" collapsible className="w-full">{Object.entries(testGroupings).map(([moduleName, moduleData]) => (<AccordionItem value={moduleName} key={moduleName} className="border-b dark:border-slate-700"><AccordionTrigger className="hover:bg-muted/50 dark:hover:bg-slate-800/50 px-2 py-3 rounded-md"><div className="flex justify-between w-full items-center"><span className="font-semibold">{moduleName}</span><div className="flex items-center space-x-3 text-sm mr-2"><span className={`${getStatusColor('passed')} flex items-center`}><CheckCircle2 className="mr-1 h-4 w-4"/> {moduleData.passed}</span><span className={`${getStatusColor('failed')} flex items-center`}><XCircle className="mr-1 h-4 w-4"/> {moduleData.failed}</span><span className={`${getStatusColor('skipped')} flex items-center`}><SkipForward className="mr-1 h-4 w-4"/> {moduleData.skipped}</span><Badge variant="secondary" className="whitespace-nowrap">Total: {moduleData.total}</Badge></div></div></AccordionTrigger><AccordionContent className="pt-2 pb-0 pl-2 pr-1">{Object.keys(moduleData.components).length === 0 && <p className="text-muted-foreground px-4 py-2">No components in this module.</p>}<Accordion type="multiple" collapsible className="w-full space-y-1">{Object.entries(moduleData.components).map(([componentName, componentData]) => (<AccordionItem value={`${moduleName}-${componentName}`} key={`${moduleName}-${componentName}`} className="border rounded-md dark:border-slate-700 bg-background dark:bg-slate-900"><AccordionTrigger className="hover:bg-muted/30 dark:hover:bg-slate-800/30 px-3 py-2 text-sm rounded-t-md group"><div className="flex justify-between w-full items-center"><span className="flex items-center"><ChevronRight className="h-4 w-4 mr-1 group-data-[state=open]:rotate-90 transition-transform" />{componentName}</span><div className="flex items-center space-x-2 text-xs mr-2"><span className={`${getStatusColor('passed')} flex items-center`}><CheckCircle2 className="mr-1 h-3 w-3"/> {componentData.passed}</span><span className={`${getStatusColor('failed')} flex items-center`}><XCircle className="mr-1 h-3 w-3"/> {componentData.failed}</span><span className={`${getStatusColor('skipped')} flex items-center`}><SkipForward className="mr-1 h-3 w-3"/> {componentData.skipped}</span><Badge variant="outline" className="whitespace-nowrap">Total: {componentData.total}</Badge></div></div></AccordionTrigger><AccordionContent className="px-0 pb-0 border-t dark:border-slate-700">{componentData.tests.length === 0 && <p className="text-muted-foreground px-4 py-2">No tests in this component.</p>}{componentData.tests.length > 0 && <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="pl-4 min-w-[200px]">Test Name</TableHead><TableHead>Status</TableHead><TableHead>Duration</TableHead><TableHead>Priority</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{componentData.tests.map((test) => (<TableRow key={test.id} className="dark:hover:bg-slate-800/50 hover:bg-muted/50"><TableCell className="font-medium py-2 pl-4">{test.testName}</TableCell><TableCell className={`py-2 ${getStatusColor(test.status)}`}><div className="flex items-center">{getStatusIcon(test.status, "h-4 w-4")}<span className="ml-2">{test.status}</span></div></TableCell><TableCell className="py-2 whitespace-nowrap">{formatDuration(test.durationMs)}</TableCell><TableCell className="py-2"><Badge variant={test.priority === 'Critical' || test.priority === 'High' ? 'destructive' : 'secondary'} className="whitespace-nowrap">{test.priority || 'N/A'}</Badge></TableCell><TableCell className="py-2 space-x-1">{test.screenshotUrl && <Button variant="ghost" size="icon-xs" asChild><a href={test.screenshotUrl} target="_blank" rel="noreferrer" title="View Screenshot"><ImageIcon className="h-4 w-4" /></a></Button>}{test.detailedLog && <Button variant="ghost" size="icon-xs" title="View Details/Logs (Placeholder)"><FileText className="h-4 w-4" /></Button>}</TableCell></TableRow>))}</TableBody></Table></div>}</AccordionContent></AccordionItem>))}</Accordion></AccordionContent></AccordionItem>))}</Accordion></CardContent></Card>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`bg-card text-card-foreground border-r border-border shrink-0 flex flex-col transition-all duration-300 ease-in-out ${
          isSidebarCollapsed ? 'w-20 p-2' : 'w-64 p-4'
        }`}
      >
        <div>
          <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'} p-1 mb-2 h-12`}>
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
              className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              {isSidebarCollapsed ? <PanelRightClose size={20} /> : <PanelLeftClose size={20} />}
            </Button>
          </div>
          <nav className={isSidebarCollapsed ? "mt-2" : "mt-0"}>
            <ul className="space-y-1">
              <li><Link href="/dashboard" title={t('nav.dashboard')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isDashboardActive ? activeLinkStyle : inactiveLinkStyle}`}><Home className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.dashboard')}</span>}</Link></li>
              <li><Link href="/dashboard/api-tester" title={t('nav.apiTester', 'API Tester')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isApiTesterActive ? activeLinkStyle : inactiveLinkStyle}`}><Network className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.apiTester', 'API Tester')}</span>}</Link></li>
              <li><Link href="/dashboard/create-test" title={t('nav.createTest')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isCreateTestActive ? activeLinkStyle : inactiveLinkStyle}`}><PlusSquare className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.createTest')}</span>}</Link></li>
              <li><Link href="/test-suites" title={t('nav.suites')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isSuitesActive ? activeLinkStyle : inactiveLinkStyle}`}><SuitesIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.suites')}</span>}</Link></li>
              <li><Link href="/scheduling" title={t('nav.scheduling', 'Scheduling')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isSchedulingActive ? activeLinkStyle : inactiveLinkStyle}`}><CalendarClock className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.scheduling', 'Scheduling')}</span>}</Link></li>
              <li><Link href="/reports" title={t('nav.reports')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${(isReportsActive || isCurrentReportActive) ? activeLinkStyle : inactiveLinkStyle}`}><ReportsIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.reports')}</span>}</Link></li>
              <li><Link href="/settings" title={t('nav.settings')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isSettingsActive ? activeLinkStyle : inactiveLinkStyle}`}><SettingsIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.settings')}</span>}</Link></li>
            </ul>
          </nav>
        </div>
        <div className={`mt-auto pt-4 border-t border-border ${isSidebarCollapsed ? 'px-0' : 'px-3'}`}>
          {user ? (isSidebarCollapsed ? <div className="flex justify-center items-center py-2" title={user.username}><UserCircle className="h-7 w-7 text-muted-foreground" /></div> : (<><p className="text-sm font-semibold text-foreground truncate">{user.username}</p><p className="text-xs text-muted-foreground truncate">{user.email || t('dashboardOverviewPage.noEmailProvided.text')}</p></>)) : (isSidebarCollapsed ? <div className="flex justify-center items-center py-2" title={t('dashboardOverviewPage.userNotLoaded.text')}><UserCircle className="h-7 w-7 text-muted-foreground opacity-50" /></div> : (<><p className="text-sm font-semibold text-muted-foreground">{t('dashboardOverviewPage.userNotLoaded.text')}</p><p className="text-xs text-muted-foreground">...</p></>))}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className={`flex-1 py-6 pr-6 pl-6 md:pl-8 overflow-auto transition-all duration-300 ease-in-out`}>
        {pageContent()}
      </main>
    </div>
  );
};

export default TestReportPage;

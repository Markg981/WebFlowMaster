// client/src/pages/TestReportPage.tsx
import React, { useState } from 'react'; // Removed sidebar-related state
import { useRoute, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { fetchTestExecutionReport } from '@/lib/api/reports';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ExternalLink, Download, Share2, ListFilter, CheckCircle2, XCircle, SkipForward, AlertCircle, Clock,
  ChevronRight, FileText, Image as ImageIcon, RefreshCw, ArrowLeft // Added ArrowLeft
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { useTranslation } from 'react-i18next'; // For potential future use in header

// PlaceholderChart and TestPlanExecutionReport interface remain the same

const PlaceholderChart = ({ title, data }: { title: string, data: any }) => (
  <Card className="flex-1 min-w-[300px]">
    <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
    <CardContent className="h-[200px] flex items-center justify-center">
      <p className="text-sm text-muted-foreground">{data && Object.keys(data).length > 0 ? `Chart placeholder (Data: ${Object.keys(data).length} series)` : "No data for chart"}</p>
    </CardContent>
  </Card>
);

export interface TestPlanExecutionReport {
  header: {
    testSuiteName: string; environment: string; browsers: string[]; dateTime: string;
    completedAt: string | null; status: 'pending' | 'running' | 'completed' | 'failed' | 'error' | 'cancelled';
    triggeredBy: 'scheduled' | 'manual' | 'api'; executionId: string; testPlanId: string;
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
  const [, params] = useRoute<{ planId: string; executionId: string }>("/test-plans/:planId/executions/:executionId/report");
  const executionId = params?.executionId;
  const planId = params?.planId; // Keep planId for back navigation context

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

  // Helper functions (getStatusIcon, getStatusColor, formatDuration) remain the same
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
                {/* Title moved to page header */}
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
             <CardDescription className="mt-1"> {/* Added mt-1 for spacing from title which is now in page header */}
                Execution ID: {header.executionId} (Plan: <Link href={`/test-suites?planId=${header.testPlanId}`} className="underline hover:text-primary">{header.testPlanId}</Link>)
            </CardDescription>
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

  // Determine the back link based on whether planId is available (for context from GeneralReportsPage)
  const backLinkHref = planId ? `/reports?planId=${planId}` : '/reports';


  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Simplified Header */}
      <header className="bg-card border-b border-border px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link href={backLinkHref}>
              <Button variant="ghost" size="icon" aria-label={t('testReportPage.backToReports', 'Back to Reports List')}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <FileText className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-card-foreground truncate max-w-md md:max-w-lg lg:max-w-2xl">
              {t('testReportPage.title', 'Test Report')}: <span className="font-normal text-muted-foreground">{reportData?.header.testSuiteName || executionId}</span>
            </h1>
          </div>
          {/* Optional: Add page-specific actions here if needed, like a global refresh for THIS report */}
           {(reportData?.header?.status === 'running' || reportData?.header?.status === 'pending') && (
                <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                  Refresh Report
                </Button>
            )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto p-4 md:p-6">
        {pageContent()}
      </main>
    </div>
  );
};

export default TestReportPage;

// client/src/pages/TestReportPage.tsx
import React, { useState } from 'react';
import { useRoute, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { fetchTestExecutionReport } from '@/lib/api/reports';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListFilter, CheckCircle2, XCircle, SkipForward, AlertCircle, Clock,
  ChevronRight, FileText, Image as ImageIcon, RefreshCw, ArrowLeft, Video,
  Sparkles,
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { useTranslation } from 'react-i18next'; // For potential future use in header
import StepDetailsDialog, { type ReportStep } from '@/components/reports/StepDetailsDialog';
import IssueCell, { type IssueLinkSummary } from '@/components/reports/IssueCell';
import AttemptsBadge from '@/components/reports/AttemptsBadge';
import QuarantinedBadge from '@/components/reports/QuarantinedBadge';
import ExportRunMenu from '@/components/reports/ExportRunMenu';
import type { NetworkSummary } from '@shared/network';
import { describeCi, type CiContext } from '@shared/ci';
import { mobileSessionUrl } from '@shared/mobile';
import CancelRunButton from '@/components/reports/CancelRunButton';
import ManualResultsCard from '@/components/reports/ManualResultsCard';
import PerformanceResultsCard from '@/components/reports/PerformanceResultsCard';
import PagePerformanceCard from '@/components/reports/PagePerformanceCard';
import PublicationsCard from '@/components/reports/PublicationsCard';
import { BreakdownChart, OutcomeChart } from '@/components/reports/ReportCharts';
import FailureAnalysisDialog, { type AnalysedResult } from '@/components/reports/FailureAnalysisDialog';
import type { FailureAnalysis } from '@shared/failure-analysis';
// One list of "still going" states, shared with the server: 'queued' was missing from this page's own copy.
import { isExecutionInFlight } from '@shared/execution-status';
import CommentsPanel from '@/components/tests/CommentsPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** The filter value that lets every result through. */
const ALL = '__all__';
const NO_FILTERS = { component: ALL, severity: ALL, outcome: ALL };

/** A module's or component's counts, worked out from the tests a filter shows. */
function countsOf(tests: Array<{ status: string }>) {
  return {
    passed: tests.filter((test) => test.status === 'Passed').length,
    failed: tests.filter((test) => test.status === 'Failed').length,
    skipped: tests.filter((test) => test.status === 'Skipped').length,
    total: tests.length,
  };
}

export interface TestPlanExecutionReport {
  header: {
    testSuiteName: string; environment: string; browsers: string[]; dateTime: string;
    completedAt: string | null; status: string;
    triggeredBy: 'scheduled' | 'manual' | 'api'; executionId: string; testPlanId: string;
    /** Which attempt of a scheduled occurrence this run is, out of how many its policy allows. */
    attempt?: number; maxAttempts?: number; runnerId?: string | null;
    firstAttemptId?: string | null;
    nextAttempt?: { id: string; status: string; attempt: number } | null;
    /** Every attempt of this scheduled occurrence, in order, when its policy allows more than one. */
    attempts?: Array<{ id: string; attempt: number; status: string; startedAt: string | null; completedAt: string | null }>;
    /** What the run could not do as asked: a browser on another engine, an OS it could not apply. */
    warnings?: string[];
    /** Why the run ended the way it did, when that was not its tests. */
    failureCode?: string | null; failureMessage?: string | null;
    /** Tests that passed only after being run again. */
    flakyTests?: number;
    /** Failures of tests in quarantine: counted, and not held against the run. */
    quarantinedFailures?: number;
    /** The build, commit and branch that asked for the run, when a pipeline did. */
    ci?: CiContext | null;
    /** When retention removed this run's screenshots, videos and traces. */
    artifactsPurgedAt?: string | null;
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
    id: string; testName: string; browser: string | null; testVersion: number | null;
    attempts?: number;
    quarantined?: boolean;
    reasonForFailure: string | null; screenshotUrl: string | null;
    videoUrl: string | null; traceUrl: string | null;
    harUrl?: string | null; networkSummary?: NetworkSummary | null;
    aiAnalysis?: FailureAnalysis | null;
    steps: ReportStep[];
    detailedLog: string | null; component: string | null; priority: string | null;
    severity: string | null; durationMs: number | null; uiTestId: number | null;
    apiTestId: number | null; testType: 'ui' | 'api' | 'mobile';
  }>;
  testGroupings: Record<string, {
    passed: number; failed: number; skipped: number; total: number;
    components: Record<string, {
      passed: number; failed: number; skipped: number; total: number;
      tests: Array<{
        id: string; testPlanExecutionId: string; uiTestId: number | null; apiTestId: number | null;
        testType: 'ui' | 'api' | 'mobile'; testName: string; browser: string | null; status: 'Passed' | 'Failed' | 'Skipped' | 'Pending' | 'Error';
        attempts?: number;
        quarantined?: boolean;
        videoUrl: string | null; traceUrl: string | null;
        harUrl?: string | null; networkSummary?: NetworkSummary | null;
        steps: ReportStep[];
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
  const [commentsFor, setCommentsFor] = useState<{ id: string; name: string } | null>(null);
  /** The result whose steps are open, if any. */
  /** The failed result whose AI analysis is open, if any. */
  const [analysing, setAnalysing] = useState<AnalysedResult | null>(null);
  /** The report's filters (component, severity, outcome); ALL lets everything through. */
  const [filters, setFilters] = useState(NO_FILTERS);
  const filtersActive = filters.component !== ALL || filters.severity !== ALL || filters.outcome !== ALL;
  const outcomeLabel = (status: string) =>
    ({
      Passed: t('testReportPage.outcome.passed', 'Passed'),
      Failed: t('testReportPage.outcome.failed', 'Failed'),
      Skipped: t('testReportPage.outcome.skipped', 'Skipped'),
      Error: t('testReportPage.outcome.error', 'Error'),
      Pending: t('testReportPage.outcome.pending', 'Waiting'),
    })[status] ?? status;
  const [openedSteps, setOpenedSteps] = useState<{
    testName: string;
    browser: string | null;
    steps: ReportStep[];
    videoUrl?: string | null;
    traceUrl?: string | null;
    harUrl?: string | null;
    network?: NetworkSummary | null;
    sessionUrl?: string | null;
  } | null>(null);
  const { t } = useTranslation();
  const [, params] = useRoute<{ planId: string; executionId: string }>("/test-plans/:planId/executions/:executionId/report");
  const executionId = params?.executionId;
  const planId = params?.planId; // Keep planId for back navigation context

  const { data: reportData, isLoading, error, refetch, isFetching } = useQuery<TestPlanExecutionReport, Error>({
    queryKey: ['testExecutionReport', executionId],
    queryFn: () => {
      if (!executionId) return Promise.reject(new Error("Execution ID is missing"));
      return fetchTestExecutionReport(executionId);
    },
    enabled: !!executionId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return isExecutionInFlight(data?.header?.status) ? 5000 : false;
    },
  });

  /**
   * What this run's failures already are on somebody's board.
   *
   * Includes issues opened by earlier runs of the same failure, which is what keeps the page
   * from offering to file a duplicate of one that was filed last night.
   */
  const { data: issueLinks, refetch: refetchIssues } = useQuery<IssueLinkSummary[], Error>({
    queryKey: ['executionIssues', executionId],
    queryFn: async () => {
      const response = await fetch(`/api/test-plan-executions/${executionId}/issues`);
      if (!response.ok) throw new Error('Could not load the filed issues');
      return response.json();
    },
    enabled: !!executionId,
  });

  const issueFor = (testName: string, browser: string | null | undefined): IssueLinkSummary | undefined =>
    (Array.isArray(issueLinks) ? issueLinks : []).find(
      (link) => link.testName === testName && (link.browser ?? null) === (browser ?? null),
    );

  const fileIssue = async (testCaseResultId: string) => {
    const response = await fetch('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executionId, testCaseResultId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not file the issue');
    await refetchIssues();
  };

  // Helper functions
  const getStatusIcon = (status: string | null | undefined, sizeClass = "h-5 w-5") => {
    if (!status) return <AlertCircle className={`${sizeClass} text-muted-foreground`} />;
    switch (status.toLowerCase()) {
      case 'passed': case 'completed': return <CheckCircle2 className={`${sizeClass} text-success`} />;
      case 'failed': case 'error': return <XCircle className={`${sizeClass} text-destructive`} />;
      case 'skipped': return <SkipForward className={`${sizeClass} text-yellow-500`} />;
      case 'running': case 'pending': case 'queued': return <Clock className={`${sizeClass} text-blue-500 animate-spin`} />;
      case 'cancelled': case 'cancelling': case 'timed_out': return <AlertCircle className={`${sizeClass} text-orange-500`} />;
      default: return <AlertCircle className={`${sizeClass} text-muted-foreground`} />;
    }
  };

  const getStatusColor = (status: string | null | undefined) => {
    if (!status) return "text-muted-foreground";
    switch (status.toLowerCase()) {
      case 'passed': return "text-success";
      case 'completed': return "text-success";
      case 'failed': return "text-destructive";
      case 'error': return "text-destructive";
      case 'skipped': return "text-yellow-600 dark:text-yellow-400";
      case 'running': return "text-blue-600 dark:text-blue-400";
      case 'pending': return "text-blue-600 dark:text-blue-400";
      case 'queued': return "text-blue-600 dark:text-blue-400";
      case 'cancelled': return "text-orange-600 dark:text-orange-400";
      case 'cancelling': return "text-orange-600 dark:text-orange-400";
      case 'timed_out': return "text-orange-600 dark:text-orange-400";
      default: return "text-muted-foreground";
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
    if (isLoading) return <div className="p-6 text-center">{t('testReportPage.loading', "Loading test report...")}</div>;
    if (error) return <div className="p-6 text-destructive text-center">Error loading report: {error.message} <Button onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />{t('testReportPage.retry', "Retry")}</Button></div>;
    if (!reportData) return <div className="p-6 text-center">{t('testReportPage.noData', 'No report data found.')} <Button onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />{t('testReportPage.refresh', "Refresh")}</Button></div>;

    const { header, keyMetrics, charts, failedTestDetails: allFailed, testGroupings: allGroupings } = reportData as TestPlanExecutionReport;

    // What the filters let through. Components and severities come from the results themselves,
    // so a filter never offers a value no result has.
    const allRows = Object.values(allGroupings ?? {}).flatMap((group) => Object.values(group.components ?? {}).flatMap((component) => component.tests ?? []));
    const distinct = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => !!value))].sort();
    const filterOptions = {
      components: distinct(allRows.map((row) => row.component)).map((value) => ({ value, label: value })),
      severities: distinct(allRows.map((row) => row.severity)).map((value) => ({ value, label: value })),
      outcomes: distinct(allRows.map((row) => row.status)).map((value) => ({ value, label: outcomeLabel(value) })),
    };
    const matches = (row: { component: string | null; severity: string | null; status?: string }) =>
      (filters.component === ALL || row.component === filters.component) &&
      (filters.severity === ALL || row.severity === filters.severity) &&
      (filters.outcome === ALL || (row.status ?? 'Failed') === filters.outcome);
    const failedTestDetails = filtersActive ? allFailed.filter((row) => matches({ ...row, status: 'Failed' })) : allFailed;
    // With a filter on, each module's and component's counts are the shown tests', not the run's.
    const testGroupings: typeof allGroupings = !filtersActive
      ? allGroupings
      : Object.fromEntries(
          Object.entries(allGroupings)
            .map(([moduleName, moduleData]) => {
              const components = Object.fromEntries(
                Object.entries(moduleData.components)
                  .map(([name, component]) => {
                    const tests = component.tests.filter(matches);
                    return [name, { ...component, ...countsOf(tests), tests }] as const;
                  })
                  .filter(([, component]) => component.tests.length > 0),
              );
              const tests = Object.values(components).flatMap((component) => component.tests);
              return [moduleName, { ...moduleData, ...countsOf(tests), components }] as const;
            })
            .filter(([, moduleData]) => Object.keys(moduleData.components).length > 0),
        );
    const shownCount = Object.values(testGroupings).reduce((sum, moduleData) => sum + moduleData.total, 0);

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
                {isExecutionInFlight(header.status) && (
                  <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                )}
                <CancelRunButton executionId={header.executionId} status={header.status} onChanged={() => refetch()} />
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/requirements?executionId=${encodeURIComponent(header.executionId)}`}>
                    {t('testReportPage.requirements', 'Requirements covered')}
                  </Link>
                </Button>
                <ExportRunMenu executionId={header.executionId} />
              </div>
            </div>
            <CardDescription className="mt-1"> {/* Added mt-1 for spacing from title which is now in page header */}
              Execution ID: {header.executionId} (Plan: <Link href={`/test-suites?planId=${header.testPlanId}`} className="underline hover:text-primary">{header.testPlanId}</Link>)
            </CardDescription>
            <div className="text-sm text-muted-foreground pt-2 grid grid-cols-1 md:grid-cols-2 gap-x-4">
              <p><strong>{t('testReportPage.header.environment', "Environment:")}</strong> {header.environment || 'N/A'} {header.browsers && header.browsers.length > 0 ? `(${header.browsers.join(', ')})` : ''}</p>
              <p><strong>{t('testReportPage.header.triggeredBy', "Triggered by:")}</strong> {header.triggeredBy || 'N/A'}</p>
              {header.runnerId && <p><strong>{t('runners.ranOn', 'Ran on')}:</strong> <code className="text-xs">{header.runnerId}</code></p>}
              {header.ci && (
                <p data-testid="run-ci">
                  <strong>{t('testReportPage.ci.label', 'Build')}:</strong>{' '}
                  {header.ci.buildUrl ? (
                    <a href={header.ci.buildUrl} target="_blank" rel="noreferrer" className="underline hover:text-primary">{describeCi(header.ci)}</a>
                  ) : (
                    describeCi(header.ci)
                  )}
                </p>
              )}
              <p><strong>{t('testReportPage.header.started', "Started:")}</strong> {new Date(header.dateTime).toLocaleString()}</p>
              {header.completedAt ?
                <p><strong>{t('testReportPage.header.completed', "Completed:")}</strong> {new Date(header.completedAt).toLocaleString()}</p> :
                <p><strong>{t('testReportPage.header.status', "Status:")}</strong> <span className={`font-semibold ${getStatusColor(header.status)}`}>{header.status.toUpperCase()}</span></p>
              }
              {keyMetrics.executionDurationMs !== null && <p><strong>{t('testReportPage.header.totalDuration', "Total Duration:")}</strong> {formatDuration(keyMetrics.executionDurationMs)}</p>}
              {(header.maxAttempts ?? 1) > 1 && (
                <p data-testid="run-attempt">
                  <strong>{t('testReportPage.attempt.label', 'Attempt')}:</strong>{' '}
                  {t('testReportPage.attempt.value', '{{attempt}} of {{max}}', { attempt: header.attempt ?? 1, max: header.maxAttempts })}
                  {header.firstAttemptId && (
                    <> · <Link href={`/test-plans/${header.testPlanId}/executions/${header.firstAttemptId}/report`} className="underline hover:text-primary">{t('testReportPage.attempt.first', 'first attempt')}</Link></>
                  )}
                  {header.nextAttempt && (
                    <> · <Link href={`/test-plans/${header.testPlanId}/executions/${header.nextAttempt.id}/report`} className="underline hover:text-primary">{t('testReportPage.attempt.next', 'attempt {{attempt}} ({{status}})', { attempt: header.nextAttempt.attempt, status: header.nextAttempt.status })}</Link></>
                  )}
                </p>
              )}
              {(header.attempts?.length ?? 0) > 1 && (
                <p data-testid="attempt-history">
                  <strong>{t('testReportPage.attempt.history', 'Attempts')}:</strong>{' '}
                  {header.attempts!.map((a, index) => (
                    <React.Fragment key={a.id}>
                      {index > 0 && ' · '}
                      <Link href={`/test-plans/${header.testPlanId}/executions/${a.id}/report`} className={`underline hover:text-primary ${a.id === header.executionId ? 'font-semibold' : ''}`}>
                        {t('testReportPage.attempt.value', '{{attempt}} of {{max}}', { attempt: a.attempt, max: header.maxAttempts })}
                      </Link>{' '}
                      <span className={getStatusColor(a.status)}>({a.status})</span>
                    </React.Fragment>
                  ))}
                </p>
              )}
            </div>
            {(header.quarantinedFailures ?? 0) > 0 && (
              <p data-testid="quarantined-failures" className="text-sm mt-2 text-muted-foreground">
                {t('testReportPage.quarantinedFailures', '{{count}} of the failures below are of tests in quarantine: they are shown, and did not fail this run.', {
                  count: header.quarantinedFailures,
                })}
              </p>
            )}
            {header.artifactsPurgedAt && (
              <p data-testid="artifacts-purged" className="text-sm mt-2 text-muted-foreground">
                {t('testReportPage.purged', 'Screenshots, videos and traces of this run were removed on {{date}} by the retention policy. Its results are kept.', {
                  date: new Date(header.artifactsPurgedAt).toLocaleDateString(),
                })}
              </p>
            )}
            {(header.warnings?.length ?? 0) > 0 && (
              <div data-testid="run-warnings" className="text-sm mt-2 text-amber-700 dark:text-amber-400">
                <strong>{t('testReportPage.warnings', 'Not applied as configured')}:</strong>
                <ul className="list-disc ml-5">
                  {header.warnings!.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}
            {header.failureMessage && ['cancelled', 'cancelling', 'timed_out', 'error'].includes(header.status) && (
              <p data-testid="run-ending" className={`text-sm mt-2 ${getStatusColor(header.status)}`}>
                <strong>{header.status === 'timed_out' ? t('testReportPage.ending.timedOut', 'Timed out') : header.status === 'error' ? t('testReportPage.ending.error', 'Did not finish') : t('testReportPage.ending.cancelled', 'Cancelled')}:</strong>{' '}
                {header.failureMessage}
              </p>
            )}
          </CardHeader>
        </Card>

        {/* Key Metrics Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card><CardHeader className="pb-2"><CardDescription>{t('testReportPage.metrics.total', "Total Tests")}</CardDescription><CardTitle className="text-4xl">{keyMetrics.totalTests}</CardTitle></CardHeader><CardContent><Progress value={keyMetrics.totalTests > 0 ? 100 : 0} aria-label="Total tests" /></CardContent></Card>
          <Card className="border-success/50"><CardHeader className="pb-2"><CardDescription>{t('testReportPage.metrics.passed', "Passed")}</CardDescription><CardTitle className={`text-4xl ${getStatusColor('passed')}`}>{keyMetrics.passedTests}</CardTitle></CardHeader><CardContent><Progress value={keyMetrics.passRate} className="[&>div]:bg-success" /><p className="text-xs text-muted-foreground mt-1">{keyMetrics.passRate.toFixed(2)}% {t('testReportPage.metrics.passRate', 'Pass Rate')}</p>{(header.flakyTests ?? 0) > 0 && <p data-testid="flaky-count" className="text-xs text-amber-700 dark:text-amber-400 mt-1">{t('testReportPage.flaky.count', '{{count}} passed only on a later attempt', { count: header.flakyTests })}</p>}</CardContent></Card>
          <Card className="border-destructive/50"><CardHeader className="pb-2"><CardDescription>{t('testReportPage.metrics.failed', "Failed")}</CardDescription><CardTitle className={`text-4xl ${getStatusColor('failed')}`}>{keyMetrics.failedTests}</CardTitle></CardHeader><CardContent><Progress value={keyMetrics.totalTests > 0 ? (keyMetrics.failedTests / keyMetrics.totalTests) * 100 : 0} className="[&>div]:bg-destructive" /><p className="text-xs text-muted-foreground mt-1">{keyMetrics.totalTests > 0 ? ((keyMetrics.failedTests / keyMetrics.totalTests) * 100).toFixed(2) : '0.00'}% {t('testReportPage.metrics.failureRate', 'Failure Rate')}</p></CardContent></Card>
          <Card className="border-yellow-500/50 dark:border-yellow-600/50"><CardHeader className="pb-2"><CardDescription>{t('testReportPage.metrics.skippedAndAverage', "Skipped / Avg. Test Time")}</CardDescription><div className="flex justify-between items-baseline"><CardTitle className={`text-4xl ${getStatusColor('skipped')}`}>{keyMetrics.skippedTests}</CardTitle><span className="text-sm text-muted-foreground">{formatDuration(keyMetrics.averageTimePerTestMs)}/test</span></div></CardHeader><CardContent><Progress value={keyMetrics.totalTests > 0 ? (keyMetrics.skippedTests / keyMetrics.totalTests) * 100 : 0} className="[&>div]:bg-yellow-500" /><p className="text-xs text-muted-foreground mt-1">Sum of test durations: {formatDuration(keyMetrics.totalTestCasesDurationMs)}</p></CardContent></Card>
        </div>

        {/* Charts */}
        <Card><CardHeader><CardTitle>{t('testReportPage.visualizations', "Visualizations")}</CardTitle></CardHeader><CardContent className="flex flex-col md:flex-row flex-wrap gap-4"><OutcomeChart title={t('testReportPage.charts.outcome', 'Passed, failed and skipped')} counts={charts.passFailSkippedDistribution} /><BreakdownChart title={t('testReportPage.charts.priority', 'By priority')} data={charts.priorityDistribution} /><BreakdownChart title={t('testReportPage.charts.severity', 'By severity')} data={charts.severityDistribution} /></CardContent></Card>

        {/* Filters */}
        <Card><CardHeader><CardTitle className="flex items-center"><ListFilter className="mr-2 h-5 w-5" /> {t('testReportPage.filters.title', 'Filters')}</CardTitle></CardHeader><CardContent className="flex flex-wrap items-end gap-4">
          {([
            ['component', t('testReportPage.filters.component', 'Component'), filterOptions.components],
            ['severity', t('testReportPage.filters.severity', 'Severity'), filterOptions.severities],
            ['outcome', t('testReportPage.filters.outcome', 'Outcome'), filterOptions.outcomes],
          ] as const).map(([key, label, options]) => (
            <label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">
              {label}
              <select
                className="h-9 min-w-[160px] rounded-md border border-input bg-background px-2 text-sm text-foreground"
                value={filters[key]}
                onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))}
              >
                <option value={ALL}>{t('testReportPage.filters.all', 'All')}</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          ))}
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={() => setFilters(NO_FILTERS)}>
              {t('testReportPage.filters.clear', 'Clear filters')}
            </Button>
          )}
          {filtersActive && (
            <p className="text-xs text-muted-foreground" role="status">
              {t('testReportPage.filters.showing', 'Showing {{shown}} of {{total}} results.', { shown: shownCount, total: allRows.length })}
            </p>
          )}
        </CardContent></Card>

        {/* Failed Tests Table */}
        <ManualResultsCard
          executionId={header.executionId}
          runStatus={header.status}
          rows={Object.values(testGroupings ?? {}).flatMap((group) => Object.values(group.components ?? {}).flatMap((component) => component.tests ?? []))}
          onRecorded={() => refetch()}
        />
        <PerformanceResultsCard rows={Object.values(testGroupings ?? {}).flatMap((group) => Object.values(group.components ?? {}).flatMap((component) => component.tests ?? []))} />
        <PagePerformanceCard rows={Object.values(testGroupings ?? {}).flatMap((group) => Object.values(group.components ?? {}).flatMap((component) => component.tests ?? []))} />
        <PublicationsCard executionId={header.executionId} runStatus={header.status} />
        {failedTestDetails.length > 0 && (<Card className="border-destructive"><CardHeader><CardTitle className={`${getStatusColor('failed')}`}>{t('testReportPage.failedTests', 'Failed Tests')} ({failedTestDetails.length})</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="min-w-[200px]">{t('testReportPage.columns.testName', "Test Name")}</TableHead><TableHead>{t('testReportPage.columns.browser', "Browser")}</TableHead><TableHead className="min-w-[250px]">{t('testReportPage.columns.reason', "Reason for Failure")}</TableHead><TableHead>{t('testReportPage.columns.component', "Component")}</TableHead><TableHead>{t('testReportPage.columns.priority', "Priority")}</TableHead><TableHead>{t('testReportPage.columns.severity', "Severity")}</TableHead><TableHead>{t('testReportPage.columns.duration', "Duration")}</TableHead><TableHead>{t('testReportPage.columns.issue', "Issue")}</TableHead><TableHead>{t('testReportPage.columns.actions', "Actions")}</TableHead></TableRow></TableHeader><TableBody>{failedTestDetails.map((test) => (<TableRow key={test.id}><TableCell className="font-medium py-2">{test.testName}{test.testVersion != null && <Badge variant="outline" className="ml-2 font-normal" title={t('testReportPage.versionHint', "The version of the test this run used")}>v{test.testVersion}</Badge>}<AttemptsBadge attempts={test.attempts} status="Failed" /><QuarantinedBadge quarantined={test.quarantined} /></TableCell><TableCell className="py-2 whitespace-nowrap text-xs">{test.browser || t('testReportPage.notRecorded', "not recorded")}</TableCell><TableCell className="text-xs max-w-xs truncate py-2" title={test.reasonForFailure || undefined}>{test.reasonForFailure || t('testReportPage.noReason', "No reason provided")}</TableCell><TableCell className="py-2"><Badge variant="outline" className="whitespace-nowrap">{test.component || 'N/A'}</Badge></TableCell><TableCell className="py-2"><Badge variant={test.priority === 'Critical' || test.priority === 'High' ? 'destructive' : 'secondary'} className="whitespace-nowrap">{test.priority || 'N/A'}</Badge></TableCell><TableCell className="py-2"><Badge variant={test.severity === 'Blocker' || test.severity === 'Critical' ? 'destructive' : 'secondary'} className="whitespace-nowrap">{test.severity || 'N/A'}</Badge></TableCell><TableCell className="py-2 whitespace-nowrap">{formatDuration(test.durationMs)}</TableCell><TableCell className="py-2"><IssueCell link={issueFor(test.testName, test.browser)} onFile={() => fileIssue(test.id)} /></TableCell><TableCell className="py-2 space-x-1"><Button variant="ghost" size="sm" onClick={() => setCommentsFor({ id: test.id, name: test.testName })}>{t('comments.title', 'Comments')}</Button>{test.screenshotUrl && <Button variant="ghost" size="sm" asChild><a href={test.screenshotUrl} target="_blank" rel="noreferrer" title={t('testReportPage.actions.screenshot', "View Screenshot")}><ImageIcon className="h-4 w-4" /></a></Button>}{test.videoUrl && <Button variant="ghost" size="sm" asChild><a href={test.videoUrl} target="_blank" rel="noreferrer" title={t('testReportPage.actions.video', "Watch the run")}><Video className="h-4 w-4" /></a></Button>}{test.steps?.length > 0 && <Button variant="ghost" size="sm" title={t('testReportPage.actions.steps', "View steps")} onClick={() => setOpenedSteps({ testName: test.testName, browser: test.browser, steps: test.steps, videoUrl: test.videoUrl, traceUrl: test.traceUrl, harUrl: test.harUrl, network: test.networkSummary, sessionUrl: mobileSessionUrl(test.detailedLog) })}><FileText className="h-4 w-4" /></Button>}<Button variant="ghost" size="sm" title={t('failureAnalysis.open', 'Analyse with AI')} aria-label={t('failureAnalysis.open', 'Analyse with AI')} onClick={() => setAnalysing({ id: test.id, testName: test.testName, browser: test.browser, aiAnalysis: test.aiAnalysis, uiTestId: test.uiTestId, steps: test.steps })}><Sparkles className={`h-4 w-4 ${test.aiAnalysis ? 'text-primary' : ''}`} /></Button></TableCell></TableRow>))}</TableBody></Table></CardContent></Card>)}

        {/* Accordion */}
        <Card><CardHeader><CardTitle>{t('testReportPage.byModule.title', "Test Case Results by Module")}</CardTitle></CardHeader><CardContent>{Object.keys(testGroupings).length === 0 && <p className="text-muted-foreground">{t('testReportPage.byModule.empty', "No test results to display by module.")}</p>}<Accordion type="single" collapsible className="w-full">{Object.entries(testGroupings).map(([moduleName, moduleData]: [string, any]) => (<AccordionItem value={moduleName} key={moduleName} className="border-b dark:border-slate-700"><AccordionTrigger className="hover:bg-muted/50 dark:hover:bg-slate-800/50 px-2 py-3 rounded-md"><div className="flex justify-between w-full items-center"><span className="font-semibold">{moduleName}</span><div className="flex items-center space-x-3 text-sm mr-2"><span className={`${getStatusColor('passed')} flex items-center`}><CheckCircle2 className="mr-1 h-4 w-4" /> {moduleData.passed}</span><span className={`${getStatusColor('failed')} flex items-center`}><XCircle className="mr-1 h-4 w-4" /> {moduleData.failed}</span><span className={`${getStatusColor('skipped')} flex items-center`}><SkipForward className="mr-1 h-4 w-4" /> {moduleData.skipped}</span><Badge variant="secondary" className="whitespace-nowrap">Total: {moduleData.total}</Badge></div></div></AccordionTrigger><AccordionContent className="pt-2 pb-0 pl-2 pr-1">{Object.keys(moduleData.components).length === 0 && <p className="text-muted-foreground px-4 py-2">{t('testReportPage.byModule.noComponents', "No components in this module.")}</p>}<Accordion type="multiple" className="w-full space-y-1">{Object.entries(moduleData.components).map(([componentName, componentData]: [string, any]) => (<AccordionItem value={`${moduleName}-${componentName}`} key={`${moduleName}-${componentName}`} className="border rounded-md dark:border-slate-700 bg-background dark:bg-slate-900"><AccordionTrigger className="hover:bg-muted/30 dark:hover:bg-slate-800/30 px-3 py-2 text-sm rounded-t-md group"><div className="flex justify-between w-full items-center"><span className="flex items-center"><ChevronRight className="h-4 w-4 mr-1 group-data-[state=open]:rotate-90 transition-transform" />{componentName}</span><div className="flex items-center space-x-2 text-xs mr-2"><span className={`${getStatusColor('passed')} flex items-center`}><CheckCircle2 className="mr-1 h-3 w-3" /> {componentData.passed}</span><span className={`${getStatusColor('failed')} flex items-center`}><XCircle className="mr-1 h-3 w-3" /> {componentData.failed}</span><span className={`${getStatusColor('skipped')} flex items-center`}><SkipForward className="mr-1 h-3 w-3" /> {componentData.skipped}</span><Badge variant="outline" className="whitespace-nowrap">Total: {componentData.total}</Badge></div></div></AccordionTrigger><AccordionContent className="px-0 pb-0 border-t dark:border-slate-700">{componentData.tests.length === 0 && <p className="text-muted-foreground px-4 py-2">{t('testReportPage.byModule.noTests', "No tests in this component.")}</p>}{componentData.tests.length > 0 && <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="pl-4 min-w-[200px]">{t('testReportPage.columns.testName', "Test Name")}</TableHead><TableHead>{t('testReportPage.columns.browser', "Browser")}</TableHead><TableHead>{t('testReportPage.columns.status', "Status")}</TableHead><TableHead>{t('testReportPage.columns.duration', "Duration")}</TableHead><TableHead>{t('testReportPage.columns.priority', "Priority")}</TableHead><TableHead>{t('testReportPage.columns.actions', "Actions")}</TableHead></TableRow></TableHeader><TableBody>{componentData.tests.map((test: any) => (<TableRow key={test.id} className="dark:hover:bg-slate-800/50 hover:bg-muted/50"><TableCell className="font-medium py-2 pl-4">{test.testName}<AttemptsBadge attempts={test.attempts} status={test.status} /><QuarantinedBadge quarantined={test.quarantined} /></TableCell><TableCell className="py-2 whitespace-nowrap text-xs">{test.browser || t('testReportPage.notRecorded', "not recorded")}</TableCell><TableCell className={`py-2 ${getStatusColor(test.status)}`}><div className="flex items-center">{getStatusIcon(test.status, "h-4 w-4")}<span className="ml-2">{test.status}</span></div></TableCell><TableCell className="py-2 whitespace-nowrap">{formatDuration(test.durationMs)}</TableCell><TableCell className="py-2"><Badge variant={test.priority === 'Critical' || test.priority === 'High' ? 'destructive' : 'secondary'} className="whitespace-nowrap">{test.priority || 'N/A'}</Badge></TableCell><TableCell className="py-2 space-x-1"><Button variant="ghost" size="sm" onClick={() => setCommentsFor({ id: test.id, name: test.testName })}>{t('comments.title', 'Comments')}</Button>{test.screenshotUrl && <Button variant="ghost" size="sm" asChild><a href={test.screenshotUrl} target="_blank" rel="noreferrer" title={t('testReportPage.actions.screenshot', "View Screenshot")}><ImageIcon className="h-4 w-4" /></a></Button>}{test.videoUrl && <Button variant="ghost" size="sm" asChild><a href={test.videoUrl} target="_blank" rel="noreferrer" title={t('testReportPage.actions.video', "Watch the run")}><Video className="h-4 w-4" /></a></Button>}{test.steps?.length > 0 && <Button variant="ghost" size="sm" title={t('testReportPage.actions.steps', "View steps")} onClick={() => setOpenedSteps({ testName: test.testName, browser: test.browser, steps: test.steps, videoUrl: test.videoUrl, traceUrl: test.traceUrl, harUrl: test.harUrl, network: test.networkSummary, sessionUrl: mobileSessionUrl(test.detailedLog) })}><FileText className="h-4 w-4" /></Button>}</TableCell></TableRow>))}</TableBody></Table></div>}</AccordionContent></AccordionItem>))}</Accordion></AccordionContent></AccordionItem>))}</Accordion></CardContent></Card>
      </div>
    );
  };

  // Determine the back link based on whether planId is available
  const backLinkHref = planId ? `/reports?planId=${planId}` : '/reports';


  return (
    <div className="flex flex-col h-full bg-background text-foreground">
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
          {/* Optional: Add page-specific actions here */}
          {isExecutionInFlight(reportData?.header?.status) && (
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

      {reportData?.header?.executionId && (
        <FailureAnalysisDialog
          executionId={reportData.header.executionId}
          result={analysing}
          onOpenChange={(open) => { if (!open) setAnalysing(null); }}
          onAnalysed={() => refetch()}
        />
      )}

      <StepDetailsDialog
        open={openedSteps !== null}
        onOpenChange={(open) => { if (!open) setOpenedSteps(null); }}
        testName={openedSteps?.testName ?? ''}
        browser={openedSteps?.browser}
        steps={openedSteps?.steps ?? []}
        videoUrl={openedSteps?.videoUrl}
        traceUrl={openedSteps?.traceUrl}
        harUrl={openedSteps?.harUrl}
        network={openedSteps?.network}
        sessionUrl={openedSteps?.sessionUrl}
      />
      <Dialog open={commentsFor !== null} onOpenChange={open => { if (!open) setCommentsFor(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{commentsFor?.name}</DialogTitle></DialogHeader>
          {commentsFor && <CommentsPanel key={commentsFor.id} kind="result" targetId={commentsFor.id} />}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TestReportPage;

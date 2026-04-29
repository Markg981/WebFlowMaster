import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle, XCircle, Loader2, PlayCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress'; // Using shadcn progress bar
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion } from 'framer-motion';
import { ExecutionLogConsole } from '@/components/ExecutionLogConsole';
import type { TestPlan, ApiTest } from '@shared/schema'; // Import relevant types
import { fetchTestPlanByIdAPI } from '@/lib/api/test-plans';
import { apiRequest } from '@/lib/queryClient';

// Mock API for fetching test plan details (replace with actual API call)
const fetchTestPlanDetails = async (planId: string): Promise<TestPlan & { tests: ApiTest[] }> => {
  console.log(`Fetching details for planId: ${planId}`);
  await new Promise(resolve => setTimeout(resolve, 500));

  // Example: Find the plan from a predefined list or mock data source
  // For now, returning a more detailed mock structure
  const mockPlansWithTests: (TestPlan & { tests: any[] })[] = [
    {
      id: 'plan-123',
      name: 'Login and Signup Flow',
      description: 'End-to-end tests for user authentication.',
      userId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      testMachinesConfig: null,
      captureScreenshots: null,
      visualTestingEnabled: false,
      pageLoadTimeout: null,
      elementTimeout: null,
      onMajorStepFailure: null,
      onAbortedTestCase: null,
      onTestSuitePreRequisiteFailure: null,
      onTestCasePreRequisiteFailure: null,
      onTestStepPreRequisiteFailure: null,
      reRunOnFailure: null,
      notificationSettings: null,
      tests: [
        { id: 1, name: 'Test User Login Valid Credentials', method: 'POST', url: '/api/auth/login', headers: {}, body: '{"email":"test@example.com", "password":"password"}', expectedStatusCode: 200, projectId: null, createdAt: new Date(), updatedAt: new Date(), assertions: [] },
        { id: 2, name: 'Test User Login Invalid Credentials', method: 'POST', url: '/api/auth/login', headers: {}, body: '{"email":"test@example.com", "password":"wrongpassword"}', expectedStatusCode: 401, projectId: null, createdAt: new Date(), updatedAt: new Date(), assertions: [] },
        { id: 3, name: 'Test User Signup New Account', method: 'POST', url: '/api/auth/signup', headers: {}, body: '{"email":"newuser@example.com", "password":"newpassword", "name":"New User"}', expectedStatusCode: 201, projectId: null, createdAt: new Date(), updatedAt: new Date(), assertions: [] },
      ]
    },
  ];

  const plan = mockPlansWithTests.find(p => p.id === planId);
  if (!plan) {
    throw new Error('Test plan not found');
  }
  return plan;
};


// Mock type for individual test status
type TestStatus = 'pending' | 'running' | 'passed' | 'failed';

interface TestExecutionState extends ApiTest {
  status: TestStatus;
  duration?: number; // in milliseconds
}

const TestPlanExecutionPage: React.FC = () => {
  const { t } = useTranslation();
  const params = useParams<{ planId: string; runId?: string }>(); // runId could be passed if resuming/viewing a specific run
  const planId = params.planId;
  // const runId = params.runId; // If we want to view specific run details later

  const [testStatuses, setTestStatuses] = useState<Record<number, TestExecutionState>>({});
  const [overallProgress, setOverallProgress] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null); // Stores the ID of the current execution run
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>("none");

  const { data: environments = [] } = useQuery({
    queryKey: ['environments'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/environments');
      return res.json();
    }
  });

  const { data: testPlanData, isLoading: isLoadingPlan, error: planError } = useQuery({
    queryKey: ['testPlanDetails', planId],
    queryFn: () => fetchTestPlanDetails(planId!), // Using mock for now
    enabled: !!planId,
  });

  // Initialize test statuses once plan data is loaded
  useEffect(() => {
    if (testPlanData?.tests) {
      const initialStatuses: Record<number, TestExecutionState> = {};
      testPlanData.tests.forEach(test => {
        initialStatuses[test.id] = { ...test, status: 'pending' };
      });
      setTestStatuses(initialStatuses);
      setOverallProgress(0); // Reset progress
    }
  }, [testPlanData]);



  const testsToRun = useMemo(() => testPlanData?.tests || [], [testPlanData]);

  const executePlan = async () => {
    if (isExecuting) return;

    setIsExecuting(true);

    try {
      const payload: any = {};
      if (selectedEnvironment && selectedEnvironment !== 'none') {
        payload.environmentId = parseInt(selectedEnvironment);
      }

      const res = await apiRequest('POST', `/api/run-test-plan/${planId}`, payload);
      const data = await res.json();

      if (data.success && data.data) {
        setCurrentRunId(data.data.id);
        
        // Initialize test statuses to 'running' for the UI tests list
        const initialStatuses: Record<string, TestExecutionState> = {};
        testPlanData?.tests.forEach(test => {
          initialStatuses[test.id] = { ...test, status: 'running' };
        });
        setTestStatuses(initialStatuses);
      } else {
        throw new Error(data.error || "Execution failed");
      }
    } catch (e: any) {
      console.error('Execution failed:', e);
      setIsExecuting(false);
    }
  };
  // END REAL EXECUTION LOGIC

  const getStatusIcon = (status: TestStatus) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-5 w-5 text-gray-400" />;
      case 'running':
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
      case 'passed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return null;
    }
  };

  if (isLoadingPlan) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-lg">{t('testPlanExecutionPage.loadingPlan.text')}</p>
      </div>
    );
  }

  if (planError) {
    return (
      <div className="flex flex-col justify-center items-center h-screen text-red-500">
        <XCircle className="h-12 w-12 mb-4" />
        <p className="text-lg">{t('testPlanExecutionPage.errorLoadingPlan.text')}: {(planError as Error).message}</p>
        <Button variant="link" asChild className="mt-4">
          <Link href="/test-suites">{t('testPlanExecutionPage.backToTestSuites.button')}</Link>
        </Button>
      </div>
    );
  }

  if (!testPlanData) {
    return (
      <div className="flex flex-col justify-center items-center h-screen">
        <p className="text-lg">{t('testPlanExecutionPage.planNotFound.text')}</p>
        <Button variant="link" asChild className="mt-4">
          <Link href="/test-suites">{t('testPlanExecutionPage.backToTestSuites.button')}</Link>
        </Button>
      </div>
    );
  }

  const completedTestsCount = Object.values(testStatuses).filter(t => t.status === 'passed' || t.status === 'failed').length;
  const passedTestsCount = Object.values(testStatuses).filter(t => t.status === 'passed').length;
  const failedTestsCount = Object.values(testStatuses).filter(t => t.status === 'failed').length;


  return (
    <div className="flex flex-col h-screen bg-muted/40">
      <header className="bg-background border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/test-suites">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <PlayCircle className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                {testPlanData.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('testPlanExecutionPage.runningTestPlan.text')}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <Select value={selectedEnvironment} onValueChange={setSelectedEnvironment}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select Environment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Environment</SelectItem>
                {environments.map((env: any) => (
                  <SelectItem key={env.id} value={env.id.toString()}>{env.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={executePlan}
              disabled={isExecuting || !testsToRun.length}
              className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded-md flex items-center space-x-2"
            >
              {isExecuting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <PlayCircle className="h-5 w-5" />
              )}
              <span>
                {isExecuting
                  ? t('testPlanExecutionPage.running.button')
                  : completedTestsCount > 0 && completedTestsCount === testsToRun.length
                    ? t('testPlanExecutionPage.runAgain.button')
                    : t('testPlanExecutionPage.startExecution.button')}
              </span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 overflow-auto grid md:grid-cols-3 gap-6">
        {/* Left Column: Test List & Progress */}
        <div className="md:col-span-2 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('testPlanExecutionPage.overallProgress.title')}</CardTitle>
              <CardDescription>
                {t('testPlanExecutionPage.overallProgress.description', { completed: completedTestsCount, total: testsToRun.length })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Progress value={overallProgress} className="w-full h-3" />
              <div className="flex justify-between text-sm mt-2">
                <span>{t('testPlanExecutionPage.status.passed')}: {passedTestsCount}</span>
                <span>{t('testPlanExecutionPage.status.failed')}: {failedTestsCount}</span>
                <span>{t('testPlanExecutionPage.status.pending')}: {testsToRun.length - completedTestsCount}</span>
              </div>
              {currentRunId && !isExecuting && completedTestsCount === testsToRun.length && (
                <CardFooter className="pt-4">
                  <Button asChild variant="default" className="w-full">
                    <Link href={`/test-plans/${planId}/executions/${currentRunId}/report`}>
                      {t('testPlanExecutionPage.viewDetailedReport.button')}
                    </Link>
                  </Button>
                </CardFooter>
              )}
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle>{t('testPlanExecutionPage.tests.title')}</CardTitle>
              <CardDescription>
                {t('testPlanExecutionPage.tests.description', { planName: testPlanData.name })}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {testsToRun.length > 0 ? (
                  testsToRun.map((test, index) => {
                    const testState = testStatuses[test.id] || { ...test, status: 'pending' };
                    return (
                      <motion.div
                        key={test.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: index * 0.1 }}
                        className="p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center space-x-3">
                          {getStatusIcon(testState.status)}
                          <div>
                            <p className="font-medium text-foreground">{test.name}</p>
                            <p className="text-sm text-muted-foreground">{test.url || t('testPlanExecutionPage.noDescription.text')}</p>
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {testState.status === 'running' && t('testPlanExecutionPage.statusLabels.running')}
                          {testState.status === 'passed' && `${t('testPlanExecutionPage.statusLabels.passed')} ${testState.duration ? `(${(testState.duration / 1000).toFixed(2)}s)` : ''}`}
                          {testState.status === 'failed' && `${t('testPlanExecutionPage.statusLabels.failed')} ${testState.duration ? `(${(testState.duration / 1000).toFixed(2)}s)` : ''}`}
                          {testState.status === 'pending' && t('testPlanExecutionPage.statusLabels.pending')}
                        </div>
                      </motion.div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-muted-foreground italic">
                    {t('testPlanExecutionPage.noTestsInPlan.text', 'Nessun test presente in questo piano.')}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Execution Log */}
        <div className="md:col-span-1 h-[calc(100vh-12rem)] min-h-[500px]">
          {currentRunId ? (
            <ExecutionLogConsole executionId={currentRunId} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-500 font-mono text-xs italic">
              {t('testPlanExecutionPage.logs.waitingForExecution', 'In attesa di esecuzione...')}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default TestPlanExecutionPage;

// Helper function to format duration (optional, can be done inline)
// const formatDuration = (ms: number) => {
//   if (ms < 1000) return `${ms}ms`;
//   return `${(ms / 1000).toFixed(2)}s`;
// };

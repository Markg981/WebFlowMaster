import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle, XCircle, Loader2, PlayCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress'; // Using shadcn progress bar
import { Separator } from '@/components/ui/separator';
import type { TestPlan, ApiTest, TestPlanRun, TestRun } from '@shared/schema'; // Import relevant types
import { fetchTestPlanDetailsAPI, fetchTestPlanRunDetailsAPI } from '@/lib/api/test-plans'; // Placeholder for actual API

// Mock API for fetching test plan details (replace with actual API call)
const fetchTestPlanDetails = async (planId: string): Promise<TestPlan & { tests: ApiTest[] }> => {
  // This is a mock. In reality, you'd fetch this from your backend.
  // The backend would need an endpoint like /api/test-plans/:planId/details
  // which returns the plan and its associated tests.
  console.log(`Fetching details for planId: ${planId}`);
  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 500));

  // Example: Find the plan from a predefined list or mock data source
  // For now, returning a more detailed mock structure
  const mockPlansWithTests: (TestPlan & { tests: ApiTest[] })[] = [
    {
      id: 'plan-123',
      name: 'Login and Signup Flow',
      description: 'End-to-end tests for user authentication.',
      projectId: 'proj-abc',
      testIds: ['test-001', 'test-002', 'test-003'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tests: [
        { id: 'test-001', name: 'Test User Login Valid Credentials', description: 'Login with correct email and password.', method: 'POST', url: '/api/auth/login', headers: {}, body: '{"email":"test@example.com", "password":"password"}', expectedStatusCode: 200, projectId: 'proj-abc', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), assertions: [] },
        { id: 'test-002', name: 'Test User Login Invalid Credentials', description: 'Login with incorrect password.', method: 'POST', url: '/api/auth/login', headers: {}, body: '{"email":"test@example.com", "password":"wrongpassword"}', expectedStatusCode: 401, projectId: 'proj-abc', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), assertions: [] },
        { id: 'test-003', name: 'Test User Signup New Account', description: 'Create a new user account.', method: 'POST', url: '/api/auth/signup', headers: {}, body: '{"email":"newuser@example.com", "password":"newpassword", "name":"New User"}', expectedStatusCode: 201, projectId: 'proj-abc', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), assertions: [] },
      ]
    },
    // Add more mock plans if needed
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

  const [executionLog, setExecutionLog] = useState<string[]>([]);
  const [testStatuses, setTestStatuses] = useState<Record<string, TestExecutionState>>({});
  const [overallProgress, setOverallProgress] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null); // Stores the ID of the current execution run

  const { data: testPlanData, isLoading: isLoadingPlan, error: planError } = useQuery({
    queryKey: ['testPlanDetails', planId],
    queryFn: () => fetchTestPlanDetails(planId!), // Using mock for now
    enabled: !!planId,
  });

  // Initialize test statuses once plan data is loaded
  useEffect(() => {
    if (testPlanData?.tests) {
      const initialStatuses: Record<string, TestExecutionState> = {};
      testPlanData.tests.forEach(test => {
        initialStatuses[test.id] = { ...test, status: 'pending' };
      });
      setTestStatuses(initialStatuses);
      setOverallProgress(0); // Reset progress
    }
  }, [testPlanData]);

  const testsToRun = useMemo(() => testPlanData?.tests || [], [testPlanData]);

  // MOCK EXECUTION LOGIC
  const simulateTestExecution = async () => {
    if (!testsToRun.length || isExecuting) return;

    setIsExecuting(true);
    setExecutionLog([t('testPlanExecutionPage.logs.startingExecution', { planName: testPlanData?.name })]);
    // Mock: "Start" the plan run and get a runId (in a real scenario, an API call would do this)
    const newRunId = `run-${Date.now()}`;
    setCurrentRunId(newRunId);


    let completedTests = 0;

    for (const test of testsToRun) {
      setTestStatuses(prev => ({
        ...prev,
        [test.id]: { ...prev[test.id], status: 'running' },
      }));
      setExecutionLog(prev => [...prev, t('testPlanExecutionPage.logs.runningTest', { testName: test.name })]);

      const startTime = Date.now();
      // Simulate test duration
      const duration = Math.random() * (2000 - 500) + 500; // 0.5 to 2 seconds
      await new Promise(resolve => setTimeout(resolve, duration));
      const endTime = Date.now();

      // Simulate success/failure
      const didPass = Math.random() > 0.2; // 80% chance of passing

      setTestStatuses(prev => ({
        ...prev,
        [test.id]: {
            ...prev[test.id],
            status: didPass ? 'passed' : 'failed',
            duration: endTime - startTime
        },
      }));
      setExecutionLog(prev => [...prev, t('testPlanExecutionPage.logs.testCompleted', { testName: test.name, status: didPass ? 'PASSED' : 'FAILED' })]);

      completedTests++;
      setOverallProgress(Math.round((completedTests / testsToRun.length) * 100));
    }

    setExecutionLog(prev => [...prev, t('testPlanExecutionPage.logs.executionFinished')]);
    setIsExecuting(false);
    // In a real app, you might mark the TestPlanRun as 'completed' here via an API call
  };
  // END MOCK EXECUTION LOGIC

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
          <Button
            onClick={simulateTestExecution}
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
              <ul className="divide-y divide-border">
                {testsToRun.map((test, index) => {
                  const testState = testStatuses[test.id] || { ...test, status: 'pending' };
                  return (
                    <li key={test.id} className="p-4 flex items-center justify-between hover:bg-muted/50">
                      <div className="flex items-center space-x-3">
                        {getStatusIcon(testState.status)}
                        <div>
                          <p className="font-medium text-foreground">{test.name}</p>
                          <p className="text-sm text-muted-foreground">{test.description || t('testPlanExecutionPage.noDescription.text')}</p>
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {testState.status === 'running' && t('testPlanExecutionPage.statusLabels.running')}
                        {testState.status === 'passed' && `${t('testPlanExecutionPage.statusLabels.passed')} ${testState.duration ? `(${(testState.duration / 1000).toFixed(2)}s)` : ''}`}
                        {testState.status === 'failed' && `${t('testPlanExecutionPage.statusLabels.failed')} ${testState.duration ? `(${(testState.duration / 1000).toFixed(2)}s)` : ''}`}
                        {testState.status === 'pending' && t('testPlanExecutionPage.statusLabels.pending')}
                      </div>
                    </li>
                  );
                })}
                {testsToRun.length === 0 && (
                    <li className="p-4 text-center text-muted-foreground">
                        {t('testPlanExecutionPage.noTestsInPlan.text')}
                    </li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Execution Log */}
        <Card className="md:col-span-1 flex flex-col max-h-[calc(100vh-12rem)]"> {/* Adjust max-h as needed */}
          <CardHeader>
            <CardTitle>{t('testPlanExecutionPage.executionLog.title')}</CardTitle>
            <CardDescription>{t('testPlanExecutionPage.executionLog.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-4 space-y-2 text-sm bg-muted rounded-b-md">
            {executionLog.length === 0 && <p className="text-muted-foreground">{t('testPlanExecutionPage.executionLog.noLogsYet.text')}</p>}
            {executionLog.map((log, index) => (
              <p key={index} className="font-mono text-xs leading-relaxed">
                <span className="text-primary mr-2">{`[${new Date().toLocaleTimeString()}]`}</span>
                {log}
              </p>
            ))}
          </CardContent>
        </Card>
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

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, XCircle, Loader2, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ExecutionLogConsole } from '@/components/ExecutionLogConsole';
import { apiRequest, ApiError } from '@/lib/queryClient';
import { fetchTestPlanByIdAPI } from '@/lib/api/test-plans';
import { useAuth } from '@/hooks/use-auth';

/**
 * Starting a run of one plan, and following it.
 *
 * The run is queued on the server (POST /api/run-test-plan/:id) and answered at once; what it does
 * next arrives in the log beside it, and its results in the report the link opens.
 */
const TestPlanExecutionPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { planId } = useParams<{ planId: string }>();
  const canRun = user?.role !== 'viewer';

  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>('none');

  const { data: environments = [] } = useQuery({
    queryKey: ['environments'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/environments');
      return res.json();
    },
  });

  const { data: plan, isLoading: isLoadingPlan, error: planError } = useQuery({
    queryKey: ['testPlan', planId],
    queryFn: () => fetchTestPlanByIdAPI(planId!),
    enabled: !!planId,
  });

  const executePlan = async () => {
    if (isStarting) return;
    setIsStarting(true);
    setStartError(null);
    try {
      const payload: { environmentId?: number } = {};
      if (selectedEnvironment !== 'none') payload.environmentId = parseInt(selectedEnvironment, 10);
      const res = await apiRequest('POST', `/api/run-test-plan/${planId}`, payload);
      const data = await res.json();
      if (!data.success || !data.data) throw new Error(data.error || 'Execution failed');
      setCurrentRunId(data.data.id);
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { error?: string } | null) : null;
      setStartError(body?.error ?? (error as Error).message);
    } finally {
      setIsStarting(false);
    }
  };

  if (isLoadingPlan) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-lg">{t('testPlanExecutionPage.loadingPlan.text')}</p>
      </div>
    );
  }

  if (planError || !plan) {
    return (
      <div className="flex flex-col justify-center items-center h-full text-destructive">
        <XCircle className="h-12 w-12 mb-4" />
        <p className="text-lg">
          {planError
            ? `${t('testPlanExecutionPage.errorLoadingPlan.text')}: ${(planError as Error).message}`
            : t('testPlanExecutionPage.planNotFound.text')}
        </p>
        <Button variant="link" asChild className="mt-4">
          <Link href="/test-suites">{t('testPlanExecutionPage.backToTestSuites.button')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-muted/30">
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
              <h1 className="text-xl font-semibold text-foreground">{plan.name}</h1>
              <p className="text-sm text-muted-foreground">{t('testPlanExecutionPage.runningTestPlan.text')}</p>
            </div>
          </div>
          {canRun && (
            <div className="flex items-center space-x-4">
              <Select value={selectedEnvironment} onValueChange={setSelectedEnvironment}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select Environment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Environment</SelectItem>
                  {environments.map((env: { id: number; name: string }) => (
                    <SelectItem key={env.id} value={env.id.toString()}>{env.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                onClick={executePlan}
                disabled={isStarting}
                className="bg-success hover:bg-success/90 text-white px-6 py-2 rounded-md flex items-center space-x-2"
              >
                {isStarting ? <Loader2 className="h-5 w-5 animate-spin" /> : <PlayCircle className="h-5 w-5" />}
                <span>
                  {isStarting
                    ? t('testPlanExecutionPage.running.button')
                    : currentRunId
                      ? t('testPlanExecutionPage.runAgain.button')
                      : t('testPlanExecutionPage.startExecution.button')}
                </span>
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 p-6 overflow-auto grid md:grid-cols-3 gap-6">
        <div className="md:col-span-1 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              {plan.description && <CardDescription>{plan.description}</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-4">
              {startError && (
                <Alert variant="destructive" data-testid="run-start-error">
                  <AlertDescription>{startError}</AlertDescription>
                </Alert>
              )}
              {currentRunId && (
                <Button asChild variant="default" className="w-full">
                  <Link href={`/test-plans/${planId}/executions/${currentRunId}/report`}>
                    {t('testPlanExecutionPage.viewDetailedReport.button')}
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2 h-[calc(100vh-12rem)] min-h-[500px]">
          {currentRunId ? (
            <ExecutionLogConsole executionId={currentRunId} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-500 font-mono text-xs italic">
              {t('testPlanExecutionPage.logs.waitingForExecution', 'Waiting for the run to start…')}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default TestPlanExecutionPage;

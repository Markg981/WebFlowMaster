import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query'; // Added useQueryClient
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { PlayCircle, Loader2 } from 'lucide-react';

interface TriggerTestRunPayload {
  suiteId: string;
  triggeredBy: string;
  // Potentially add other parameters like environment, specific tests, etc.
}

interface TriggerTestRunResponse {
  success: boolean;
  runId: string;
  message: string;
}

// Mock API function
const triggerTestRun = async (payload: TriggerTestRunPayload): Promise<TriggerTestRunResponse> => {
  console.log('Attempting to trigger test run with payload:', payload);
  await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate network delay

  if (Math.random() > 0.9) { // Simulate a rare error
    console.error('Simulated error: Failed to trigger test run.');
    throw new Error('Failed to trigger test run. Please try again.');
  }

  const response = {
    success: true,
    runId: `run_${Date.now()}_${payload.suiteId.replace(/\s+/g, '_')}`,
    message: `Test suite '${payload.suiteId}' execution started successfully! Run ID: run_${Date.now()}`,
  };
  console.log('Test run triggered successfully:', response);
  return response;
};

const RunTestNowButton: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient(); // For invalidating queries

  const mutation = useMutation<TriggerTestRunResponse, Error, TriggerTestRunPayload>({ // Explicit types
    mutationFn: triggerTestRun,
    onSuccess: (data) => {
      toast({
        title: 'Test Run Started',
        description: data.message,
        variant: 'default', // Assuming 'default' is suitable for success, or use a custom 'success' variant if available
        duration: 5000,
      });
      // Invalidate queries to refetch data that might change after a test run
      queryClient.invalidateQueries({ queryKey: ['testSchedulings'] });
      queryClient.invalidateQueries({ queryKey: ['recentTestRuns'] });
      queryClient.invalidateQueries({ queryKey: ['testStatusSummary'] }); // For pie chart
      queryClient.invalidateQueries({ queryKey: ['testTrends'] }); // For bar chart
      queryClient.invalidateQueries({ queryKey: ['totalTests']}); // For KPI
      queryClient.invalidateQueries({ queryKey: ['successPercentage']}); // For KPI
      queryClient.invalidateQueries({ queryKey: ['avgTestDuration']}); // For KPI
      // Potentially more specific invalidations if needed
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Triggering Test',
        description: error.message || 'An unexpected error occurred. Please check console for details.',
        variant: 'destructive',
        duration: 7000,
      });
      console.error('Error during triggerTestRun mutation:', error);
    },
  });

  const handleRunTest = () => {
    // In a real app, suiteId might come from a selector or context
    mutation.mutate({ suiteId: 'Critical Path Tests', triggeredBy: 'manual_dashboard_button' });
  };

  return (
    <div className="mt-8 text-center"> {/* Added a wrapper for centering and margin */}
      <Button
        onClick={handleRunTest}
        disabled={mutation.isPending}
        size="lg"
        className="px-8 py-6 text-lg" // Custom padding for a larger button feel
      >
        {mutation.isPending ? (
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        ) : (
          <PlayCircle className="mr-2 h-5 w-5" />
        )}
          {t('dashboard.runTestNowButton.eseguiTestOra.button')}
      </Button>
    </div>
  );
};

export default RunTestNowButton;

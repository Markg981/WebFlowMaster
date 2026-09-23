import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';

/**
 * Stops a run that is waiting or running.
 *
 * Asks first: a nightly run cancelled by a stray click is an hour of coverage nobody gets back.
 * A queued run is cancelled at once; a running one is asked to stop and finishes the step it is
 * on, which the button says rather than pretending the run stopped this instant.
 */
export default function CancelRunButton({
  executionId,
  status,
  onChanged,
}: {
  executionId: string;
  status: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  if (status === 'cancelling') {
    return (
      <Button variant="outline" size="sm" disabled>
        <Ban className="mr-2 h-4 w-4 animate-pulse" />
        {t('testReportPage.cancel.stopping', 'Stopping…')}
      </Button>
    );
  }
  if (status !== 'queued' && status !== 'running' && status !== 'pending') return null;

  const cancel = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/test-plan-executions/${executionId}/cancel`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('testReportPage.cancel.failed', 'The run could not be cancelled.'));
      toast({
        title:
          body.status === 'cancelled'
            ? t('testReportPage.cancel.cancelled', 'Run cancelled')
            : t('testReportPage.cancel.requested', 'Stopping the run'),
        description:
          body.status === 'cancelled'
            ? undefined
            : t('testReportPage.cancel.requestedDetail', 'The test in progress finishes its current step; no further test starts.'),
      });
      onChanged();
    } catch (error: any) {
      toast({ title: t('testReportPage.cancel.failed', 'The run could not be cancelled.'), description: error?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy} className="text-destructive">
          <Ban className="mr-2 h-4 w-4" />
          {t('testReportPage.cancel.button', 'Cancel run')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('testReportPage.cancel.confirmTitle', 'Cancel this run?')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              'testReportPage.cancel.confirmBody',
              'Tests that have not started will not run and are reported as skipped. A test in progress stops at its next step. This cannot be undone.',
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('testReportPage.cancel.keep', 'Keep running')}</AlertDialogCancel>
          <AlertDialogAction onClick={cancel}>{t('testReportPage.cancel.confirm', 'Cancel run')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { peakVus, totalDurationSec, type LoadRunStatus } from '@shared/load-test';
import LoadTestDialog, { type LoadTestRow } from '@/components/load-tests/LoadTestDialog';
import LoadRunView, { statusVariant, useLoadRunStatusLabel, type LoadRun } from '@/components/load-tests/LoadRunView';

/**
 * Load tests (shared/load-test.ts): API tests run by virtual users along a profile of stages,
 * apart from plans — a run takes minutes and is meant to stress what the functional tests check.
 */

interface ListedLoadTest extends LoadTestRow {
  lastRun: { id: string; status: LoadRunStatus; startedAt: string } | null;
}

const NO_ENVIRONMENT = 'none';

function RunsDialog({ test, canEdit, onClose, onChanged }: { test: ListedLoadTest | null; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const label = useLoadRunStatusLabel();
  const [environmentId, setEnvironmentId] = useState(NO_ENVIRONMENT);
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  React.useEffect(() => {
    setSelected(test?.lastRun?.id ?? null);
    setEnvironmentId(NO_ENVIRONMENT);
  }, [test?.id]);

  const { data: detail, refetch } = useQuery<LoadTestRow & { runs: LoadRun[] }>({
    queryKey: ['loadTest', test?.id],
    queryFn: async () => {
      const response = await fetch(`/api/load-tests/${test!.id}`, { credentials: 'include' });
      if (!response.ok) throw new Error(t('loadTests.loadFailed', 'Could not load the load tests.'));
      return response.json();
    },
    enabled: test !== null,
  });
  const { data: environments = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['environments'],
    queryFn: async () => {
      const response = await fetch('/api/environments', { credentials: 'include' });
      const rows = response.ok ? await response.json() : [];
      return Array.isArray(rows) ? rows : [];
    },
    enabled: test !== null,
  });

  const start = async () => {
    if (!test) return;
    setStarting(true);
    try {
      const response = await fetch(`/api/load-tests/${test.id}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(environmentId === NO_ENVIRONMENT ? {} : { environmentId: Number(environmentId) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? t('loadTests.startFailed', 'The run did not start.'));
      setSelected(body.id);
      await refetch();
      onChanged();
    } catch (error) {
      toast({ variant: 'destructive', title: (error as Error).message });
    } finally {
      setStarting(false);
    }
  };

  const runs = detail?.runs ?? [];
  const running = runs.some((run) => run.status === 'running');
  return (
    <Dialog open={test !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('loadTests.runsTitle', 'Runs of {{name}}', { name: test?.name ?? '' })}</DialogTitle>
        </DialogHeader>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={environmentId} onValueChange={setEnvironmentId}>
              <SelectTrigger className="w-56" aria-label={t('loadTests.environment', 'Environment')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ENVIRONMENT}>{t('loadTests.noEnvironment', 'No environment')}</SelectItem>
                {environments.map((environment) => <SelectItem key={environment.id} value={String(environment.id)}>{environment.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={() => void start()} disabled={starting || running}>
              <Activity className="mr-1 h-4 w-4" /> {t('loadTests.start', 'Start a run')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('loadTests.startHelp', 'The run is sent from the server, apart from plans. One load test at a time per organization.')}
            </span>
          </div>
        )}
        {runs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {runs.map((run) => (
              <Button key={run.id} size="sm" variant={run.id === selected ? 'secondary' : 'ghost'} onClick={() => setSelected(run.id)}>
                <Badge variant={statusVariant(run.status)} className="mr-2">{label(run.status)}</Badge>
                {new Date(run.startedAt).toLocaleString()}
              </Button>
            ))}
          </div>
        )}
        {selected ? (
          <LoadRunView key={selected} runId={selected} canEdit={canEdit} onFinished={() => { void refetch(); onChanged(); }} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('loadTests.noRuns', 'No run yet.')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

const LoadTestsPage: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = user?.role !== 'viewer';
  const label = useLoadRunStatusLabel();
  const [editing, setEditing] = useState<LoadTestRow | 'new' | null>(null);
  const [runsOf, setRunsOf] = useState<ListedLoadTest | null>(null);
  const [deleting, setDeleting] = useState<ListedLoadTest | null>(null);

  const { data: tests = [], isLoading, error } = useQuery<ListedLoadTest[]>({
    queryKey: ['loadTests', user?.organizationId],
    queryFn: async () => {
      const response = await fetch('/api/load-tests', { credentials: 'include' });
      if (!response.ok) throw new Error(t('loadTests.loadFailed', 'Could not load the load tests.'));
      return response.json();
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['loadTests'] });

  const remove = useMutation({
    mutationFn: async (test: ListedLoadTest) => {
      const response = await fetch(`/api/load-tests/${test.id}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || t('loadTests.deleteFailed', 'The load test was not deleted.'));
    },
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: e.message }),
  });

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <PageHeader
        className="mb-6"
        title={t('loadTests.title', 'Load tests')}
        description={t('loadTests.pageDescription', 'API tests run by virtual users for a duration, with a warm-up, a progressive load and a data row per user. Run apart from plans.')}
        actions={canEdit ? <Button onClick={() => setEditing('new')}><Plus className="mr-1 h-4 w-4" /> {t('loadTests.create', 'New load test')}</Button> : undefined}
      />
      <Card>
        <CardContent className="pt-6">
          {error && <p role="alert">{(error as Error).message}</p>}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('loadTests.loading', 'Loading…')}</p>
          ) : tests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('loadTests.empty', 'No load test yet. One repeats saved API tests: save them in the API Tester first.')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('loadTests.columns.name', 'Load test')}</TableHead>
                  <TableHead>{t('loadTests.columns.scenario', 'Scenario')}</TableHead>
                  <TableHead>{t('loadTests.columns.profile', 'Profile')}</TableHead>
                  <TableHead>{t('loadTests.columns.lastRun', 'Last run')}</TableHead>
                  <TableHead className="text-right">{t('loadTests.columns.actions', 'Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tests.map((test) => (
                  <TableRow key={test.id} data-testid={`load-test-${test.id}`}>
                    <TableCell className="font-medium">{test.name}</TableCell>
                    <TableCell className="text-sm">{t('loadTests.stepCount', '{{count}} API tests', { count: test.steps.length })}</TableCell>
                    <TableCell className="text-sm">
                      {t('loadTests.profileSummary', '{{peak}} users · {{total}} s · warm-up {{warmUp}} s', {
                        peak: peakVus(test.stages),
                        total: totalDurationSec(test.stages),
                        warmUp: test.warmUpSec,
                      })}
                    </TableCell>
                    <TableCell className="text-sm">
                      {test.lastRun ? (
                        <><Badge variant={statusVariant(test.lastRun.status)} className="mr-2">{label(test.lastRun.status)}</Badge>{new Date(test.lastRun.startedAt).toLocaleString()}</>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="space-x-1 whitespace-nowrap text-right">
                      <Button variant="outline" size="sm" onClick={() => setRunsOf(test)} aria-label={t('loadTests.runsFor', 'Runs of {{name}}', { name: test.name })}>
                        <Activity className="h-4 w-4" />
                      </Button>
                      {canEdit && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setEditing(test)} aria-label={t('loadTests.editFor', 'Edit {{name}}', { name: test.name })}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="outline" size="sm" onClick={() => setDeleting(test)} aria-label={t('loadTests.deleteFor', 'Delete {{name}}', { name: test.name })}><Trash2 className="h-4 w-4" /></Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <LoadTestDialog
        isOpen={editing !== null}
        test={editing && editing !== 'new' ? editing : null}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
          toast({ title: t('loadTests.saved', 'Load test saved') });
        }}
      />
      <RunsDialog test={runsOf} canEdit={canEdit} onClose={() => setRunsOf(null)} onChanged={() => void refresh()} />
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('loadTests.deleteTitle', 'Delete {{name}}?', { name: deleting?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('loadTests.deleteBody', 'Its runs go with it. The API tests stay.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('loadTests.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting)}>{t('loadTests.delete', 'Delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default LoadTestsPage;

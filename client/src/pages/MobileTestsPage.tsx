import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Pencil, Play, Plus, ShieldAlert, Shuffle, Trash2 } from 'lucide-react';
import { MOBILE_GRID_PROVIDERS, MOBILE_PLATFORM_LABELS, type MobileRunStatus } from '@shared/mobile';
import MobileTestDialog, { type GridOption, type MobileTestRow } from '@/components/mobile/MobileTestDialog';
import MobileRunDialog from '@/components/mobile/MobileRunDialog';
import TagPicker, { type TagRef } from '@/components/tags/TagPicker';
import QuarantineDialog from '@/components/reports/QuarantineDialog';
import type { QuarantineRow } from '@/components/reports/QuarantinedTestsCard';
import type { FlakySummary } from '@/components/reports/FlakyTestsCard';
import CommentsPanel from '@/components/tests/CommentsPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * Tests of native Android and iOS apps, run on real devices of the organization's BrowserStack
 * or LambdaTest grid (shared/mobile.ts).
 */

interface ListedTest extends MobileTestRow {
  tags?: TagRef[];
  lastRun: { status: MobileRunStatus; createdAt: string } | null;
}

const MobileTestsPage: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = user?.role !== 'viewer';
  const [editing, setEditing] = useState<MobileTestRow | 'new' | null>(null);
  const [running, setRunning] = useState<MobileTestRow | null>(null);
  const [deleting, setDeleting] = useState<MobileTestRow | null>(null);
  const [taggingId, setTaggingId] = useState<number | null>(null);
  const [quarantining, setQuarantining] = useState<MobileTestRow | null>(null);
  const [commentsFor, setCommentsFor] = useState<MobileTestRow | null>(null);

  const { data: tests = [], isLoading } = useQuery<ListedTest[]>({
    queryKey: ['mobileTests'],
    queryFn: async () => {
      const response = await fetch('/api/mobile-tests');
      if (!response.ok) throw new Error(t('mobileTests.loadFailed', 'Could not load the mobile tests.'));
      return response.json();
    },
  });
  const { data: grids = [] } = useQuery<GridOption[]>({
    queryKey: ['browserGrids'],
    queryFn: async () => {
      const response = await fetch('/api/browser-grids');
      const rows = response.ok ? await response.json() : [];
      return Array.isArray(rows) ? rows : [];
    },
  });
  const deviceGrids = grids.filter((grid) => (MOBILE_GRID_PROVIDERS as readonly string[]).includes(grid.provider));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mobileTests'] });

  // Tags as the library has them (migration 0056): what a test is for, and what dynamic suites run.
  const { data: tagsData } = useQuery<TagRef[]>({
    queryKey: ['tags'],
    queryFn: async () => {
      const response = await fetch('/api/tags');
      return response.ok ? response.json() : [];
    },
  });
  const allTags = Array.isArray(tagsData) ? tagsData : [];

  // Quarantine (migration 0058): the same list the reports show, so a release there clears it here.
  const { data: quarantineData } = useQuery<QuarantineRow[]>({
    queryKey: ['quarantine'],
    queryFn: async () => {
      const response = await fetch('/api/quarantine', { credentials: 'include' });
      return response.ok ? response.json() : [];
    },
  });
  // Flaky detection: the same 30-day analysis as Reports' card, so both say the same thing.
  const { data: flakyData } = useQuery<{ items: FlakySummary[] }>({
    queryKey: ['flakyTests', 'all', 30],
    queryFn: async () => {
      const response = await fetch('/api/analytics/flaky?days=30');
      return response.ok ? response.json() : { items: [] };
    },
  });
  // A test can be unstable on more than one device: each one is a line of the hint.
  const unstable = new Map<number, FlakySummary[]>();
  for (const item of Array.isArray(flakyData?.items) ? flakyData!.items : []) {
    if (item.test?.type === 'mobile') unstable.set(item.test.id, [...(unstable.get(item.test.id) ?? []), item]);
  }
  const quarantined = new Map(
    (Array.isArray(quarantineData) ? quarantineData : []).filter((row) => row.testType === 'mobile').map((row) => [row.testId, row]),
  );
  const setTags = async (testId: number, tagIds: string[]) => {
    setTaggingId(testId);
    try {
      const response = await fetch(`/api/mobile-tests/${testId}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || t('mobileTests.tagsFailed', 'The tags were not changed.'));
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['tags'] });
    } catch (error) {
      toast({ variant: 'destructive', title: (error as Error).message });
    } finally {
      setTaggingId(null);
    }
  };
  const createTag = async (name: string): Promise<TagRef> => {
    const response = await fetch('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || t('mobileTests.tagsFailed', 'The tags were not changed.'));
    await queryClient.invalidateQueries({ queryKey: ['tags'] });
    return body as TagRef;
  };

  const remove = useMutation({
    mutationFn: async (test: MobileTestRow) => {
      const response = await fetch(`/api/mobile-tests/${test.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || t('mobileTests.deleteFailed', 'The test was not deleted.'));
    },
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
    },
    onError: (error: Error) => toast({ variant: 'destructive', title: error.message }),
  });

  const statusLabel = (status: MobileRunStatus) =>
    ({
      queued: t('mobileTests.run.queued', 'Waiting for a device…'),
      running: t('mobileTests.run.running', 'Running'),
      passed: t('mobileTests.run.passed', 'Passed'),
      failed: t('mobileTests.run.failed', 'Failed'),
      error: t('mobileTests.run.error', 'Could not run'),
    })[status];

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <PageHeader
        className="mb-6"
        title={t('mobileTests.title', 'Mobile apps')}
        description={t('mobileTests.pageDescription', 'Tests of native Android and iOS apps, on real devices of your BrowserStack or LambdaTest grid.')}
        actions={
          canEdit ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="mr-1 h-4 w-4" /> {t('mobileTests.create', 'New mobile test')}
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('mobileTests.loading', 'Loading…')}</p>
          ) : tests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {deviceGrids.length === 0
                ? t('mobileTests.emptyNoGrid', 'No mobile test yet. They run on a BrowserStack or LambdaTest grid: add one in Settings → Browser grids first.')
                : t('mobileTests.empty', 'No mobile test yet.')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('mobileTests.columns.name', 'Test')}</TableHead>
                  <TableHead>{t('mobileTests.columns.tags', 'Tags')}</TableHead>
                  <TableHead>{t('mobileTests.columns.device', 'Device')}</TableHead>
                  <TableHead>{t('mobileTests.columns.steps', 'Steps')}</TableHead>
                  <TableHead>{t('mobileTests.columns.lastRun', 'Last run')}</TableHead>
                  <TableHead className="text-right">{t('mobileTests.columns.actions', 'Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tests.map((test) => (
                  <TableRow key={test.id} data-testid={`mobile-test-${test.id}`}>
                    <TableCell className="font-medium">
                      {test.name}
                      <Badge variant="outline" className="ml-2 font-normal">
                        {MOBILE_PLATFORM_LABELS[test.platform]}
                      </Badge>
                      {unstable.has(test.id) && (
                        <Badge
                          variant="outline"
                          className="ml-2 font-normal"
                          title={unstable
                            .get(test.id)!
                            .map((item) =>
                              t('mobileTests.unstableOn', '{{device}}: changed verdict {{flips}}× in {{runs}} runs', {
                                device: item.browser ?? '—',
                                flips: item.unexplainedFlips,
                                runs: item.runs,
                              }),
                            )
                            .join('\n')}
                        >
                          <Shuffle className="mr-1 h-3 w-3" />
                          {t('mobileTests.unstable', 'Unstable')}
                        </Badge>
                      )}
                      {quarantined.has(test.id) && (
                        <Badge variant="secondary" className="ml-2 font-normal" title={quarantined.get(test.id)!.reason}>
                          <ShieldAlert className="mr-1 h-3 w-3" />
                          {t('mobileTests.quarantined', 'In quarantine')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell data-testid={`mobile-test-tags-${test.id}`}>
                      {canEdit ? (
                        <TagPicker
                          selected={test.tags ?? []}
                          available={allTags}
                          disabled={taggingId === test.id}
                          onChange={(tagIds) => setTags(test.id, tagIds)}
                          onCreate={createTag}
                        />
                      ) : (
                        (test.tags ?? []).map((tag) => (
                          <Badge key={tag.id} variant="secondary" className="mr-1 font-normal">
                            {tag.name}
                          </Badge>
                        ))
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{[test.deviceName, test.osVersion].filter(Boolean).join(' ')}</TableCell>
                    <TableCell className="text-sm">{test.steps.length}</TableCell>
                    <TableCell className="text-sm">
                      {test.lastRun ? `${statusLabel(test.lastRun.status)} · ${new Date(test.lastRun.createdAt).toLocaleString()}` : '—'}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap space-x-1">
                      <Button variant="ghost" size="sm" onClick={() => setCommentsFor(test)}>{t('comments.title', 'Comments')}</Button>
                      {canEdit && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setRunning(test)} aria-label={t('mobileTests.runFor', 'Run {{name}}', { name: test.name })}>
                            <Play className="h-4 w-4" />
                          </Button>
                          {!quarantined.has(test.id) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setQuarantining(test)}
                              aria-label={t('mobileTests.quarantineFor', 'Quarantine {{name}}', { name: test.name })}
                            >
                              <ShieldAlert className="h-4 w-4" />
                            </Button>
                          )}
                          <Button variant="outline" size="sm" onClick={() => setEditing(test)} aria-label={t('mobileTests.editFor', 'Edit {{name}}', { name: test.name })}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setDeleting(test)} aria-label={t('mobileTests.deleteFor', 'Delete {{name}}', { name: test.name })}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
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

      <MobileTestDialog
        isOpen={editing !== null}
        test={editing && editing !== 'new' ? editing : null}
        grids={deviceGrids}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
          toast({ title: t('mobileTests.saved', 'Mobile test saved') });
        }}
      />
      <MobileRunDialog test={running} grids={deviceGrids} onClose={() => setRunning(null)} onFinished={refresh} />
      <Dialog open={commentsFor !== null} onOpenChange={open => { if (!open) setCommentsFor(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{commentsFor?.name}</DialogTitle></DialogHeader>
          {commentsFor && <CommentsPanel key={commentsFor.id} kind="mobile" targetId={commentsFor.id} />}
        </DialogContent>
      </Dialog>
      <QuarantineDialog
        test={quarantining ? { type: 'mobile', id: quarantining.id } : null}
        testName={quarantining?.name ?? ''}
        onClose={() => setQuarantining(null)}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mobileTests.deleteTitle', 'Delete {{name}}?', { name: deleting?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('mobileTests.deleteBody', 'Its runs go with it. The app stays on the grid.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('mobileTests.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting)}>{t('mobileTests.delete', 'Delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MobileTestsPage;

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
import { Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { MOBILE_GRID_PROVIDERS, MOBILE_PLATFORM_LABELS, type MobileRunStatus } from '@shared/mobile';
import MobileTestDialog, { type GridOption, type MobileTestRow } from '@/components/mobile/MobileTestDialog';
import MobileRunDialog from '@/components/mobile/MobileRunDialog';

/**
 * Tests of native Android and iOS apps, run on real devices of the organization's BrowserStack
 * or LambdaTest grid (shared/mobile.ts).
 */

interface ListedTest extends MobileTestRow {
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
                    </TableCell>
                    <TableCell className="text-sm">{[test.deviceName, test.osVersion].filter(Boolean).join(' ')}</TableCell>
                    <TableCell className="text-sm">{test.steps.length}</TableCell>
                    <TableCell className="text-sm">
                      {test.lastRun ? `${statusLabel(test.lastRun.status)} · ${new Date(test.lastRun.createdAt).toLocaleString()}` : '—'}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap space-x-1">
                      {canEdit && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setRunning(test)} aria-label={t('mobileTests.runFor', 'Run {{name}}', { name: test.name })}>
                            <Play className="h-4 w-4" />
                          </Button>
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

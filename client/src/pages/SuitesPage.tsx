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
import SuiteDialog, { type SuiteDetail, type SuitePayload } from '@/components/suites/SuiteDialog';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

/**
 * Suites: the lists of tests that plans share.
 *
 * "Checkout", "Login" and "Search" used to be picked one by one into every plan that needed them,
 * and a new checkout test went into one plan and was forgotten in the others. A suite is that list,
 * kept once; plans include it (from the plans page).
 */

export interface SuiteRow {
  id: number;
  name: string;
  description: string | null;
  kind: 'static' | 'dynamic';
  testCount: number;
  planCount: number;
}

async function send(method: string, url: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

const SuitesPage: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = user?.role !== 'viewer';

  /** Open dialog: null closed, 'new' creating, otherwise the suite being changed. */
  const [editing, setEditing] = useState<SuiteDetail | 'new' | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<SuiteRow | null>(null);

  const { data, isLoading, isError } = useQuery<SuiteRow[]>({
    queryKey: ['suites'],
    queryFn: () => send('GET', '/api/suites'),
  });
  const suites = Array.isArray(data) ? data : [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['suites'] });

  const save = useMutation({
    mutationFn: (payload: SuitePayload) =>
      editing && editing !== 'new' ? send('PUT', `/api/suites/${editing.id}`, payload) : send('POST', '/api/suites', payload),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
      toast({ title: t('suites.saved', 'Suite saved') });
    },
    onError: (error: Error) => toast({ variant: 'destructive', title: t('suites.saveFailed', 'The suite was not saved'), description: error.message }),
  });

  const remove = useMutation({
    mutationFn: (suite: SuiteRow) => send('DELETE', `/api/suites/${suite.id}`),
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['planSuites'] });
      toast({ title: t('suites.deleted', 'Suite deleted') });
    },
    onError: (error: Error) => toast({ variant: 'destructive', title: t('suites.deleteFailed', 'The suite was not deleted'), description: error.message }),
  });

  const openSuite = async (suite: SuiteRow) => {
    setLoadingId(suite.id);
    try {
      setEditing(await send('GET', `/api/suites/${suite.id}`));
    } catch (error) {
      toast({ variant: 'destructive', title: t('suites.loadFailed', 'The suite could not be loaded'), description: (error as Error).message });
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <PageHeader
        className="mb-6"
        title={t('suites.title', 'Suites')}
        description={t('suites.pageDescription', 'Lists of tests kept once and shared by the plans that include them.')}
        actions={
          canEdit ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="mr-1 h-4 w-4" /> {t('suites.create', 'New suite')}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('suites.loading', 'Loading…')}</p>
          ) : isError ? (
            <p className="text-sm text-destructive">{t('suites.error', 'The suites could not be loaded.')}</p>
          ) : suites.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="suites-empty">
              {t('suites.empty', 'No suites yet. A suite keeps a list of tests once, for every plan that needs it.')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('suites.columns.name', 'Name')}</TableHead>
                  <TableHead>{t('suites.columns.kind', 'Kind')}</TableHead>
                  <TableHead>{t('suites.columns.tests', 'Tests')}</TableHead>
                  <TableHead>{t('suites.columns.plans', 'Plans')}</TableHead>
                  <TableHead className="text-right">{t('suites.columns.actions', 'Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suites.map((suite) => (
                  <TableRow key={suite.id} data-testid={`suite-${suite.id}`}>
                    <TableCell>
                      <div className="font-medium">{suite.name}</div>
                      {suite.description && <div className="text-xs text-muted-foreground">{suite.description}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={suite.kind === 'dynamic' ? 'secondary' : 'outline'}>
                        {t(`suites.kind.${suite.kind}`, suite.kind === 'static' ? 'Static' : 'Dynamic')}
                      </Badge>
                    </TableCell>
                    <TableCell>{suite.testCount}</TableCell>
                    <TableCell>{suite.planCount}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => openSuite(suite)} disabled={loadingId === suite.id}>
                        {loadingId === suite.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Pencil className="mr-1 h-4 w-4" />}
                        {canEdit ? t('suites.edit', 'Edit') : t('suites.view', 'View')}
                      </Button>
                      {canEdit && (
                        <Button variant="outline" size="sm" onClick={() => setDeleting(suite)} aria-label={t('suites.delete', 'Delete')}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SuiteDialog
        isOpen={editing !== null}
        suite={editing === 'new' ? null : editing}
        saving={save.isPending}
        onClose={() => setEditing(null)}
        onSave={(payload) => save.mutate(payload)}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('suites.deleteTitle', 'Delete "{{name}}"?', { name: deleting?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && deleting.planCount > 0
                ? t('suites.deleteInPlans', '{{count}} plans include it; they will stop running its tests. Runs already made keep what they ran.', { count: deleting.planCount })
                : t('suites.deleteUnused', 'No plan includes it.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('suites.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting)}>{t('suites.delete', 'Delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SuitesPage;

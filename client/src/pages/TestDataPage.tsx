import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Database, Pencil, PlusCircle, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { DatasetPanel, type DatasetRow } from '@/components/DatasetPanel';
import { DATA_PREFIX } from '@shared/test-data';

/**
 * Shared test data (shared/test-data.ts): the organization's named tables of values. Each column
 * of the first row is {{data.<set>.<column>}} in any test; a UI test can also run over all the
 * rows. Viewers read; editors keep them.
 */

interface DataSet {
  id: number;
  name: string;
  description: string | null;
  columns: string[];
  rows: DatasetRow[];
  updatedAt: string;
}

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const answer = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(answer?.error || `Request failed (${res.status})`);
  return answer;
}

/** Column order from the rows, as the table editor keeps it. */
const columnsOf = (rows: DatasetRow[]) => {
  const seen: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
  return seen;
};

function DataSetDialog({ set, onClose }: { set: DataSet | 'new' | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editing = set && set !== 'new' ? set : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [rows, setRows] = useState<DatasetRow[]>(editing?.rows ?? []);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      call(editing ? 'PUT' : 'POST', editing ? `/api/test-data/${editing.id}` : '/api/test-data', {
        name: name.trim(),
        description: description.trim() || null,
        columns: columnsOf(rows),
        rows,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testData'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const columns = columnsOf(rows);
  return (
    <Dialog open={!!set} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('testData.edit', 'Edit data set') : t('testData.new', 'New data set')}</DialogTitle>
          <DialogDescription>{t('testData.dialogHint', 'A name and a table. The first row gives the {{data.…}} values; a UI test can run over every row.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="data-set-name">{t('testData.name', 'Name')}</Label>
            <Input id="data-set-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="customers" className="font-mono" />
            <p className="text-xs text-muted-foreground">{t('testData.nameHint', 'Lowercase letters, digits and underscores.')}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="data-set-description">{t('testData.description', 'Description')}</Label>
            <Textarea id="data-set-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DatasetPanel dataset={rows} onChange={setRows} />
        {name && columns.length > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="data-set-variables">
            {t('testData.usage', 'In any test:')}{' '}
            {columns.map((column, i) => (
              <React.Fragment key={column}>
                {i > 0 && ' · '}
                <code>{`{{${DATA_PREFIX}.${name.trim()}.${column}}}`}</code>
              </React.Fragment>
            ))}
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
            {t('common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TestDataPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = user?.role !== 'viewer';
  const [open, setOpen] = useState<DataSet | 'new' | null>(null);
  const { data: sets = [], isLoading } = useQuery<DataSet[]>({ queryKey: ['testData'], queryFn: () => call('GET', '/api/test-data') });

  const remove = useMutation({
    mutationFn: (set: DataSet) => call('DELETE', `/api/test-data/${set.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['testData'] }),
    onError: (e: Error) => toast({ variant: 'destructive', title: t('testData.deleteFailed', 'Not deleted'), description: e.message }),
  });

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <PageHeader
        className="mb-6"
        title={t('testData.title', 'Test data')}
        description={t('testData.pageDescription', 'Data kept once and reused by every test: values as {{data.<set>.<column>}}, or the rows a UI test runs over.')}
        actions={
          canEdit && (
            <Button onClick={() => setOpen('new')}>
              <PlusCircle className="mr-2 h-4 w-4" /> {t('testData.new', 'New data set')}
            </Button>
          )
        }
      />
      {isLoading ? null : sets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Database className="h-8 w-8" />
            {t('testData.empty', 'No shared data yet. Create a set for the customers, products or cards your tests keep copying.')}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sets.map((set) => (
            <Card key={set.id} data-testid="data-set">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono font-medium">{set.name}</p>
                    {set.description && <p className="text-sm text-muted-foreground">{set.description}</p>}
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => setOpen(set)} aria-label={t('testData.editNamed', 'Edit {{name}}', { name: set.name })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.confirm(t('testData.confirmDelete', 'Delete {{name}}?', { name: set.name })) && remove.mutate(set)}
                        aria-label={t('testData.deleteNamed', 'Delete {{name}}', { name: set.name })}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('testData.size', '{{rows}} row(s) · {{columns}} column(s)', { rows: set.rows.length, columns: set.columns.length })}
                </p>
                <p className="truncate text-xs">
                  {set.columns.map((column, i) => (
                    <React.Fragment key={column}>
                      {i > 0 && ' · '}
                      <code>{`{{${DATA_PREFIX}.${set.name}.${column}}}`}</code>
                    </React.Fragment>
                  ))}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {open && <DataSetDialog key={open === 'new' ? 'new' : open.id} set={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

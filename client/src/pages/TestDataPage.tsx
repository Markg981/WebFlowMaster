import React, { useEffect, useState } from 'react';
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
import CatalogPagination from '@/components/catalog/CatalogPagination';
import { useCatalogControls } from '@/hooks/use-catalog-controls';
import type { CatalogPage } from '@shared/catalog';
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

type DataSetSummary = Omit<DataSet, 'rows'> & { rowCount: number };

async function call(method: string, url: string, body?: unknown, signal?: AbortSignal) {
  const res = await fetch(url, {
    method,
    signal,
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
  const {search,setSearch,debouncedSearch,page,setPage,pageSize,setPageSize} = useCatalogControls();
  const [detailBusyId,setDetailBusyId] = useState<number|null>(null);
  const [detailError,setDetailError] = useState<string|null>(null);
  const { data, isLoading, isFetching, error } = useQuery<CatalogPage<DataSetSummary>>({
    queryKey:['testData','catalog',page,pageSize,debouncedSearch],
    queryFn:({signal}) => call('GET',`/api/catalog/test-data?${new URLSearchParams({page:String(page),pageSize:String(pageSize),search:debouncedSearch})}`,undefined,signal),
  });
  const sets = data?.items ?? [];
  useEffect(() => {
    if (data) setPage(current => Math.min(current,Math.max(1,Math.ceil(data.total/pageSize))));
  },[data,pageSize,setPage]);
  const edit = async (set: DataSetSummary) => {
    setDetailBusyId(set.id); setDetailError(null);
    try {
      const detail = await call('GET',`/api/test-data/${set.id}`);
      if (detail.id !== set.id || !Array.isArray(detail.rows)) throw new Error(t('catalog.detailFailed','Could not load details'));
      setOpen(detail);
    } catch (error: any) { setDetailError(error.message); }
    finally { setDetailBusyId(null); }
  };

  const remove = useMutation({
    mutationFn: (set: DataSetSummary) => call('DELETE', `/api/test-data/${set.id}`),
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
            <Button disabled={detailBusyId !== null} onClick={() => setOpen('new')}>
              <PlusCircle className="mr-2 h-4 w-4" /> {t('testData.new', 'New data set')}
            </Button>
          )
        }
      />
      <Input className="mb-4 max-w-sm" aria-label={t('catalog.search','Search by name')} placeholder={t('catalog.search','Search by name')} value={search} onChange={event=>setSearch(event.target.value)} />
      {detailBusyId !== null && <p role="status" className="mb-4 text-sm text-muted-foreground">{t('catalog.loadingDetails', 'Loading details…')}</p>}
      {detailError && <p role="alert" className="mb-4 text-sm text-destructive">{detailError}</p>}
      {isLoading ? <p role="status">{t('catalog.loading','Loading…')}</p> : error ? <p role="alert" className="text-destructive">{error.message}</p> : sets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Database className="h-8 w-8" />
            {debouncedSearch ? t('catalog.noMatches','No items match this filter.') : t('testData.empty', 'No shared data yet. Create a set for the customers, products or cards your tests keep copying.')}
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
                      <Button variant="ghost" size="icon" disabled={detailBusyId !== null} onClick={() => void edit(set)} aria-label={t('testData.editNamed', 'Edit {{name}}', { name: set.name })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.confirm(t('testData.confirmDelete', 'Delete {{name}}?', { name: set.name })) && remove.mutate(set)}
                        disabled={remove.isPending || detailBusyId === set.id}
                        aria-label={t('testData.deleteNamed', 'Delete {{name}}', { name: set.name })}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('testData.size', '{{rows}} row(s) · {{columns}} column(s)', { rows: set.rowCount, columns: set.columns.length })}
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
      <CatalogPagination page={page} pageSize={pageSize} total={data?.total ?? 0} busy={isFetching || !!error} onPageChange={setPage} onPageSizeChange={setPageSize} />
      {open && <DataSetDialog key={open === 'new' ? 'new' : open.id} set={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

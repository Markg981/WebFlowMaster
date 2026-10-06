import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import TagPicker, { type TagRef } from '@/components/tags/TagPicker';
import TestHistoryDialog from '@/components/tests/TestHistoryDialog';
import ManualTestDialog from '@/components/tests/ManualTestDialog';
import BddTestDialog, {type BddDraftSource} from '@/components/tests/BddTestDialog';
import type {BddTest} from '@shared/bdd';
import CatalogPagination from '@/components/catalog/CatalogPagination';
import { useCatalogControls } from '@/hooks/use-catalog-controls';
import type { CatalogPage } from '@shared/catalog';
import { TestFilesDialog } from '@/components/tests/TestFilesDialog';
import CommentsPanel from '@/components/tests/CommentsPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ClipboardCheck, FileCode, FileStack, History, Loader2, Pencil, Search, Trash2 } from 'lucide-react';

/**
 * Every test this organization has, in one place.
 *
 * There was no such place. A test could be created in the builder and selected into a plan, and
 * between those two moments it was unreachable: nothing listed what existed, nothing said what a
 * test was for, and nothing could show what it used to be. A suite that grows past a few dozen
 * tests stops being navigable at exactly that point.
 *
 * Two things are added here because they only make sense against a list: the tags a test carries,
 * and the history of what it was before the last save.
 */

interface LibraryTest {
  id: number;
  kind: 'browser' | 'manual' | 'bdd' | 'cucumber';
  name: string;
  url: string;
  status: string;
  updatedAt: string;
  tags: TagRef[];
  sequence?: unknown;
  bdd?: BddTest|null;
  projectId?: number|null;
}

interface TagSummary extends TagRef {
  uiCount: number;
  apiCount: number;
}

const TestLibraryPage: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canEdit = user?.role !== 'viewer';
  const { search, setSearch, debouncedSearch, page, setPage, pageSize, setPageSize } = useCatalogControls();
  const [detailBusyId, setDetailBusyId] = useState<number | null>(null);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [historyFor, setHistoryFor] = useState<{ id: number; name: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** The manual test being written or edited: null closed, 'new' for a new one. */
  const [manualEditing, setManualEditing] = useState<LibraryTest | 'new' | null>(null);
  const [bddEditing,setBddEditing]=useState<BddDraftSource|null>(null);
  /** Export and import of the tests as a file (server/test-bundle.ts). */
  const [filesOpen, setFilesOpen] = useState(false);
  const [commentsFor, setCommentsFor] = useState<LibraryTest | null>(null);

  const { data: testsData, isLoading, isFetching, error } = useQuery<CatalogPage<LibraryTest>, Error>({
    queryKey: ['/api/tests', 'catalog', page, pageSize, debouncedSearch, activeTagIds],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({page: String(page), pageSize: String(pageSize), search: debouncedSearch, tagIds: activeTagIds.join(',')});
      const response = await fetch(`/api/catalog/tests?${params}`, { signal });
      if (!response.ok) throw new Error(t('catalog.loadFailed', 'Could not load the catalog.'));
      return response.json();
    },
  });

  const { data: tagsData } = useQuery<TagSummary[], Error>({
    queryKey: ['tags'],
    queryFn: async () => {
      const response = await fetch('/api/tags');
      if (!response.ok) throw new Error('Could not load the tags');
      return response.json();
    },
  });

  const visible = testsData?.items ?? [];
  const allTags = Array.isArray(tagsData) ? tagsData : [];
  useEffect(() => {
    if (testsData) setPage(current => Math.min(current, Math.max(1, Math.ceil(testsData.total / pageSize))));
  }, [testsData, pageSize, setPage]);

  const edit = async (test: LibraryTest) => {
    setDetailBusyId(test.id);
    try {
      const response = await fetch(`/api/tests/${test.id}`);
      if (!response.ok) throw new Error(t('catalog.detailFailed', 'Could not load details'));
      const detail = await response.json();
      if (detail.id !== test.id) throw new Error(t('catalog.detailFailed', 'Could not load details'));
      if (test.kind === 'bdd' || test.kind === 'cucumber') {
        if (!detail.bdd) throw new Error(t('catalog.detailFailed', 'Could not load details'));
        setBddEditing(detail);
      } else {
        if (typeof detail.sequence === 'string') detail.sequence = JSON.parse(detail.sequence);
        if (!Array.isArray(detail.sequence)) throw new Error(t('catalog.detailFailed', 'Could not load details'));
        setManualEditing(detail);
      }
    } catch (error: any) {
      toast({variant:'destructive', title:t('catalog.detailFailed', 'Could not load details'), description:error.message});
    } finally { setDetailBusyId(null); }
  };

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['/api/tests'] });
    await queryClient.invalidateQueries({ queryKey: ['tags'] });
  };

  const setTags = async (testId: number, tagIds: string[]) => {
    setBusyId(testId);
    try {
      const response = await fetch(`/api/tests/${testId}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not change the tags');
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const createTag = async (name: string): Promise<TagRef> => {
    const response = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not create the tag');
    await queryClient.invalidateQueries({ queryKey: ['tags'] });
    return body as TagRef;
  };

  const restore = async (testId: number, version: number) => {
    const response = await fetch(`/api/tests/${testId}/versions/${version}/restore`, { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not restore that version');
    await refresh();
    toast({
      title: t('testLibrary.restored.title', 'Restored'),
      description: body.newVersion
        ? t(
            'testLibrary.restored.description',
            'The test is back to version {{from}}, saved as version {{to}}.',
            { from: version, to: body.newVersion },
          )
        : t('testLibrary.restored.unchanged', 'The test already was that version, so nothing changed.'),
    });
  };

  const remove = async (test: LibraryTest) => {
    if (!window.confirm(t('testLibrary.confirmDelete', 'Delete "{{name}}" and its history?', { name: test.name }))) {
      return;
    }
    setBusyId(test.id);
    try {
      const response = await fetch(`/api/tests/${test.id}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 204) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not delete the test');
      }
      await refresh();
      toast({ title: t('testLibrary.deleted', 'Test deleted') });
    } catch (deleteError: any) {
      toast({
        title: t('testLibrary.deleteFailed', 'Could not delete the test'),
        description: deleteError?.message,
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const toggleTagFilter = (tagId: string) => {
    setPage(1);
    setActiveTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <PageHeader
        title={t('testLibrary.title', 'Test Library')}
        description={t(
          'testLibrary.description',
          'Every saved test, what it is for, and what it used to be.',
        )}
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t('testLibrary.search', 'Search by name')}
            aria-label={t('testLibrary.search', 'Search by name')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1" data-testid="tag-filters">
          {allTags.map((tag) => (
            <Badge
              key={tag.id}
              variant={activeTagIds.includes(tag.id) ? 'default' : 'outline'}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-pressed={activeTagIds.includes(tag.id)}
              onKeyDown={event => {if (event.key === "Enter" || event.key === " ") {event.preventDefault(); toggleTagFilter(tag.id);}}}
              onClick={() => toggleTagFilter(tag.id)}
            >
              {tag.name}
              <span className="ml-1 opacity-70">{tag.uiCount}</span>
            </Badge>
          ))}
          {activeTagIds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => {setActiveTagIds([]); setPage(1);}}>
              {t('testLibrary.clearFilters', 'Clear')}
            </Button>
          )}
        </div>
        <Button variant="outline" className="ml-auto" onClick={() => setFilesOpen(true)} data-testid="open-test-files">
          <FileStack className="mr-2 h-4 w-4" />
          {t('testFiles.button', 'Files')}
        </Button>
        {canEdit && (
          <Button variant="outline" disabled={detailBusyId !== null} onClick={() => setManualEditing('new')}>
            <ClipboardCheck className="mr-2 h-4 w-4" />
            {t('testLibrary.newManual', 'New manual test')}
          </Button>
        )}
      </div>

      {detailBusyId !== null && <p role="status" className="mt-4 text-sm text-muted-foreground">{t('catalog.loadingDetails', 'Loading details…')}</p>}

      <Card className="mt-4 overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              {t('testLibrary.loading', 'Loading tests…')}
            </p>
          ) : error ? (
            <p className="p-6 text-sm text-destructive" role="alert">{error.message}</p>
          ) : visible.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {!debouncedSearch && activeTagIds.length === 0
                ? t('testLibrary.empty', 'No tests yet. Record or describe one in the builder and save it.')
                : t('testLibrary.noMatches', 'No test matches this filter.')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('testLibrary.columns.name', 'Name')}</TableHead>
                  <TableHead>{t('testLibrary.columns.tags', 'Tags')}</TableHead>
                  <TableHead>{t('testLibrary.columns.url', 'Starts at')}</TableHead>
                  <TableHead>{t('testLibrary.columns.updated', 'Last saved')}</TableHead>
                  <TableHead className="text-right">{t('testLibrary.columns.actions', 'Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((test) => (
                  <TableRow key={test.id}>
                    <TableCell className="font-medium">
                      {test.name}
                      {test.kind === 'cucumber'&&<Badge variant="secondary" className="ml-2 font-normal">{t('bdd.cucumber','Cucumber')}</Badge>}
                      {test.kind === 'manual' && (
                        <Badge variant="secondary" className="ml-2 font-normal">{t('testLibrary.manualBadge', 'Manual')}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <TagPicker
                        selected={test.tags ?? []}
                        available={allTags}
                        disabled={busyId === test.id}
                        readOnly={!canEdit}
                        onChange={(tagIds) => setTags(test.id, tagIds)}
                        onCreate={createTag}
                      />
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={test.url}>
                      {test.url || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {test.updatedAt ? new Date(test.updatedAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => setCommentsFor(test)}>{t('comments.title', 'Comments')}</Button>
                      {canEdit && (test.kind === 'bdd' || test.kind === 'cucumber') && <Button variant="ghost" size="sm" aria-label={t('bdd.edit','Edit Gherkin')} data-testid={`bdd-edit-${test.id}`} disabled={detailBusyId !== null} onClick={()=>void edit(test)}><Pencil className="h-4 w-4" /></Button>}
                      {canEdit && test.kind === 'manual' && (
                        <Button variant="ghost" size="sm" disabled={detailBusyId !== null} onClick={() => void edit(test)} title={t('testLibrary.editManual', 'Edit steps')}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {test.kind === 'browser' && (
                        <Button asChild variant="ghost" size="sm" title={t('testLibrary.playwright', 'Download as a Playwright test')}>
                          <a href={`/api/tests/${test.id}/playwright`} download aria-label={t('testLibrary.playwright', 'Download as a Playwright test')}>
                            <FileCode className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHistoryFor({ id: test.id, name: test.name })}
                        title={t('testLibrary.history', 'History')}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(test)}
                          disabled={busyId === test.id}
                          title={t('testLibrary.delete', 'Delete')}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
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

      <CatalogPagination page={page} pageSize={pageSize} total={testsData?.total ?? 0} busy={isFetching || !!error} onPageChange={setPage} onPageSizeChange={setPageSize} />

      <TestHistoryDialog
        isOpen={historyFor !== null}
        onClose={() => setHistoryFor(null)}
        test={historyFor}
        onRestore={(version) => restore(historyFor!.id, version)}
      />

      <TestFilesDialog open={filesOpen} onOpenChange={setFilesOpen} canEdit={canEdit} onImported={() => void refresh()} />
      {bddEditing&&<BddTestDialog key={bddEditing.id} test={bddEditing} onClose={()=>setBddEditing(null)} onSaved={()=>void refresh()}/>}
      <Dialog open={commentsFor !== null} onOpenChange={open => { if (!open) setCommentsFor(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{commentsFor?.name}</DialogTitle></DialogHeader>
          {commentsFor && <CommentsPanel key={commentsFor.id} kind="ui" targetId={commentsFor.id} />}
        </DialogContent>
      </Dialog>

      <ManualTestDialog
        isOpen={manualEditing !== null}
        onClose={() => setManualEditing(null)}
        test={manualEditing === 'new' || manualEditing === null ? null : manualEditing}
        onSaved={() => {
          void refresh();
          toast({ title: t('testLibrary.manualSaved', 'Manual test saved') });
        }}
      />
    </div>
  );
};

export default TestLibraryPage;

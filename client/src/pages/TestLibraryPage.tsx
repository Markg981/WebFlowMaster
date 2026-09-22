import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import TagPicker, { type TagRef } from '@/components/tags/TagPicker';
import TestHistoryDialog from '@/components/tests/TestHistoryDialog';
import { History, Loader2, Search, Trash2 } from 'lucide-react';

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
  name: string;
  url: string;
  status: string;
  updatedAt: string;
  tags: TagRef[];
}

interface TagSummary extends TagRef {
  uiCount: number;
  apiCount: number;
}

const TestLibraryPage: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [historyFor, setHistoryFor] = useState<{ id: number; name: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const { data: testsData, isLoading, error } = useQuery<LibraryTest[], Error>({
    queryKey: ['/api/tests'],
    queryFn: async () => {
      const response = await fetch('/api/tests');
      if (!response.ok) throw new Error('Could not load the tests');
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

  // Memoised because the filter below depends on it: a fresh [] on every render would rerun
  // the filter on every keystroke for no reason.
  const tests = useMemo(() => (Array.isArray(testsData) ? testsData : []), [testsData]);
  const allTags = Array.isArray(tagsData) ? tagsData : [];

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tests.filter((test) => {
      if (needle !== '' && !test.name.toLowerCase().includes(needle)) return false;
      // Every selected tag, not any of them: narrowing by two tags means the tests that are
      // both, which is what somebody adding a second filter is asking for.
      return activeTagIds.every((tagId) => (test.tags ?? []).some((tag) => tag.id === tagId));
    });
  }, [tests, search, activeTagIds]);

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
              onClick={() => toggleTagFilter(tag.id)}
            >
              {tag.name}
              <span className="ml-1 opacity-70">{tag.uiCount}</span>
            </Badge>
          ))}
          {activeTagIds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setActiveTagIds([])}>
              {t('testLibrary.clearFilters', 'Clear')}
            </Button>
          )}
        </div>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              {t('testLibrary.loading', 'Loading tests…')}
            </p>
          ) : error ? (
            <p className="p-6 text-sm text-destructive">{error.message}</p>
          ) : visible.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {tests.length === 0
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
                    <TableCell className="font-medium">{test.name}</TableCell>
                    <TableCell>
                      <TagPicker
                        selected={test.tags ?? []}
                        available={allTags}
                        disabled={busyId === test.id}
                        onChange={(tagIds) => setTags(test.id, tagIds)}
                        onCreate={createTag}
                      />
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={test.url}>
                      {test.url}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {test.updatedAt ? new Date(test.updatedAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHistoryFor({ id: test.id, name: test.name })}
                        title={t('testLibrary.history', 'History')}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(test)}
                        disabled={busyId === test.id}
                        title={t('testLibrary.delete', 'Delete')}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TestHistoryDialog
        isOpen={historyFor !== null}
        onClose={() => setHistoryFor(null)}
        test={historyFor}
        onRestore={(version) => restore(historyFor!.id, version)}
      />
    </div>
  );
};

export default TestLibraryPage;

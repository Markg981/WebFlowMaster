import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import CatalogPagination from '@/components/catalog/CatalogPagination';
import { useCatalogControls } from '@/hooks/use-catalog-controls';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/dates';
import { Download, FolderGit2, Loader2, RefreshCw, Search } from 'lucide-react';
import {
  HUB_IMPORT_MAX_CASES,
  hubErrorMessage,
  useHubCases,
  useHubFacets,
  useHubSource,
  useRefreshHub,
  type HubCaseFilters,
  type HubCaseRow,
} from '@/hooks/useTestCaseHub';
import { HubCaseStateBadge } from './HubCaseStateBadge';
import HubCaseDetailDialog from './HubCaseDetailDialog';
import HubImportDialog from './HubImportDialog';

/**
 * The QA hub's catalog, as a place to choose from.
 *
 * Nothing here creates a test by itself. The panel lists what the hub holds at the last
 * refresh, lets the person narrow it down and tick the cases they want, and hands the ticked
 * set to the import dialog. The selection survives paging and filtering, so a batch can be
 * gathered module by module before it is imported in one go.
 */

const ALL = 'all';

const HubCatalogPanel: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = user?.role !== 'viewer';

  const { data: source, isLoading: sourceLoading } = useHubSource();
  const hasCatalog = !!source && source.caseCount > 0;

  const { search, setSearch, debouncedSearch, page, setPage, pageSize, setPageSize } =
    useCatalogControls();
  const [module, setModule] = useState(ALL);
  const [status, setStatus] = useState<'active' | 'deprecated' | 'all'>('active');
  const [priority, setPriority] = useState(ALL);
  const [readiness, setReadiness] = useState(ALL);
  const [imported, setImported] = useState<'all' | 'no' | 'yes' | 'changed'>('all');
  const [missing, setMissing] = useState<'exclude' | 'include' | 'only'>('exclude');

  // Any change of filter starts again from the first page.
  useEffect(() => {
    setPage(1);
  }, [module, status, priority, readiness, imported, missing, setPage]);

  const filters = useMemo<HubCaseFilters>(
    () => ({
      module: module === ALL ? undefined : module,
      status,
      priority: priority === ALL ? undefined : priority,
      readiness: readiness === ALL ? undefined : Number(readiness),
      q: debouncedSearch || undefined,
      imported,
      missing,
      page,
      pageSize,
    }),
    [module, status, priority, readiness, debouncedSearch, imported, missing, page, pageSize],
  );

  const { data: facets } = useHubFacets(hasCatalog);
  const { data: cases, isFetching, error } = useHubCases(filters, hasCatalog);
  const rows = cases?.rows ?? [];

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importIds, setImportIds] = useState<string[] | null>(null);

  const selectableRows = rows.filter((row) => row.missingSince === null);
  const pageAllSelected =
    selectableRows.length > 0 && selectableRows.every((row) => selected.has(row.caseId));
  const pageSomeSelected = selectableRows.some((row) => selected.has(row.caseId));

  const toggleRow = (row: HubCaseRow, checked: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(row.caseId);
      else next.delete(row.caseId);
      return next;
    });

  const togglePage = (checked: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      for (const row of selectableRows) {
        if (checked) next.add(row.caseId);
        else next.delete(row.caseId);
      }
      return next;
    });

  const refresh = useRefreshHub();
  const runRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: (result) =>
        toast({
          title: t('testCaseHub.toast.refreshed', 'Catalog refreshed'),
          description: t('testCaseHub.toast.refreshSummary', {
            defaultValue:
              '{{cases}} cases: {{added}} new, {{updated}} changed, {{missing}} no longer in the hub.',
            cases: result.cases,
            added: result.added,
            updated: result.updated,
            missing: result.missing,
          }),
        }),
      onError: (refreshError) =>
        toast({
          title: t('testCaseHub.toast.refreshFailed', 'The catalog could not be refreshed'),
          description: hubErrorMessage(refreshError, t),
          variant: 'destructive',
        }),
    });

  const readinessLabel = (level: number) =>
    t(`testCaseHub.readiness.${level}`, { defaultValue: `Level ${level}` });

  if (sourceLoading) {
    return (
      <Card className="space-y-3 p-6" data-testid="hub-catalog-loading">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </Card>
    );
  }

  if (!source) {
    return (
      <Card>
        <EmptyState
          icon={FolderGit2}
          title={t('testCaseHub.catalog.noSource.title', 'No test case hub yet')}
          description={t(
            'testCaseHub.catalog.noSource.description',
            'Point WebFlowMaster at the QA team’s test case repository, and its cases appear here to choose from.',
          )}
          action={
            canEdit ? (
              <Button asChild>
                <Link href="/settings#testCaseHub">
                  {t('testCaseHub.catalog.noSource.action', 'Set up the hub')}
                </Link>
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  if (!hasCatalog) {
    return (
      <Card>
        <EmptyState
          icon={FolderGit2}
          title={t('testCaseHub.catalog.empty.title', 'The catalog is empty')}
          description={
            source.lastRefreshStatus === 'failed'
              ? t('testCaseHub.catalog.empty.failed', {
                  defaultValue: 'The last refresh failed: {{error}}',
                  error: source.lastRefreshError ?? '',
                })
              : t(
                  'testCaseHub.catalog.empty.description',
                  'Refresh the catalog to read the cases from {{name}}.',
                  { name: source.name },
                )
          }
          action={
            canEdit ? (
              <Button onClick={runRefresh} disabled={refresh.isPending} data-testid="hub-refresh">
                {refresh.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {t('testCaseHub.form.refresh', 'Refresh catalog')}
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden" data-testid="hub-catalog">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FolderGit2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">{source.name}</span>
            <Badge variant="secondary">
              {t('testCaseHub.status.cases', {
                defaultValue: '{{count}} cases',
                count: source.caseCount,
              })}
            </Badge>
            {facets && facets.changed > 0 && (
              <Badge variant="outline">
                {t('testCaseHub.catalog.changedCount', {
                  defaultValue: '{{count}} changed since import',
                  count: facets.changed,
                })}
              </Badge>
            )}
            {source.lastRefreshAt && (
              <span className="text-muted-foreground">
                {t('testCaseHub.catalog.refreshedAt', {
                  defaultValue: 'refreshed {{date}}',
                  date: formatDateTime(source.lastRefreshAt, i18n.language),
                })}
              </span>
            )}
            {source.lastRefreshStatus === 'failed' && (
              <Badge variant="destructive">
                {t('testCaseHub.status.failed', 'Last refresh failed')}
              </Badge>
            )}
          </div>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={runRefresh}
              disabled={refresh.isPending}
              data-testid="hub-refresh"
            >
              {refresh.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {t('testCaseHub.form.refresh', 'Refresh catalog')}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('testCaseHub.catalog.searchPlaceholder', 'Search id or objective…')}
              className="pl-8"
              aria-label={t('testCaseHub.catalog.search', 'Search the catalog')}
              data-testid="hub-search"
            />
          </div>
          <Select value={module} onValueChange={setModule}>
            <SelectTrigger
              className="w-[180px]"
              aria-label={t('testCaseHub.columns.module', 'Module')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t('testCaseHub.catalog.allModules', 'All modules')}
              </SelectItem>
              {facets?.modules.map((facet) => (
                <SelectItem key={facet.value} value={facet.value}>
                  {facet.value} ({facet.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger
              className="w-[150px]"
              aria-label={t('testCaseHub.columns.status', 'Status')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t('testCaseHub.status.active', 'Active')}</SelectItem>
              <SelectItem value="deprecated">
                {t('testCaseHub.status.deprecated', 'Deprecated')}
              </SelectItem>
              <SelectItem value="all">
                {t('testCaseHub.catalog.anyStatus', 'Any status')}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger
              className="w-[150px]"
              aria-label={t('testCaseHub.columns.priority', 'Priority')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t('testCaseHub.catalog.anyPriority', 'Any priority')}
              </SelectItem>
              {facets?.priorities
                .filter((facet): facet is { value: string; count: number } => facet.value !== null)
                .map((facet) => (
                  <SelectItem key={facet.value} value={facet.value}>
                    {facet.value} ({facet.count})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={readiness} onValueChange={setReadiness}>
            <SelectTrigger
              className="w-[160px]"
              aria-label={t('testCaseHub.columns.readiness', 'Readiness')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t('testCaseHub.catalog.anyReadiness', 'Any readiness')}
              </SelectItem>
              {facets?.readiness.map((facet) => (
                <SelectItem key={facet.value} value={String(facet.value)}>
                  {readinessLabel(facet.value)} ({facet.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={imported} onValueChange={(value) => setImported(value as typeof imported)}>
            <SelectTrigger
              className="w-[170px]"
              aria-label={t('testCaseHub.columns.state', 'State')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('testCaseHub.catalog.anyState', 'Any state')}</SelectItem>
              <SelectItem value="no">
                {t('testCaseHub.state.notImported', 'Not imported')}
              </SelectItem>
              <SelectItem value="yes">{t('testCaseHub.state.imported', 'Imported')}</SelectItem>
              <SelectItem value="changed">
                {t('testCaseHub.state.changed', 'Changed since import')}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={missing} onValueChange={(value) => setMissing(value as typeof missing)}>
            <SelectTrigger
              className="w-[180px]"
              aria-label={t('testCaseHub.state.missing', 'Missing')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exclude">
                {t('testCaseHub.catalog.missingExclude', 'Hide missing')}
              </SelectItem>
              <SelectItem value="include">
                {t('testCaseHub.catalog.missingInclude', 'Show missing too')}
              </SelectItem>
              <SelectItem value="only">
                {t('testCaseHub.catalog.missingOnly', 'Missing only')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error ? (
          <p className="px-4 py-6 text-sm text-destructive">{hubErrorMessage(error, t)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {canEdit && (
                  <TableHead className="w-[44px]">
                    <Checkbox
                      checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false}
                      onCheckedChange={(value) => togglePage(value === true)}
                      aria-label={t(
                        'testCaseHub.catalog.selectPage',
                        'Select every case on this page',
                      )}
                      disabled={selectableRows.length === 0}
                    />
                  </TableHead>
                )}
                <TableHead>{t('testCaseHub.columns.caseId', 'Case')}</TableHead>
                <TableHead>{t('testCaseHub.columns.module', 'Module')}</TableHead>
                <TableHead>{t('testCaseHub.columns.priority', 'Priority')}</TableHead>
                <TableHead>{t('testCaseHub.columns.readiness', 'Readiness')}</TableHead>
                <TableHead>{t('testCaseHub.columns.objective', 'Objective')}</TableHead>
                <TableHead>{t('testCaseHub.columns.state', 'State')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canEdit ? 7 : 6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {isFetching
                      ? t('testCaseHub.loading', 'Loading…')
                      : t('testCaseHub.catalog.noMatch', 'No case matches these filters.')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const gone = row.missingSince !== null;
                  return (
                    <TableRow
                      key={row.caseId}
                      className={gone ? 'opacity-60' : undefined}
                      data-testid={`hub-row-${row.caseId}`}
                    >
                      {canEdit && (
                        <TableCell>
                          <Checkbox
                            checked={selected.has(row.caseId)}
                            onCheckedChange={(value) => toggleRow(row, value === true)}
                            disabled={gone}
                            aria-label={row.caseId}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <button
                          type="button"
                          className="font-mono text-xs underline-offset-2 hover:underline"
                          onClick={() => setDetailId(row.caseId)}
                        >
                          {row.caseId}
                        </button>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{row.module}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.priority ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {readinessLabel(row.readinessLevel)}
                      </TableCell>
                      <TableCell className="max-w-[420px]">
                        <button
                          type="button"
                          className="block w-full truncate text-left hover:underline"
                          title={row.functionalObjective}
                          onClick={() => setDetailId(row.caseId)}
                        >
                          {row.functionalObjective}
                        </button>
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-1">
                          <HubCaseStateBadge row={row} />
                          {row.status === 'deprecated' && (
                            <Badge variant="outline">
                              {t('testCaseHub.status.deprecated', 'Deprecated')}
                            </Badge>
                          )}
                          {row.testId !== null && (
                            <Link
                              href={`/tests?search=${encodeURIComponent(`[${row.caseId}]`)}`}
                              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                            >
                              {t('testCaseHub.catalog.openTest', 'Open test')}
                            </Link>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}

        {canEdit && selected.size > 0 && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/40 px-4 py-3"
            data-testid="hub-selection"
          >
            <p className="text-sm">
              {t('testCaseHub.catalog.selected', {
                defaultValue: '{{count}} cases selected',
                count: selected.size,
              })}
              {selected.size > HUB_IMPORT_MAX_CASES && (
                <span className="ml-2 text-destructive">
                  {t('testCaseHub.import.tooMany', {
                    defaultValue: 'At most {{max}} cases per import. Narrow the selection.',
                    max: HUB_IMPORT_MAX_CASES,
                  })}
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                {t('testCaseHub.catalog.clearSelection', 'Clear')}
              </Button>
              <Button
                size="sm"
                onClick={() => setImportIds(Array.from(selected))}
                disabled={selected.size > HUB_IMPORT_MAX_CASES}
                data-testid="hub-import-selected"
              >
                <Download className="mr-2 h-4 w-4" />
                {t('testCaseHub.catalog.importSelected', 'Import selected…')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {cases && (
        <CatalogPagination
          page={page}
          pageSize={pageSize}
          total={cases.total}
          busy={isFetching}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

      <HubCaseDetailDialog
        caseId={detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        canEdit={canEdit}
        onImport={(caseId) => {
          setDetailId(null);
          setImportIds([caseId]);
        }}
      />

      <HubImportDialog
        open={importIds !== null}
        onOpenChange={(open) => {
          if (!open) setImportIds(null);
        }}
        caseIds={importIds ?? []}
        onImported={(result) => {
          // What was imported no longer needs to stay ticked.
          setSelected((previous) => {
            const next = new Set(previous);
            for (const entry of result.cases) {
              if (entry.outcome !== 'skipped') next.delete(entry.caseId);
            }
            return next;
          });
        }}
      />
    </>
  );
};

export default HubCatalogPanel;

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import RequirementDialog, { type RequirementPayload } from '@/components/requirements/RequirementDialog';
import LinkTestsDialog, { type LinkedTest } from '@/components/requirements/LinkTestsDialog';
import ImportRequirementsDialog, { type ImportRequest, type TrackerOption } from '@/components/requirements/ImportRequirementsDialog';
import {
  COVERAGE_STATES,
  type CoverageState,
  type RequirementCoverage,
  type RequirementKind,
  type TestOutcome,
} from '@shared/requirements';
import {
  CheckCircle2, ChevronDown, ChevronRight, CircleDashed, CircleOff, Download, ExternalLink,
  Link2, Loader2, Pencil, Plus, Trash2, Upload, XCircle,
} from 'lucide-react';

/**
 * Requirements traceability: epics, user stories and requirements, the tests that cover them, and
 * whether those tests passed the last time they ran — everywhere, in one plan, or in one run.
 *
 * The question it answers is the one asked before a release: which stories are tested, which are
 * failing, and which have no test at all. The coverage comes from the server, worked out from the
 * results every time (shared/requirements.ts).
 */

export interface RequirementRow {
  id: number;
  key: string;
  title: string;
  description: string | null;
  kind: RequirementKind;
  parentId: number | null;
  trackerId: string | null;
  url: string | null;
  externalType: string | null;
  externalStatus: string | null;
  syncedAt: string | null;
  directTests: number;
  coverage: RequirementCoverage;
}

interface CoverageAnswer {
  requirements: RequirementRow[];
  summary: { total: number; passing: number; failing: number; notRun: number; uncovered: number; coveredPercent: number };
  scope: null | { kind: 'plan'; planId: string; planName: string } | { kind: 'execution'; id: string; planId: string; planName: string | null; at: string | null };
  trackers: TrackerOption[];
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

const STATE_LOOK: Record<CoverageState, { icon: React.ElementType; className: string }> = {
  passing: { icon: CheckCircle2, className: 'text-green-700 dark:text-green-400' },
  failing: { icon: XCircle, className: 'text-red-700 dark:text-red-400' },
  notRun: { icon: CircleDashed, className: 'text-amber-700 dark:text-amber-400' },
  uncovered: { icon: CircleOff, className: 'text-muted-foreground' },
};

function useStateLabel() {
  const { t } = useTranslation();
  return (state: CoverageState) =>
    ({
      passing: t('requirements.state.passing', 'Passing'),
      failing: t('requirements.state.failing', 'Failing'),
      notRun: t('requirements.state.notRun', 'Not run'),
      uncovered: t('requirements.state.uncovered', 'No tests'),
    })[state];
}

function useOutcomeLabel() {
  const { t } = useTranslation();
  return (outcome: TestOutcome) =>
    ({
      passed: t('requirements.outcome.passed', 'Passed'),
      failed: t('requirements.outcome.failed', 'Failed'),
      pending: t('requirements.outcome.pending', 'Waiting for a verdict'),
      skipped: t('requirements.outcome.skipped', 'Skipped'),
      notRun: t('requirements.outcome.notRun', 'Never run'),
    })[outcome];
}

/** A state as an icon and a word: never as a colour alone. */
function StateBadge({ state }: { state: CoverageState }) {
  const label = useStateLabel()(state);
  const { icon: Icon, className } = STATE_LOOK[state];
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${className}`} data-state={state}>
      <Icon className="h-4 w-4" aria-hidden /> {label}
    </span>
  );
}

const ALL = 'all';

const RequirementsPage: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = user?.role !== 'viewer';
  const stateLabel = useStateLabel();
  const outcomeLabel = useOutcomeLabel();

  // A run's report links here with ?executionId=: the coverage of exactly that run.
  const [executionId, setExecutionId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('executionId'),
  );
  const [planId, setPlanId] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<string>(ALL);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<RequirementRow | 'new' | null>(null);
  const [linking, setLinking] = useState<{ row: RequirementRow; tests: LinkedTest[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<RequirementRow | null>(null);

  const scopeQuery = executionId ? `?executionId=${encodeURIComponent(executionId)}` : planId !== ALL ? `?planId=${encodeURIComponent(planId)}` : '';

  const { data, isLoading, isError, error } = useQuery<CoverageAnswer, Error>({
    queryKey: ['requirements', scopeQuery],
    queryFn: () => send('GET', `/api/requirements${scopeQuery}`),
  });
  const { data: plans = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['testPlans'],
    queryFn: () => send('GET', '/api/test-plans'),
  });
  const rows = data?.requirements ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['requirements'] });
  const onError = (title: string) => (err: Error) => toast({ variant: 'destructive', title, description: err.message });

  const save = useMutation({
    mutationFn: (payload: RequirementPayload) =>
      editing && editing !== 'new' ? send('PUT', `/api/requirements/${editing.id}`, payload) : send('POST', '/api/requirements', payload),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
      toast({ title: t('requirements.saved', 'Requirement saved') });
    },
    onError: onError(t('requirements.saveFailed', 'The requirement was not saved')),
  });
  const saveLinks = useMutation({
    mutationFn: (items: Array<{ type: 'ui' | 'api'; id: number }>) => send('PUT', `/api/requirements/${linking!.row.id}/tests`, { items }),
    onSuccess: async () => {
      setLinking(null);
      await refresh();
      toast({ title: t('requirements.linksSaved', 'Tests linked') });
    },
    onError: onError(t('requirements.linksFailed', 'The tests were not linked')),
  });
  const remove = useMutation({
    mutationFn: (row: RequirementRow) => send('DELETE', `/api/requirements/${row.id}`),
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
      toast({ title: t('requirements.deleted', 'Requirement deleted') });
    },
    onError: onError(t('requirements.deleteFailed', 'The requirement was not deleted')),
  });
  const importer = useMutation({
    mutationFn: (request: ImportRequest & { sync?: boolean }) =>
      send('POST', request.sync ? '/api/requirements/sync' : '/api/requirements/import', { trackerId: request.trackerId, keys: request.keys, query: request.query }),
    onSuccess: async (result: { created: string[]; updated: string[]; missing: string[] }) => {
      setImporting(false);
      await refresh();
      toast({
        title: t('requirements.import.done', '{{created}} new, {{updated}} updated', { created: result.created.length, updated: result.updated.length }),
        description: result.missing.length ? t('requirements.import.missing', 'Not found in the tracker: {{keys}}', { keys: result.missing.join(', ') }) : undefined,
      });
    },
    onError: onError(t('requirements.import.failed', 'The import failed')),
  });

  const openLinks = async (row: RequirementRow) => {
    try {
      const detail = await send('GET', `/api/requirements/${row.id}`);
      setLinking({ row, tests: detail.tests });
    } catch (err) {
      onError(t('requirements.loadFailed', 'The requirement could not be loaded'))(err as Error);
    }
  };

  // The tree in display order: each requirement under its parent, a filtered-out parent's
  // children promoted so a match is never hidden by its epic not matching.
  const ordered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = (row: RequirementRow) =>
      (!needle || row.key.toLowerCase().includes(needle) || row.title.toLowerCase().includes(needle)) &&
      (stateFilter === ALL || row.coverage.state === stateFilter);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const children = new Map<number | null, RequirementRow[]>();
    for (const row of rows) {
      const parent = row.parentId != null && byId.has(row.parentId) ? row.parentId : null;
      children.set(parent, [...(children.get(parent) ?? []), row]);
    }
    const out: Array<{ row: RequirementRow; depth: number; hasChildren: boolean }> = [];
    const seen = new Set<number>();
    const walk = (parent: number | null, depth: number) => {
      for (const row of children.get(parent) ?? []) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const kids = children.get(row.id) ?? [];
        if (matches(row)) out.push({ row, depth, hasChildren: kids.length > 0 });
        if (!collapsed.has(row.id) || !matches(row)) walk(row.id, matches(row) ? depth + 1 : depth);
      }
    };
    walk(null, 0);
    return out;
  }, [rows, search, stateFilter, collapsed]);

  const toggle = (set: Set<number>, id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const summary = data?.summary;
  const tiles: Array<{ label: string; value: string; state?: CoverageState }> = summary
    ? [
        { label: t('requirements.summary.total', 'Requirements'), value: String(summary.total) },
        { label: t('requirements.summary.covered', 'With tests'), value: `${summary.coveredPercent}%` },
        { label: stateLabel('passing'), value: String(summary.passing), state: 'passing' },
        { label: stateLabel('failing'), value: String(summary.failing), state: 'failing' },
        { label: stateLabel('notRun'), value: String(summary.notRun), state: 'notRun' },
        { label: stateLabel('uncovered'), value: String(summary.uncovered), state: 'uncovered' },
      ]
    : [];

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <PageHeader
        className="mb-6"
        title={t('requirements.title', 'Requirements')}
        description={t('requirements.pageDescription', 'Epics, user stories and requirements, the tests that cover them, and how those tests did the last time they ran.')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href={`/api/requirements/matrix.csv${scopeQuery}`} download>
                <Download className="mr-1 h-4 w-4" /> {t('requirements.export', 'Export matrix (CSV)')}
              </a>
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => setImporting(true)}>
                  <Upload className="mr-1 h-4 w-4" /> {t('requirements.import.open', 'Import from tracker')}
                </Button>
                <Button onClick={() => setEditing('new')}>
                  <Plus className="mr-1 h-4 w-4" /> {t('requirements.create', 'New requirement')}
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        {executionId ? (
          <div className="flex items-center gap-2 rounded border px-3 py-2 text-sm" data-testid="requirements-run-scope">
            <span>
              {data?.scope?.kind === 'execution'
                ? t('requirements.scope.run', 'Results of one run of {{plan}}', { plan: data.scope.planName ?? '' })
                : t('requirements.scope.runLoading', 'Results of one run')}
            </span>
            {data?.scope?.kind === 'execution' && (
              <Link href={`/test-plans/${data.scope.planId}/executions/${data.scope.id}/report`} className="underline">
                {t('requirements.scope.openReport', 'Open the report')}
              </Link>
            )}
            <Button size="sm" variant="ghost" onClick={() => setExecutionId(null)}>
              {t('requirements.scope.clear', 'Show latest results')}
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            <label htmlFor="requirements-scope" className="text-xs text-muted-foreground">
              {t('requirements.scope.label', 'Results from')}
            </label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger id="requirements-scope" className="w-64" aria-label={t('requirements.scope.label', 'Results from')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('requirements.scope.all', 'The latest run of each test')}</SelectItem>
                {(Array.isArray(plans) ? plans : []).map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {t('requirements.scope.plan', 'The latest run of {{plan}}', { plan: plan.name })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Input className="w-64" placeholder={t('requirements.search', 'Search key or title…')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('requirements.search', 'Search key or title…')} />
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-48" aria-label={t('requirements.filterState', 'Coverage')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('requirements.allStates', 'Any coverage')}</SelectItem>
            {COVERAGE_STATES.map((state) => (
              <SelectItem key={state} value={state}>
                {stateLabel(state)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {tiles.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="requirements-summary">
          {tiles.map((tile) => {
            const Icon = tile.state ? STATE_LOOK[tile.state].icon : null;
            return (
              <Card key={tile.label}>
                <CardContent className="p-4">
                  <div className={`flex items-center gap-1 text-xs ${tile.state ? STATE_LOOK[tile.state].className : 'text-muted-foreground'}`}>
                    {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />} {tile.label}
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('requirements.loading', 'Loading…')}</p>
          ) : isError ? (
            <p className="text-sm text-destructive">{error?.message ?? t('requirements.error', 'The requirements could not be loaded.')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="requirements-empty">
              {t('requirements.empty', 'No requirements yet. Import epics and stories from Jira or Azure DevOps, or add one by hand, then link the tests that cover it.')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('requirements.columns.requirement', 'Requirement')}</TableHead>
                  <TableHead>{t('requirements.columns.kind', 'Kind')}</TableHead>
                  <TableHead>{t('requirements.columns.trackerStatus', 'Tracker status')}</TableHead>
                  <TableHead>{t('requirements.columns.coverage', 'Coverage')}</TableHead>
                  <TableHead>{t('requirements.columns.tests', 'Tests')}</TableHead>
                  <TableHead className="text-right">{t('requirements.columns.actions', 'Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordered.map(({ row, depth, hasChildren }) => (
                  <React.Fragment key={row.id}>
                    <TableRow data-testid={`requirement-${row.key}`}>
                      <TableCell>
                        <div className="flex items-start gap-1" style={{ paddingLeft: depth * 20 }}>
                          {hasChildren ? (
                            <button
                              type="button"
                              className="mt-0.5 text-muted-foreground"
                              onClick={() => setCollapsed((current) => toggle(current, row.id))}
                              aria-label={collapsed.has(row.id) ? t('requirements.expand', 'Show what it contains') : t('requirements.collapse', 'Hide what it contains')}
                              aria-expanded={!collapsed.has(row.id)}
                            >
                              {collapsed.has(row.id) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                          ) : (
                            <span className="w-4" />
                          )}
                          <div>
                            <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                              {row.url ? (
                                <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                                  {row.key} <ExternalLink className="h-3 w-3" aria-hidden />
                                </a>
                              ) : (
                                row.key
                              )}
                            </div>
                            <div className="font-medium">{row.title}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.kind === 'epic' ? 'secondary' : 'outline'}>
                          {t(`requirements.kind.${row.kind}`, row.kind === 'epic' ? 'Epic' : row.kind === 'story' ? 'User story' : 'Requirement')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.externalStatus ?? '—'}</TableCell>
                      <TableCell>
                        <StateBadge state={row.coverage.state} />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="text-sm underline-offset-2 hover:underline disabled:no-underline"
                          onClick={() => setExpanded((current) => toggle(current, row.id))}
                          disabled={row.coverage.tests.length === 0}
                          aria-expanded={expanded.has(row.id)}
                        >
                          {t('requirements.testCounts', '{{passed}} passed · {{failed}} failed · {{notRun}} not run', {
                            passed: row.coverage.passed,
                            failed: row.coverage.failed,
                            notRun: row.coverage.notRun,
                          })}
                        </button>
                        {row.coverage.hidden > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {t('requirements.hiddenTests', '+{{count}} in projects you cannot see', { count: row.coverage.hidden })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1 whitespace-nowrap">
                        {canEdit && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => openLinks(row)}>
                              <Link2 className="mr-1 h-4 w-4" /> {t('requirements.linkTests', 'Tests')}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setEditing(row)} aria-label={t('requirements.edit', 'Edit')}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setDeleting(row)} aria-label={t('requirements.delete', 'Delete')}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded.has(row.id) &&
                      row.coverage.tests.map((test) => (
                        <TableRow key={`${row.id}-${test.type}-${test.id}`} className="bg-muted/40" data-testid={`requirement-${row.key}-test-${test.type}-${test.id}`}>
                          <TableCell colSpan={3}>
                            <div className="flex items-center gap-2 text-sm" style={{ paddingLeft: depth * 20 + 24 }}>
                              <Badge variant="outline">{test.type === 'ui' ? t('requirements.web', 'Web') : 'API'}</Badge>
                              {test.name}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{outcomeLabel(test.outcome)}</TableCell>
                          <TableCell colSpan={2} className="text-sm text-muted-foreground">
                            {test.lastRun ? (
                              <Link href={`/test-plans/${test.lastRun.planId}/executions/${test.lastRun.executionId}/report`} className="underline">
                                {test.lastRun.planName ?? t('requirements.run', 'Run')}
                                {test.lastRun.at ? ` · ${new Date(test.lastRun.at).toLocaleString()}` : ''}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </React.Fragment>
                ))}
                {ordered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">
                      {t('requirements.noMatch', 'Nothing matches the filters.')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RequirementDialog
        isOpen={editing !== null}
        requirement={editing && editing !== 'new' ? editing : null}
        options={rows.map((row) => ({ id: row.id, key: row.key, title: row.title, kind: row.kind }))}
        saving={save.isPending}
        onClose={() => setEditing(null)}
        onSave={(payload) => save.mutate(payload)}
      />
      <LinkTestsDialog
        isOpen={linking !== null}
        requirement={linking ? { key: linking.row.key, title: linking.row.title, tests: linking.tests } : null}
        saving={saveLinks.isPending}
        onClose={() => setLinking(null)}
        onSave={(items) => saveLinks.mutate(items)}
      />
      <ImportRequirementsDialog
        isOpen={importing}
        trackers={data?.trackers ?? []}
        busy={importer.isPending}
        onClose={() => setImporting(false)}
        onImport={(request) => importer.mutate(request)}
        onSync={(trackerId) => importer.mutate({ trackerId, sync: true })}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('requirements.deleteTitle', 'Delete {{key}}?', { key: deleting?.key ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('requirements.deleteBody', 'Its links to tests go with it; the tests and their results stay. What it contains moves to the top level. Nothing changes in the tracker.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('requirements.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting)}>
              {remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('requirements.delete', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default RequirementsPage;

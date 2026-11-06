import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Download, ExternalLink, Loader2, Play, Search } from 'lucide-react';
import { HUB_RESULT_STATUSES, type HubResultStatus } from '@shared/hub-waves';
import { hubErrorMessage } from '@/hooks/useTestCaseHub';
import {
  hubWaveExportUrl,
  useCreateWaveSession,
  useHubWave,
  useHubWaveResults,
  type HubWaveResultFilters,
} from '@/hooks/useHubWaves';
import {
  HubResultStatusBadge,
  RatesCell,
  WaveStateBadge,
  downloadFrom,
  useStatusLabel,
} from './HubWaveBits';

/**
 * One wave: its numbers by module and by tester, its cases with their results, and the two
 * things a person does with it — run (some of) its cases again as a new plan, and take the
 * results back to the hub as a file.
 */

const ALL = 'all';

interface Props {
  waveRowId: number | null;
  onOpenChange: (open: boolean) => void;
}

const HubWaveDetailDialog: React.FC<Props> = ({ waveRowId, onOpenChange }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = user?.role !== 'viewer';
  const statusLabel = useStatusLabel();

  const { data: wave, isLoading } = useHubWave(waveRowId);
  const { search, setSearch, debouncedSearch, page, setPage, pageSize, setPageSize } =
    useCatalogControls();
  const [module, setModule] = useState(ALL);
  const [status, setStatus] = useState<HubResultStatus | typeof ALL>(ALL);
  const [rerunStatuses, setRerunStatuses] = useState<Set<HubResultStatus>>(
    () => new Set(['failed', 'on_hold']),
  );
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setModule(ALL);
    setStatus(ALL);
    setSearch('');
  }, [waveRowId, setSearch]);
  useEffect(() => {
    setPage(1);
  }, [module, status, debouncedSearch, setPage]);

  const filters = useMemo<HubWaveResultFilters>(
    () => ({
      module: module === ALL ? undefined : module,
      status: status === ALL ? undefined : status,
      q: debouncedSearch || undefined,
      page,
      pageSize,
    }),
    [module, status, debouncedSearch, page, pageSize],
  );
  const { data: results, isFetching } = useHubWaveResults(waveRowId, filters);
  const session = useCreateWaveSession(waveRowId);

  const modules = (wave?.byModule ?? []).map((row) => row.module).filter(Boolean) as string[];

  const createSession = () =>
    session.mutate(
      {
        modules: module === ALL ? undefined : [module],
        statuses: rerunStatuses.size ? Array.from(rerunStatuses) : undefined,
      },
      {
        onSuccess: (result) =>
          toast({
            title: t('hubWaves.session.created', 'Session ready to run'),
            description: t('hubWaves.session.summary', {
              defaultValue:
                'The plan “{{name}}” holds {{tests}} tests. {{notImported}} chosen cases are not tests yet.',
              name: result.name,
              tests: result.tests,
              notImported: result.notImported,
            }),
          }),
        onError: (error) =>
          toast({
            title: t('hubWaves.session.failed', 'The session could not be created'),
            description: hubErrorMessage(error, t),
            variant: 'destructive',
          }),
      },
    );

  const exportAs = async (format: 'json' | 'csv', forModule?: string) => {
    if (!waveRowId || !wave) return;
    setExporting(true);
    try {
      await downloadFrom(
        format === 'json'
          ? hubWaveExportUrl(waveRowId, { format, module: forModule ?? '' })
          : hubWaveExportUrl(waveRowId, {
              format,
              modules: module === ALL ? undefined : [module],
            }),
        format === 'json' ? `results_${forModule}.json` : `${wave.waveId}_results.csv`,
      );
    } catch (error) {
      toast({
        title: t('hubWaves.export.failed', 'The export failed'),
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  const toggleRerun = (value: HubResultStatus, checked: boolean) =>
    setRerunStatuses((previous) => {
      const next = new Set(previous);
      if (checked) next.add(value);
      else next.delete(value);
      return next;
    });

  return (
    <Dialog open={waveRowId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto" data-testid="hub-wave-detail">
        {isLoading || !wave ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-72" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {wave.name}
                <WaveStateBadge wave={wave} />
              </DialogTitle>
              <DialogDescription>
                {[wave.waveId, wave.release, wave.waveType, wave.startDate]
                  .filter(Boolean)
                  .join(' · ')}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-5">
              {HUB_RESULT_STATUSES.map((value) => (
                <div key={value} className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">{statusLabel(value)}</p>
                  <p className="text-xl font-semibold tabular-nums">{wave.counts[value]}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <RatesCell rates={wave.rates} />
              {wave.testPlanId && wave.executionId && (
                <Button variant="link" size="sm" asChild>
                  <Link
                    href={`/test-plans/${wave.testPlanId}/executions/${wave.executionId}/report`}
                  >
                    <ExternalLink className="mr-1 h-4 w-4" />
                    {t('hubWaves.detail.openRun', 'Open the run')}
                  </Link>
                </Button>
              )}
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('hubWaves.detail.byModule', 'By module')}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('hubWaves.columns.module', 'Module')}</TableHead>
                    <TableHead className="text-right">{t('hubWaves.columns.cases', 'Cases')}</TableHead>
                    <TableHead className="text-right">{statusLabel('failed')}</TableHead>
                    <TableHead>{t('hubWaves.columns.rates', 'Progress')}</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wave.byModule.map((row) => (
                    <TableRow key={row.module ?? ''}>
                      <TableCell>{row.module ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.rates.total}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.counts.failed}</TableCell>
                      <TableCell>
                        <RatesCell rates={row.rates} />
                      </TableCell>
                      <TableCell>
                        {row.module && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={exporting}
                            onClick={() => exportAs('json', row.module ?? undefined)}
                            title={t(
                              'hubWaves.export.jsonHint',
                              'The module’s results file, as the hub keeps it, with the verdicts given in WebFlowMaster',
                            )}
                            data-testid={`hub-wave-export-json-${row.module}`}
                          >
                            <Download className="mr-1 h-4 w-4" />
                            JSON
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="mr-auto text-sm font-semibold">
                  {t('hubWaves.detail.results', 'Results')}
                </h3>
                <div className="relative min-w-[200px]">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('hubWaves.detail.search', 'Search id, notes, bug…')}
                    className="pl-8"
                    aria-label={t('hubWaves.detail.search', 'Search id, notes, bug…')}
                    data-testid="hub-wave-search"
                  />
                </div>
                <Select value={module} onValueChange={setModule}>
                  <SelectTrigger className="w-[180px]" aria-label={t('hubWaves.columns.module', 'Module')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('hubWaves.detail.allModules', 'All modules')}</SelectItem>
                    {modules.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={status} onValueChange={(value) => setStatus(value as HubResultStatus)}>
                  <SelectTrigger className="w-[160px]" aria-label={t('hubWaves.columns.status', 'Status')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('hubWaves.detail.allStatuses', 'All statuses')}</SelectItem>
                    {HUB_RESULT_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {statusLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting}
                  onClick={() => exportAs('csv')}
                  data-testid="hub-wave-export-csv"
                >
                  {exporting ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-1 h-4 w-4" />
                  )}
                  CSV
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('hubWaves.columns.case', 'Case')}</TableHead>
                    <TableHead>{t('hubWaves.columns.module', 'Module')}</TableHead>
                    <TableHead>{t('hubWaves.columns.status', 'Status')}</TableHead>
                    <TableHead>{t('hubWaves.columns.tester', 'Tester')}</TableHead>
                    <TableHead>{t('hubWaves.columns.stage', 'Stage')}</TableHead>
                    <TableHead>{t('hubWaves.columns.build', 'Build')}</TableHead>
                    <TableHead>{t('hubWaves.columns.bug', 'Bug')}</TableHead>
                    <TableHead>{t('hubWaves.columns.notes', 'Notes')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(results?.results ?? []).map((row) => (
                    <TableRow key={row.id} data-testid={`hub-wave-result-${row.caseId}`}>
                      <TableCell className="whitespace-nowrap">
                        <div className="font-mono text-xs">{row.rawCaseId}</div>
                        <div className="max-w-[260px] truncate text-xs text-muted-foreground">
                          {row.featureHighlight ?? row.objective ?? ''}
                        </div>
                        {!row.inCatalog && (
                          <Badge variant="outline" className="mt-1">
                            {t('hubWaves.detail.notInCatalog', 'Not in the catalog')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{row.module ?? '—'}</TableCell>
                      <TableCell>
                        <HubResultStatusBadge status={row.status} />
                        {row.attemptCount > 1 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ×{row.attemptCount}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{row.executedBy ?? row.assignedTester ?? '—'}</TableCell>
                      <TableCell>{row.stage ?? '—'}</TableCell>
                      <TableCell>{row.buildNumber ?? '—'}</TableCell>
                      <TableCell>{row.bugReference ?? '—'}</TableCell>
                      <TableCell className="max-w-[260px] truncate" title={row.notes ?? undefined}>
                        {row.notes ?? ''}
                      </TableCell>
                    </TableRow>
                  ))}
                  {results && results.results.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        {t('hubWaves.detail.noResults', 'No case matches these filters.')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {results && (
                <CatalogPagination
                  page={page}
                  pageSize={pageSize}
                  total={results.total}
                  busy={isFetching}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              )}
            </section>

            {canEdit && (
              <section className="space-y-2 rounded-md border p-4" data-testid="hub-wave-session">
                <h3 className="text-sm font-semibold">
                  {t('hubWaves.session.title', 'Run the cases again')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'hubWaves.session.description',
                    'A new test plan with the cases of this wave that are tests in WebFlowMaster, from the module chosen above and with the results ticked here.',
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-4">
                  {HUB_RESULT_STATUSES.map((value) => (
                    <div key={value} className="flex items-center gap-2">
                      <Checkbox
                        id={`hubWaveRerun-${value}`}
                        checked={rerunStatuses.has(value)}
                        onCheckedChange={(checked) => toggleRerun(value, checked === true)}
                      />
                      <Label htmlFor={`hubWaveRerun-${value}`} className="font-normal">
                        {statusLabel(value)}
                      </Label>
                    </div>
                  ))}
                  <Button
                    className="ml-auto"
                    onClick={createSession}
                    disabled={session.isPending}
                    data-testid="hub-wave-session-create"
                  >
                    {session.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-4 w-4" />
                    )}
                    {t('hubWaves.session.create', 'Create the plan')}
                  </Button>
                </div>
                {session.data && (
                  <p className="text-sm">
                    <Link href={`/test-plan/${session.data.testPlanId}/run`} className="underline">
                      {t('hubWaves.session.open', {
                        defaultValue: 'Run “{{name}}”',
                        name: session.data.name,
                      })}
                    </Link>
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default HubWaveDetailDialog;

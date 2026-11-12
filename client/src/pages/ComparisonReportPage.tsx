import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRoute } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  RESULT_VERDICT_FALLBACK,
  ResultVerdictBadge,
  ReviewStatusBadge,
  StatusBadge,
  VerdictBadge,
} from '@/components/comparisons/labels';
import DiffChart from '@/components/comparisons/DiffChart';
import DiffImage from '@/components/comparisons/DiffImage';
import DiffTable from '@/components/comparisons/DiffTable';
import ReviewDialog from '@/components/comparisons/ReviewDialog';
import {
  cancelComparison,
  getComparison,
  getComparisonResult,
  listComparisonResults,
  type ComparedStepView,
  type ComparisonResultDetail,
  type ComparisonResultRow,
  type ComparisonSide,
} from '@/lib/api/comparisons';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTime } from '@/lib/dates';
import {
  COMPARISON_RESULT_VERDICTS,
  isTerminalComparisonStatus,
  type ComparisonDifference,
  type VerdictCounts,
} from '@shared/comparison';

/**
 * One comparison: the verdict, the counts by test verdict, parity by module, and the tests one
 * by one. Opening a test shows each difference with both sides: the outcome, the checkpoint
 * texts, and for a visual difference the two screenshots next to each other.
 */

const ALL = 'all';
const PAGE_SIZE = 50;

/** Identical and equivalent tests are at parity; the share of them is what a module scores. */
const parityOf = (counts: VerdictCounts, total: number) =>
  total === 0 ? null : Math.round(((counts.identical + counts.equivalent) / total) * 100);

function RunLink({ planId, side, label }: { planId: string; side: ComparisonSide; label: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{side.environmentName}</div>
      {side.executionId ? (
        <Link
          href={`/test-plans/${planId}/executions/${side.executionId}/report`}
          className="text-xs underline"
        >
          {t('comparisons.report.openRun', 'Open its run')}
        </Link>
      ) : (
        <div className="text-xs text-muted-foreground">
          {t('comparisons.report.notStarted', 'Not started yet')}
        </div>
      )}
    </div>
  );
}

/** A visual difference carries `{ screenshot }` on each side, a URL the browser can open. */
const screenshotOf = (value: unknown): string | null =>
  (value as { screenshot?: string | null } | null)?.screenshot ?? null;

function SideValue({
  difference,
  side,
}: {
  difference: ComparisonDifference;
  side: 'baseline' | 'candidate';
}) {
  const value = difference[side];
  return (
    <pre className="text-xs bg-muted rounded p-2 whitespace-pre-wrap break-words max-h-64 overflow-auto">
      {value === undefined || value === null
        ? '—'
        : typeof value === 'string'
          ? value
          : JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** The checkpoint a step of one side captured under this name, as the grids draw it. */
function checkpointData(
  steps: ComparedStepView[] | undefined,
  name: string,
  kind: 'table' | 'chart',
): unknown {
  const step = steps?.find((s) => s.checkpoint?.name === name && s.checkpoint.kind === kind);
  return step?.checkpoint?.data ?? null;
}

/** One grid or chart per table and chart checkpoint that differs, both sides drawn together. */
function CheckpointViews({ data }: { data: ComparisonResultDetail }) {
  const { t } = useTranslation();
  const seen = new Map<string, { kind: 'table' | 'chart'; name: string }>();
  for (const difference of data.differences)
    if ((difference.kind === 'table' || difference.kind === 'chart') && difference.checkpoint)
      seen.set(`${difference.kind}:${difference.checkpoint}`, {
        kind: difference.kind,
        name: difference.checkpoint,
      });
  if (seen.size === 0 || !data.steps) return null;
  return (
    <div className="space-y-4">
      {[...seen.entries()].map(([key, { kind, name }]) => {
        const baseline = checkpointData(data.steps?.baseline, name, kind);
        const candidate = checkpointData(data.steps?.candidate, name, kind);
        return (
          <section key={key} className="space-y-1">
            <h4 className="text-sm font-medium">
              {t(`comparisons.kinds.${kind}`, kind)}{' '}
              {t('comparisons.report.checkpoint', 'checkpoint “{{name}}”', { name })}
            </h4>
            {kind === 'table' ? (
              <DiffTable
                baseline={baseline}
                candidate={candidate}
                differences={data.differences.filter(
                  (d) => d.kind === 'table' && d.checkpoint === name,
                )}
              />
            ) : (
              <DiffChart baseline={baseline} candidate={candidate} />
            )}
          </section>
        );
      })}
    </div>
  );
}

function ResultDetail({
  comparisonId,
  resultId,
  canEdit,
}: {
  comparisonId: string;
  resultId: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<ComparisonResultDetail | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['comparisonResult', comparisonId, resultId],
    queryFn: () => getComparisonResult(comparisonId, resultId),
  });
  if (isLoading)
    return <p className="text-sm text-muted-foreground">{t('comparisons.loading', 'Loading…')}</p>;
  if (isError || !data)
    return (
      <p className="text-sm text-destructive">
        {t('comparisons.report.resultError', 'This test could not be loaded.')}
      </p>
    );
  if (data.hidden)
    return (
      <p className="text-sm text-muted-foreground">
        {t('comparisons.report.hidden', 'You may not see the details of this test.')}
      </p>
    );
  const review = (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="review">
      <ReviewStatusBadge status={data.reviewStatus} />
      {data.reviewNote && <span className="text-xs text-muted-foreground">{data.reviewNote}</span>}
      {canEdit && (
        <Button variant="outline" size="sm" onClick={() => setReviewing(data)}>
          {t('comparisons.review.open', 'Review')}
        </Button>
      )}
      <ReviewDialog
        comparisonId={comparisonId}
        result={reviewing}
        onClose={() => setReviewing(null)}
        onReviewed={() => {
          queryClient.invalidateQueries({ queryKey: ['comparisonResult', comparisonId, resultId] });
          queryClient.invalidateQueries({ queryKey: ['comparisonResults', comparisonId] });
          queryClient.invalidateQueries({ queryKey: ['comparisonKnownDifferences'] });
        }}
      />
    </div>
  );
  if (data.differences.length === 0)
    return (
      <div className="space-y-3">
        {review}
        <p className="text-sm text-muted-foreground">
          {t('comparisons.report.noDifferences', 'No difference between the two runs.')}
        </p>
      </div>
    );
  return (
    <div className="space-y-4">
      {review}
      <CheckpointViews data={data} />
      <ul className="space-y-3" data-testid="differences">
        {data.differences.map((difference, index) => (
          <li key={index} className="border rounded p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">
                {t(`comparisons.kinds.${difference.kind}`, difference.kind)}
              </span>
              {difference.stepIndex >= 0 && (
                <span className="text-xs text-muted-foreground">
                  {t('comparisons.report.step', 'step {{n}}', { n: difference.stepIndex + 1 })}
                </span>
              )}
              {difference.checkpoint && (
                <span className="text-xs">
                  {t('comparisons.report.checkpoint', 'checkpoint “{{name}}”', {
                    name: difference.checkpoint,
                  })}
                </span>
              )}
              {difference.path && (
                <code className="text-xs text-muted-foreground">{difference.path}</code>
              )}
              <span
                className={
                  difference.severity === 'blocking'
                    ? 'text-xs text-destructive'
                    : 'text-xs text-muted-foreground'
                }
              >
                {difference.severity === 'blocking'
                  ? t('comparisons.report.blocking', 'blocking')
                  : t('comparisons.report.informative', 'informative')}
              </span>
              {difference.knownDifferenceId && (
                <Badge variant="secondary" data-testid="known-difference">
                  {t('comparisons.report.known', 'known difference')}
                </Badge>
              )}
            </div>
            {difference.kind === 'visual' ? (
              <DiffImage
                baseline={screenshotOf(difference.baseline)}
                candidate={screenshotOf(difference.candidate)}
              />
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    {t('comparisons.baseline', 'Baseline')}
                  </div>
                  <SideValue difference={difference} side="baseline" />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    {t('comparisons.candidate', 'Candidate')}
                  </div>
                  <SideValue difference={difference} side="candidate" />
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultRow({
  comparisonId,
  row,
  canEdit,
}: {
  comparisonId: string;
  row: ComparisonResultRow;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow data-testid={`result-${row.id}`}>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="ml-1">{row.testName}</span>
          </Button>
        </TableCell>
        <TableCell className="text-xs">{row.module || '—'}</TableCell>
        <TableCell className="text-xs">{row.browser || '—'}</TableCell>
        <TableCell>
          <ResultVerdictBadge verdict={row.verdict} />
        </TableCell>
        <TableCell className="text-xs">{row.differenceCount}</TableCell>
        <TableCell>
          <ReviewStatusBadge status={row.reviewStatus} />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={6}>
            <ResultDetail comparisonId={comparisonId} resultId={row.id} canEdit={canEdit} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function ComparisonReportPage() {
  const { t } = useTranslation();
  const [, params] = useRoute('/comparisons/:id');
  const id = params?.id ?? '';
  const { user } = useAuth();
  const canEdit = user?.role !== 'viewer';
  const queryClient = useQueryClient();
  const [verdict, setVerdict] = useState(ALL);
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const {
    data: comparison,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['comparison', id],
    queryFn: () => getComparison(id),
    enabled: id !== '',
    refetchInterval: (query) =>
      query.state.data && !isTerminalComparisonStatus(query.state.data.status) ? 5000 : false,
  });
  const completed = comparison?.status === 'completed';
  const { data: results } = useQuery({
    queryKey: ['comparisonResults', id, verdict, page],
    queryFn: () =>
      listComparisonResults(id, {
        verdict: verdict === ALL ? undefined : verdict,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: completed,
  });

  const cancel = async () => {
    setCancelling(true);
    setCancelError('');
    try {
      await cancelComparison(id);
    } catch (e) {
      setCancelError((e as Error).message);
    } finally {
      setCancelling(false);
      queryClient.invalidateQueries({ queryKey: ['comparison', id] });
    }
  };

  if (isLoading)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t('comparisons.loading', 'Loading…')}
      </div>
    );
  if (isError || !comparison)
    return (
      <div className="p-6 text-sm text-destructive">
        {t('comparisons.report.notFound', 'This comparison could not be found.')}
      </div>
    );

  const summary = comparison.summary;
  const pages = results ? Math.max(1, Math.ceil(results.total / PAGE_SIZE)) : 1;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <Link href="/comparisons" className="text-sm underline">
          {t('comparisons.report.back', 'All comparisons')}
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {comparison.name || comparison.planName || t('comparisons.title', 'Comparison')}
            <StatusBadge status={comparison.status} />
            <VerdictBadge verdict={comparison.verdict} />
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {comparison.planName}
            {' · '}
            {formatDateTime(comparison.createdAt)}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-6">
            <RunLink
              planId={comparison.planId}
              side={comparison.baseline}
              label={t('comparisons.baseline', 'Baseline')}
            />
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            <RunLink
              planId={comparison.planId}
              side={comparison.candidate}
              label={t('comparisons.candidate', 'Candidate')}
            />
            {canEdit && !isTerminalComparisonStatus(comparison.status) && (
              <Button variant="outline" size="sm" onClick={cancel} disabled={cancelling}>
                {cancelling ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <X className="h-4 w-4 mr-1" />
                )}
                {t('comparisons.report.cancel', 'Cancel comparison')}
              </Button>
            )}
          </div>
          {cancelError && <p className="text-sm text-destructive">{cancelError}</p>}
          {comparison.failureMessage && (
            <p className="text-sm text-destructive">{comparison.failureMessage}</p>
          )}
          {!isTerminalComparisonStatus(comparison.status) && (
            <p className="text-sm text-muted-foreground">
              {t(
                'comparisons.report.inProgress',
                'The runs are not finished yet; the results appear here when the comparison completes.',
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {completed && summary && (
        <>
          <div
            className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
            data-testid="verdict-tiles"
          >
            {COMPARISON_RESULT_VERDICTS.map((v) => (
              <Card key={v}>
                <CardContent className="p-4">
                  <div className="text-2xl font-semibold">{summary.byVerdict[v] ?? 0}</div>
                  <div className="text-xs text-muted-foreground">
                    {t(`comparisons.resultVerdicts.${v}`, RESULT_VERDICT_FALLBACK[v])}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {summary.droppedDifferences > 0 && (
            <p className="text-sm text-muted-foreground">
              {t(
                'comparisons.report.dropped',
                '{{n}} more differences were found but not kept: a test had too many.',
                { n: summary.droppedDifferences },
              )}
            </p>
          )}

          {summary.byModule.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t('comparisons.report.byModule', 'Parity by module')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('comparisons.columns.module', 'Module')}</TableHead>
                      <TableHead>{t('comparisons.columns.tests', 'Tests')}</TableHead>
                      <TableHead>{t('comparisons.columns.parity', 'Parity')}</TableHead>
                      <TableHead>{t('comparisons.columns.differing', 'Differing')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.byModule.map((module) => {
                      const parity = parityOf(module.byVerdict, module.total);
                      return (
                        <TableRow key={module.module}>
                          <TableCell>
                            {module.module || t('comparisons.report.noModule', 'No module')}
                          </TableCell>
                          <TableCell>{module.total}</TableCell>
                          <TableCell>{parity === null ? '—' : `${parity}%`}</TableCell>
                          <TableCell>
                            {module.byVerdict.different + module.byVerdict.outcome_mismatch}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
              <CardTitle className="text-base">{t('comparisons.report.tests', 'Tests')}</CardTitle>
              <Select
                value={verdict}
                onValueChange={(value) => {
                  setVerdict(value);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  className="w-[220px]"
                  aria-label={t('comparisons.report.filterVerdict', 'Filter by verdict')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {t('comparisons.report.allVerdicts', 'All tests')}
                  </SelectItem>
                  {COMPARISON_RESULT_VERDICTS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {t(`comparisons.resultVerdicts.${v}`, RESULT_VERDICT_FALLBACK[v])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="space-y-3">
              {!results ? (
                <p className="text-sm text-muted-foreground">
                  {t('comparisons.loading', 'Loading…')}
                </p>
              ) : results.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('comparisons.report.noTests', 'No test with this verdict.')}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('comparisons.columns.test', 'Test')}</TableHead>
                      <TableHead>{t('comparisons.columns.module', 'Module')}</TableHead>
                      <TableHead>{t('comparisons.columns.browser', 'Browser')}</TableHead>
                      <TableHead>{t('comparisons.columns.verdict', 'Verdict')}</TableHead>
                      <TableHead>{t('comparisons.columns.differences', 'Differences')}</TableHead>
                      <TableHead>{t('comparisons.columns.review', 'Review')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.rows.map((row) => (
                      <ResultRow key={row.id} comparisonId={id} row={row} canEdit={canEdit} />
                    ))}
                  </TableBody>
                </Table>
              )}
              {pages > 1 && (
                <div className="flex items-center justify-end gap-2 text-sm">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={t('common.previousPage', 'Previous page')}
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <span>
                    {page} / {pages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={t('common.nextPage', 'Next page')}
                    disabled={page >= pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

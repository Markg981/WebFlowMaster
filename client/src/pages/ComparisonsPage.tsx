import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearch } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronLeft, ChevronRight, GitCompareArrows } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge, VerdictBadge } from '@/components/comparisons/labels';
import { listComparisons } from '@/lib/api/comparisons';
import { formatDateTime } from '@/lib/dates';
import { isTerminalComparisonStatus } from '@shared/comparison';

/**
 * Every comparison of the organization, newest first; `?planId=` narrows it to one plan.
 * A comparison is started from a plan ("Compare environments" on the plans page).
 */
export default function ComparisonsPage() {
  const { t } = useTranslation();
  const planId = new URLSearchParams(useSearch()).get('planId') ?? undefined;
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['comparisons', planId ?? null, page],
    queryFn: () => listComparisons({ planId, page, pageSize }),
    // Refresh while one is still running, so its status and verdict arrive without a reload.
    refetchInterval: (query) =>
      query.state.data?.rows.some((row) => !isTerminalComparisonStatus(row.status)) ? 5000 : false,
  });
  const rows = data?.rows ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-muted-foreground" />
            {t('comparisons.title', 'Environment comparisons')}
          </CardTitle>
          <CardDescription>
            {t(
              'comparisons.description',
              'One plan run on two environments, compared test by test: outcome, checkpoint texts and screenshots. Start one from a plan with "Compare environments".',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {planId && (
            <p className="text-sm">
              {t('comparisons.filteredByPlan', 'Showing one plan only.')}{' '}
              <Link href="/comparisons" className="underline">
                {t('comparisons.showAll', 'Show all')}
              </Link>
            </p>
          )}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('comparisons.loading', 'Loading…')}</p>
          ) : isError ? (
            <p className="text-sm text-destructive">
              {t('comparisons.error', 'The comparisons could not be loaded.')}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('comparisons.empty', 'No comparison yet.')}
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('comparisons.columns.name', 'Comparison')}</TableHead>
                    <TableHead>{t('comparisons.columns.environments', 'Environments')}</TableHead>
                    <TableHead>{t('comparisons.columns.status', 'Status')}</TableHead>
                    <TableHead>{t('comparisons.columns.verdict', 'Verdict')}</TableHead>
                    <TableHead>{t('comparisons.columns.started', 'Started')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} data-testid={`comparison-${row.id}`}>
                      <TableCell>
                        <Link href={`/comparisons/${row.id}`} className="font-medium underline">
                          {row.name || row.planName || row.id.slice(0, 8)}
                        </Link>
                        {row.name && row.planName && (
                          <div className="text-xs text-muted-foreground">{row.planName}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1">
                          {row.baseline.environmentName}
                          <ArrowRight className="h-3 w-3" aria-hidden />
                          {row.candidate.environmentName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell>
                        <VerdictBadge verdict={row.verdict} />
                      </TableCell>
                      <TableCell className="text-xs">{formatDateTime(row.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

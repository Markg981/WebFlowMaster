import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The report's three charts: how the run split, and how it split by priority and by severity.
 *
 * They were placeholders that said "Chart placeholder". Stacked bars rather than pies: the parts
 * of a whole read better along one axis, and a row per priority lines the categories up to be
 * compared. The colours are the report's status colours, and each part carries its name and count
 * in the legend and on hover, so none of it depends on telling colours apart.
 */

export interface OutcomeCounts {
  passed: number;
  failed: number;
  skipped: number;
}

const PARTS: Array<{ key: keyof OutcomeCounts; className: string }> = [
  { key: 'passed', className: 'bg-success' },
  { key: 'failed', className: 'bg-destructive' },
  { key: 'skipped', className: 'bg-yellow-500' },
];

function useLabels() {
  const { t } = useTranslation();
  return {
    t,
    label: (key: keyof OutcomeCounts) =>
      ({
        passed: t('testReportPage.outcome.passed', 'Passed'),
        failed: t('testReportPage.outcome.failed', 'Failed'),
        skipped: t('testReportPage.outcome.skipped', 'Skipped'),
      })[key],
  };
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** One bar, split into its outcomes; 2px gaps between parts, rounded at the ends. */
function StackedBar({ counts, scale, label }: { counts: OutcomeCounts; scale: number; label: string }) {
  const { label: name } = useLabels();
  const total = counts.passed + counts.failed + counts.skipped;
  return (
    <div className="flex h-3 w-full gap-[2px]" role="img" aria-label={label}>
      {PARTS.filter((part) => counts[part.key] > 0).map((part, index, shown) => (
        <div
          key={part.key}
          className={`${part.className} h-full ${index === 0 ? 'rounded-l' : ''} ${index === shown.length - 1 ? 'rounded-r' : ''}`}
          style={{ width: `${(counts[part.key] / (scale || 1)) * 100}%` }}
          title={`${name(part.key)}: ${counts[part.key]} (${percent(counts[part.key], total)}%)`}
        />
      ))}
    </div>
  );
}

function Legend({ counts }: { counts: OutcomeCounts }) {
  const { label } = useLabels();
  const total = counts.passed + counts.failed + counts.skipped;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {PARTS.map((part) => (
        <li key={part.key} className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-sm ${part.className}`} aria-hidden />
          <span className="text-foreground">{label(part.key)}</span>
          <span>
            {counts[part.key]} · {percent(counts[part.key], total)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OutcomeChart({ title, counts }: { title: string; counts: OutcomeCounts | null | undefined }) {
  const { t } = useLabels();
  const safe = counts ?? { passed: 0, failed: 0, skipped: 0 };
  const total = safe.passed + safe.failed + safe.skipped;
  return (
    <Card className="flex-1 min-w-[300px]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">{t('testReportPage.charts.noData', 'No results to chart.')}</p>
        ) : (
          <>
            <p className="text-2xl font-semibold">
              {percent(safe.passed, total)}%{' '}
              <span className="text-sm font-normal text-muted-foreground">{t('testReportPage.charts.passedOf', 'passed of {{total}}', { total })}</span>
            </p>
            <StackedBar counts={safe} scale={total} label={title} />
            <Legend counts={safe} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** A row per category (priority, severity), on one shared scale so the rows compare. */
export function BreakdownChart({
  title,
  data,
}: {
  title: string;
  data: Record<string, OutcomeCounts & { total?: number }> | null | undefined;
}) {
  const { t } = useLabels();
  const rows = Object.entries(data ?? {})
    .map(([name, counts]) => ({ name, counts, total: counts.passed + counts.failed + counts.skipped }))
    .filter((row) => row.total > 0);
  const max = Math.max(0, ...rows.map((row) => row.total));
  const summed = rows.reduce(
    (sum, row) => ({ passed: sum.passed + row.counts.passed, failed: sum.failed + row.counts.failed, skipped: sum.skipped + row.counts.skipped }),
    { passed: 0, failed: 0, skipped: 0 },
  );
  return (
    <Card className="flex-1 min-w-[300px]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('testReportPage.charts.noData', 'No results to chart.')}</p>
        ) : (
          <>
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.name} className="grid grid-cols-[88px_1fr_32px] items-center gap-2 text-xs">
                  <span className="truncate" title={row.name}>{row.name}</span>
                  <StackedBar counts={row.counts} scale={max} label={`${title}: ${row.name}`} />
                  <span className="text-right text-muted-foreground">{row.total}</span>
                </div>
              ))}
            </div>
            <Legend counts={summed} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

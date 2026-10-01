import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Gauge } from 'lucide-react';
import { readApiResultLog } from '@shared/api-performance';

/**
 * The API tests of a run that checked their response times (shared/api-performance.ts): how many
 * requests, the percentiles, the errors, and which threshold was exceeded. Hidden when none did.
 */

export interface PerformanceResultRow {
  id: string;
  testName: string;
  browser?: string | null;
  detailedLog: string | null;
}

export default function PerformanceResultsCard({ rows }: { rows: PerformanceResultRow[] }) {
  const { t } = useTranslation();
  const timed = rows.flatMap((row) => {
    const log = readApiResultLog(row.detailedLog);
    return log ? [{ row, summary: log.performance }] : [];
  });
  if (timed.length === 0) return null;

  return (
    <Card data-testid="performance-results">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-5 w-5" /> {t('apiPerformance.reportTitle', 'Response times')}
        </CardTitle>
        <CardDescription>{t('apiPerformance.reportDescription', 'API tests that sent their request several times and checked the times against thresholds.')}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 pr-3">{t('testReportPage.columns.testName', 'Test Name')}</th>
              <th className="py-1 pr-3 text-right">{t('apiPerformance.iterations', 'Requests')}</th>
              <th className="py-1 pr-3 text-right">p50</th>
              <th className="py-1 pr-3 text-right">p95</th>
              <th className="py-1 pr-3 text-right">max</th>
              <th className="py-1 pr-3 text-right">{t('apiPerformance.errorRate', 'Failed requests')}</th>
              <th className="py-1">{t('apiPerformance.verdict', 'Verdict')}</th>
            </tr>
          </thead>
          <tbody>
            {timed.map(({ row, summary }) => (
              <tr key={row.id} className="border-t align-top" data-testid="performance-row">
                <td className="py-1.5 pr-3 font-medium">{row.testName}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {summary.iterations} <span className="text-xs text-muted-foreground">×{summary.concurrency}</span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{summary.p50Ms} ms</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{summary.p95Ms} ms</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{summary.maxMs} ms</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {summary.errorRatePct}%{summary.errors > 0 && <span className="text-xs text-muted-foreground"> ({summary.errors})</span>}
                </td>
                <td className="py-1.5">
                  {summary.breaches.length === 0 ? (
                    <Badge variant="secondary">{t('apiPerformance.withinThresholds', 'within thresholds')}</Badge>
                  ) : (
                    <div className="space-y-0.5">
                      {summary.breaches.map((breach) => (
                        <Badge key={breach} variant="destructive" className="mr-1 font-normal">
                          {breach}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {summary.sampleErrors.length > 0 && <p className="mt-1 text-xs text-muted-foreground break-all">{summary.sampleErrors[0]}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Gauge } from 'lucide-react';
import {
  LIGHTHOUSE_CATEGORIES,
  formatMetric,
  type LighthouseFinding,
  type PerformanceFinding,
  type PerformanceMetric,
} from '@shared/web-performance';

/**
 * The web pages of a run that measured their speed (shared/web-performance.ts): the browser's own
 * Core Web Vitals per measuring step, and Lighthouse's scores, with the limits each one broke.
 * Hidden when no test measured anything.
 */

export interface PagePerformanceRow {
  id: string;
  testName: string;
  browser?: string | null;
  detailedLog: string | null;
}

type MeasuredStep = { name: string; performance?: PerformanceFinding; lighthouse?: LighthouseFinding };

function measuredSteps(detailedLog: string | null): MeasuredStep[] {
  if (!detailedLog) return [];
  try {
    const parsed = JSON.parse(detailedLog);
    const steps = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.steps) ? parsed.steps : [];
    return steps.filter((s: MeasuredStep) => s && (s.performance?.metrics || s.lighthouse?.scores));
  } catch {
    return [];
  }
}

const SHOWN: PerformanceMetric[] = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB', 'TBT', 'WEIGHT'];

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

function Verdict({ checks }: { checks: Array<{ metric: string; ok: boolean | null; text: string }> }) {
  const { t } = useTranslation();
  const broken = checks.filter((c) => c.ok === false);
  if (checks.length === 0) return <span className="text-xs text-muted-foreground">{t('pagePerformance.noLimits', 'no limits')}</span>;
  if (broken.length === 0) return <Badge variant="secondary">{t('pagePerformance.withinLimits', 'within the limits')}</Badge>;
  return (
    <div className="space-y-0.5">
      {broken.map((c) => <Badge key={c.text} variant="destructive" className="mr-1 font-normal">{c.text}</Badge>)}
    </div>
  );
}

export default function PagePerformanceCard({ rows }: { rows: PagePerformanceRow[] }) {
  const { t } = useTranslation();
  const measured = rows.flatMap((row) => measuredSteps(row.detailedLog).map((step, i) => ({ row, step, key: `${row.id}-${i}` })));
  if (measured.length === 0) return null;
  const vitals = measured.filter((m) => m.step.performance);
  const audits = measured.filter((m) => m.step.lighthouse);
  const label = (row: PagePerformanceRow) => (
    <>
      <span className="font-medium">{row.testName}</span>
      {row.browser && <span className="block text-xs text-muted-foreground">{row.browser}</span>}
    </>
  );

  return (
    <Card data-testid="page-performance">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-5 w-5" /> {t('pagePerformance.title', 'Page speed')}
        </CardTitle>
        <CardDescription>
          {t('pagePerformance.description', 'Pages the tests measured: the Core Web Vitals the browser recorded, and Lighthouse scores, against each step’s limits. — means this browser does not measure it.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 overflow-x-auto">
        {vitals.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3">{t('testReportPage.columns.testName', 'Test Name')}</th>
                <th className="py-1 pr-3">{t('pagePerformance.page', 'Page')}</th>
                {SHOWN.map((m) => <th key={m} className="py-1 pr-3 text-right">{m === 'WEIGHT' ? t('pagePerformance.weight', 'Weight') : m}</th>)}
                <th className="py-1">{t('apiPerformance.verdict', 'Verdict')}</th>
              </tr>
            </thead>
            <tbody>
              {vitals.map(({ row, step, key }) => (
                <tr key={key} className="border-t align-top" data-testid="page-performance-row">
                  <td className="py-1.5 pr-3">{label(row)}</td>
                  <td className="py-1.5 pr-3 max-w-[16rem] break-all text-xs">{pathOf(step.performance!.url)}</td>
                  {SHOWN.map((m) => (
                    <td key={m} className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">{formatMetric(m, step.performance!.metrics[m] ?? null)}</td>
                  ))}
                  <td className="py-1.5"><Verdict checks={step.performance!.checks} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {audits.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3">{t('testReportPage.columns.testName', 'Test Name')}</th>
                <th className="py-1 pr-3">Lighthouse</th>
                {LIGHTHOUSE_CATEGORIES.map((c) => <th key={c} className="py-1 pr-3 text-right">{c}</th>)}
                <th className="py-1">{t('apiPerformance.verdict', 'Verdict')}</th>
              </tr>
            </thead>
            <tbody>
              {audits.map(({ row, step, key }) => {
                const audit = step.lighthouse!;
                return (
                  <tr key={key} className="border-t align-top" data-testid="lighthouse-row">
                    <td className="py-1.5 pr-3">{label(row)}</td>
                    <td className="py-1.5 pr-3 text-xs">
                      <span className="block break-all">{pathOf(audit.url)}</span>
                      <span className="text-muted-foreground">{audit.formFactor}</span>
                      {audit.reportUrl && (
                        <a href={audit.reportUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-primary underline">
                          {t('pagePerformance.report', 'report')} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                    {LIGHTHOUSE_CATEGORIES.map((c) => (
                      <td key={c} className="py-1.5 pr-3 text-right tabular-nums">{audit.scores[c] ?? '—'}</td>
                    ))}
                    <td className="py-1.5"><Verdict checks={audit.checks} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

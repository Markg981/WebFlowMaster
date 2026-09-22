import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Repeat } from 'lucide-react';

/**
 * The tests that disagree with themselves.
 *
 * Every run was readable on its own and nothing looked across them, so a test that fails one
 * night and passes the next was investigated fresh each time — and eventually believed less
 * than it should be, which is how a real failure gets waved through as "that one is flaky".
 *
 * This says what happened and how often, and stops there. Why a test is unreliable is not a
 * question the data can answer.
 */

export interface FlakySummary {
  testName: string;
  browser: string | null;
  runs: number;
  passed: number;
  failed: number;
  errored: number;
  flips: number;
  flakiness: number;
  lastStatus: 'passed' | 'failed';
  firstSeen: string;
  lastSeen: string;
}

interface FlakyResponse {
  window: { days: number; since: string; resultsExamined: number };
  thresholds: { minimumRuns: number; minimumFlips: number };
  items: FlakySummary[];
}

interface FlakyTestsCardProps {
  /** Narrows the analysis to one plan; absent means everything this organization has run. */
  planId?: string | null;
  days?: number;
}

const FlakyTestsCard: React.FC<FlakyTestsCardProps> = ({ planId, days = 30 }) => {
  const { t } = useTranslation();

  const { data, isLoading, error } = useQuery<FlakyResponse, Error>({
    queryKey: ['flakyTests', planId ?? 'all', days],
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(days) });
      if (planId) params.set('planId', planId);
      const response = await fetch(`/api/analytics/flaky?${params.toString()}`);
      if (!response.ok) throw new Error('Could not analyse flaky tests');
      return response.json();
    },
  });

  const items = Array.isArray(data?.items) ? data!.items : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center">
          <Repeat className="mr-2 h-5 w-5" />
          {t('flakyTests.title', 'Tests that disagree with themselves')}
        </CardTitle>
        <CardDescription>
          {t(
            'flakyTests.description',
            'Over the last {{days}} days, the tests whose verdict changed from one run to the next. A test that broke and was fixed is not here; one that alternates is.',
            { days: data?.window.days ?? days },
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('flakyTests.loading', 'Looking across recent runs…')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'flakyTests.empty',
              'No test changed its mind in this window — out of {{count}} results examined.',
              { count: data?.window.resultsExamined ?? 0 },
            )}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('flakyTests.columns.test', 'Test')}</TableHead>
                  <TableHead>{t('flakyTests.columns.browser', 'Browser')}</TableHead>
                  <TableHead>{t('flakyTests.columns.history', 'Passed / failed')}</TableHead>
                  <TableHead>{t('flakyTests.columns.flips', 'Changed verdict')}</TableHead>
                  <TableHead>{t('flakyTests.columns.last', 'Last run')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={`${item.testName}-${item.browser ?? 'default'}`}>
                    <TableCell className="font-medium">{item.testName}</TableCell>
                    <TableCell className="text-xs">{item.browser ?? '—'}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {item.passed} / {item.failed}
                      {item.errored > 0 && (
                        <span className="text-muted-foreground">
                          {' '}
                          ({item.errored} {t('flakyTests.errored', 'never ran')})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant={item.flakiness >= 0.5 ? 'destructive' : 'secondary'}>
                        {item.flips}× {t('flakyTests.inRuns', 'in {{runs}} runs', { runs: item.runs })}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className={item.lastStatus === 'passed' ? 'text-green-600' : 'text-destructive'}>
                        {item.lastStatus}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default FlakyTestsCard;

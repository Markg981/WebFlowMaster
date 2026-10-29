import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import QuarantineDialog from './QuarantineDialog';
import AttemptsBadge from './AttemptsBadge';
import { Repeat, ShieldAlert } from 'lucide-react';
import { formatDate } from '@/lib/dates';

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
  /** The test behind the name; null when it has since been deleted. */
  test?: { type: 'ui' | 'api' | 'mobile'; id: number } | null;
  /** Its open quarantine, if it is in one. */
  quarantine?: { id: number; reason: string; since: string } | null;
  browser: string | null;
  /** The rest of the matrix; absent from servers before P14. */
  matrix?: { environment: string | null; locale: string | null; device: string | null };
  runs: number;
  passed: number;
  failed: number;
  errored: number;
  /** Runs that passed only after a retry: a finding even when no verdict ever changed. */
  recoveredByRetry?: number;
  flips: number;
  /** The flips that happened without the test changing underneath — the unexplained ones. */
  unexplainedFlips: number;
  versions: number[];
  changedDuringWindow: boolean;
  flakiness: number;
  lastStatus: 'passed' | 'failed';
  lastAttempts?: number;
  firstSeen: string;
  lastSeen: string;
  signals?: FlakySignal[];
}

/** One retry, flip, error or edit, and the attempt that shows it. */
export interface FlakySignal {
  kind: 'recovered' | 'flip' | 'error' | 'definition_changed';
  at: string;
  version: number | null;
  executionId: string | null;
  planId: string | null;
  unitId: string | null;
  attempt: number | null;
  attempts?: number;
  cause?: string | null;
  causeRecorded?: boolean;
  verdict?: 'passed' | 'failed';
}

/** How many signals the row shows; the run reports have the rest. */
const SHOWN_SIGNALS = 5;

/** The report of the run, opened on the attempt when there is one to open. */
function evidenceHref(signal: FlakySignal): string | null {
  if (!signal.planId || !signal.executionId) return null;
  const base = `/test-plans/${encodeURIComponent(signal.planId)}/executions/${encodeURIComponent(signal.executionId)}/report`;
  if (!signal.unitId) return base;
  const query = new URLSearchParams({ unit: signal.unitId });
  if (signal.attempt !== null) query.set('attempt', String(signal.attempt));
  return `${base}?${query.toString()}`;
}

/**
 * Why the last run's first try failed, when the last run is the latest rescue. Signals come newest
 * first, so that is the first one — and only if it belongs to the last run.
 */
function lastRecoveryCause(
  item: FlakySummary,
): { cause: string | null; recorded: boolean } | undefined {
  const latest = item.signals?.[0];
  if (!latest || latest.kind !== 'recovered' || latest.at !== item.lastSeen) return undefined;
  return { cause: latest.cause ?? null, recorded: latest.causeRecorded ?? false };
}

/** The signals behind a row, each linked to the report of the attempt that shows it. */
function SignalList({ signals }: { signals: FlakySignal[] }) {
  const { t } = useTranslation();
  if (signals.length === 0) return <span className="text-muted-foreground">—</span>;
  const label = (signal: FlakySignal): string => {
    switch (signal.kind) {
      case 'recovered':
        return signal.causeRecorded
          ? t(
              'flakyTests.signal.recovered',
              'Passed on attempt {{attempts}}; first failure: {{cause}}',
              {
                attempts: signal.attempts,
                cause: signal.cause ?? '—',
              },
            )
          : t(
              'flakyTests.signal.recoveredUnknown',
              'Passed on attempt {{attempts}}; why the first failed was not recorded',
              { attempts: signal.attempts },
            );
      case 'flip':
        return t('flakyTests.signal.flip', 'Changed verdict to {{verdict}}', {
          verdict: signal.verdict,
        });
      case 'error':
        return t('flakyTests.signal.error', 'Never ran: infrastructure error');
      case 'definition_changed':
        return t(
          'flakyTests.signal.definitionChanged',
          'Definition changed (version {{version}})',
          {
            version: signal.version ?? '—',
          },
        );
    }
  };
  return (
    <details>
      <summary className="cursor-pointer whitespace-nowrap">
        {t('flakyTests.signals', '{{count}} signals', { count: signals.length })}
      </summary>
      <ul className="mt-1 space-y-1">
        {signals.slice(0, SHOWN_SIGNALS).map((signal, index) => {
          const href = evidenceHref(signal);
          const text = `${formatDate(signal.at)} · ${label(signal)}`;
          return (
            <li key={`${signal.kind}-${signal.at}-${index}`} data-signal={signal.kind}>
              {href ? (
                <a href={href} className="underline hover:text-primary">
                  {text}
                </a>
              ) : (
                text
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
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
  const { user } = useAuth();
  const canEdit = user?.role !== 'viewer';
  /** The test whose quarantine is being asked for, if any. */
  const [quarantining, setQuarantining] = useState<FlakySummary | null>(null);

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
            'Over the last {{days}} days, the tests whose verdict changed from one run to the next with nothing to explain it, and those that passed only when the run tried them again. A test that broke and was fixed is not here, and neither is one whose verdict changed because somebody edited it.',
            { days: data?.window.days ?? days },
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t('flakyTests.loading', 'Looking across recent runs…')}
          </p>
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
                  <TableHead>{t('flakyTests.columns.evidence', 'Evidence')}</TableHead>
                  <TableHead>{t('flakyTests.columns.quarantine', 'Quarantine')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={JSON.stringify([
                      ...(item.test ? [item.test.type, item.test.id] : ['legacy', item.testName]),
                      item.browser ?? '',
                      item.matrix?.environment ?? '',
                      item.matrix?.locale ?? '',
                      item.matrix?.device ?? '',
                    ])}
                  >
                    <TableCell className="font-medium">
                      {item.testName}
                      {item.test?.type === 'mobile' && (
                        <Badge variant="outline" className="ml-2 font-normal">
                          {t('quarantine.mobile', 'Mobile')}
                        </Badge>
                      )}
                      {/* A test somebody edited inside the window is not a test that cannot
                          make up its mind, and the count beside it only shows the changes of
                          verdict the edits do not account for. */}
                      {item.changedDuringWindow && (
                        <Badge
                          variant="outline"
                          className="ml-2 font-normal"
                          title={t(
                            'flakyTests.editedTitle',
                            'Edited during this window (versions {{versions}}). Only the unexplained changes of verdict are counted.',
                            { versions: item.versions.join(', ') },
                          )}
                        >
                          {t('flakyTests.edited', 'edited')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.browser ?? '—'}
                      {/* Each variant of the matrix is its own history. */}
                      {[item.matrix?.environment, item.matrix?.locale, item.matrix?.device]
                        .filter(Boolean)
                        .map((dimension) => (
                          <span key={dimension!} className="ml-1 text-muted-foreground">
                            · {dimension}
                          </span>
                        ))}
                    </TableCell>
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
                        {item.unexplainedFlips}×{' '}
                        {t('flakyTests.inRuns', 'in {{runs}} runs', { runs: item.runs })}
                      </Badge>
                      {/* Kept apart from the flips: a run rescued by its retry has a passing
                          verdict, and never changes one. */}
                      {(item.recoveredByRetry ?? 0) > 0 && (
                        <Badge
                          variant="outline"
                          className="ml-2 font-normal border-amber-500 text-amber-700 dark:text-amber-400"
                          title={t(
                            'flakyTests.recoveredTitle',
                            'Passed only after the run tried again, in {{count}} of {{runs}} runs.',
                            { count: item.recoveredByRetry, runs: item.runs },
                          )}
                        >
                          {t('flakyTests.recovered', '{{count}}× passed on retry', {
                            count: item.recoveredByRetry,
                          })}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      <span
                        className={
                          item.lastStatus === 'passed' ? 'text-green-600' : 'text-destructive'
                        }
                      >
                        {item.lastStatus}
                      </span>
                      <AttemptsBadge
                        attempts={item.lastAttempts}
                        status={item.lastStatus}
                        firstFailure={lastRecoveryCause(item)}
                      />
                    </TableCell>
                    <TableCell className="text-xs">
                      <SignalList signals={item.signals ?? []} />
                    </TableCell>
                    <TableCell>
                      {item.quarantine ? (
                        <Badge
                          variant="outline"
                          title={item.quarantine.reason}
                          className="whitespace-nowrap"
                        >
                          <ShieldAlert className="mr-1 h-3 w-3" />
                          {t('flakyTests.inQuarantine', 'In quarantine')}
                        </Badge>
                      ) : item.test && canEdit ? (
                        <Button variant="outline" size="sm" onClick={() => setQuarantining(item)}>
                          {t('flakyTests.quarantine', 'Quarantine')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <QuarantineDialog
        test={quarantining?.test ?? null}
        testName={quarantining?.testName ?? ''}
        onClose={() => setQuarantining(null)}
      />
    </Card>
  );
};

export default FlakyTestsCard;

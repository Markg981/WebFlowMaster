import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShieldAlert } from 'lucide-react';

/**
 * The tests in quarantine, and what each has done since.
 *
 * A quarantine nobody looks at again is a test switched off. This list sits where the flaky tests
 * are and shows the one thing that decides a release: whether the test has been passing since. A
 * test that has passed its last ten runs is marked as ready to come back.
 */

export interface QuarantineRow {
  id: number;
  testType: 'ui' | 'api';
  testId: number;
  testName: string | null;
  reason: string;
  quarantinedAt: string;
  quarantinedBy: string | null;
  evidence: {
    runs: number;
    passed: number;
    failed: number;
    passingStreak: number;
    lastRunAt: string | null;
    lastStatus: string | null;
  };
}

/** Passes in a row after which a quarantined test is shown as ready to release. */
export const READY_STREAK = 10;

export default function QuarantinedTestsCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = user?.role !== 'viewer';
  const [releasing, setReleasing] = useState<number | null>(null);
  /** Release notes being typed, by quarantine id. */
  const [notes, setNotes] = useState<Record<number, string>>({});

  const { data, isError } = useQuery<QuarantineRow[]>({
    queryKey: ['quarantine'],
    queryFn: async () => {
      const response = await fetch('/api/quarantine', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load the quarantined tests');
      return response.json();
    },
  });
  const rows = Array.isArray(data) ? data : [];

  const release = async (row: QuarantineRow) => {
    setReleasing(row.id);
    const note = notes[row.id] ?? '';
    try {
      const response = await fetch(`/api/quarantine/${row.id}/release`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `Request failed (${response.status})`);
      }
      setNotes(({ [row.id]: _released, ...rest }) => rest);
      await queryClient.invalidateQueries({ queryKey: ['quarantine'] });
      await queryClient.invalidateQueries({ queryKey: ['flakyTests'] });
      toast({ title: t('quarantine.released', '"{{name}}" is back: its failures count again', { name: row.testName ?? '' }) });
    } catch (error) {
      toast({ variant: 'destructive', title: t('quarantine.releaseFailed', 'The test was not released'), description: (error as Error).message });
    } finally {
      setReleasing(null);
    }
  };

  // Nothing to say while nothing is in quarantine: the card only appears when it matters, and not
  // as an empty frame while the answer is on its way.
  if (!isError && rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center">
          <ShieldAlert className="mr-2 h-5 w-5" />
          {t('quarantine.listTitle', 'Tests in quarantine')}
        </CardTitle>
        <CardDescription>
          {t(
            'quarantine.listDescription',
            'They still run. Their failures are recorded but do not fail runs or pipelines. Release a test once it has been passing again.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-sm text-destructive">{t('quarantine.error', 'The quarantined tests could not be loaded.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('quarantine.columns.test', 'Test')}</TableHead>
                  <TableHead>{t('quarantine.columns.reason', 'Why')}</TableHead>
                  <TableHead>{t('quarantine.columns.since', 'Since')}</TableHead>
                  <TableHead>{t('quarantine.columns.evidence', 'Since then')}</TableHead>
                  {canEdit && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const ready = row.evidence.passingStreak >= READY_STREAK;
                  return (
                    <TableRow key={row.id} data-testid={`quarantine-${row.id}`}>
                      <TableCell className="font-medium">
                        {row.testName ?? t('quarantine.hiddenTest', 'A test you cannot see')}
                        <Badge variant="outline" className="ml-2 font-normal">{row.testType === 'ui' ? 'UI' : 'API'}</Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-xs">{row.reason}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(row.quarantinedAt).toLocaleDateString()}
                        {row.quarantinedBy && <div className="text-muted-foreground">{row.quarantinedBy}</div>}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {row.evidence.runs === 0 ? (
                          <span className="text-muted-foreground">{t('quarantine.notRunSince', 'Not run since')}</span>
                        ) : (
                          <>
                            {t('quarantine.evidence', '{{passed}} passed, {{failed}} failed', { passed: row.evidence.passed, failed: row.evidence.failed })}
                            <div className={ready ? 'text-green-600' : 'text-muted-foreground'}>
                              {ready
                                ? t('quarantine.ready', 'Passed its last {{count}} runs: ready to release', { count: row.evidence.passingStreak })
                                : t('quarantine.streak', '{{count}} passes in a row', { count: row.evidence.passingStreak })}
                            </div>
                          </>
                        )}
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Input
                              className="h-8 w-40"
                              placeholder={t('quarantine.notePlaceholder', 'What fixed it (optional)')}
                              aria-label={t('quarantine.note', 'Release note')}
                              value={notes[row.id] ?? ''}
                              onChange={(e) => setNotes((current) => ({ ...current, [row.id]: e.target.value }))}
                            />
                            <Button size="sm" variant={ready ? 'default' : 'outline'} onClick={() => release(row)} disabled={releasing !== null}>
                              {releasing === row.id && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                              {t('quarantine.release', 'Release')}
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

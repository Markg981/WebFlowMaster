import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import GherkinArguments from '../tests/GherkinArguments';
import {
  readManualLog,
  type ManualResultLog,
  type ManualStepOutcome,
  type ManualVerdict,
} from '@shared/manual-tests';

/**
 * The manual tests of a run, and where their results are given.
 *
 * Shown once the run has ended: until then the runner is still writing the totals the verdict
 * would change. Each verdict updates the run's counts and its passed/failed status.
 */

export interface ManualResultRow {
  id: string;
  testName: string;
  status: string;
  detailedLog: string | null;
}

const RUN_ENDED = ['completed', 'failed', 'error', 'cancelled', 'timed_out'];

const STEP_OUTCOMES: ManualStepOutcome[] = ['passed', 'failed', 'skipped'];

function ManualResultEditor({
  executionId,
  row,
  log,
  canRecord,
  onRecorded,
}: {
  executionId: string;
  row: ManualResultRow;
  log: ManualResultLog;
  canRecord: boolean;
  onRecorded: () => void;
}) {
  const { t } = useTranslation();
  const [stepOutcomes, setStepOutcomes] = useState<ManualStepOutcome[]>(
    log.verdict?.stepOutcomes.map((s) => s.outcome) ?? log.steps.map(() => 'passed'),
  );
  const [notes, setNotes] = useState(log.verdict?.notes ?? '');
  const [saving, setSaving] = useState<ManualVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  const record = async (outcome: ManualVerdict) => {
    setSaving(outcome);
    setError(null);
    try {
      const response = await fetch(`/api/test-plan-executions/${executionId}/results/${row.id}/manual-verdict`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, notes: notes.trim() || null, stepOutcomes: stepOutcomes.map((o) => ({ outcome: o })) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || t('manualResults.saveFailed', 'Could not record the result.'));
      }
      onRecorded();
    } catch (recordError: any) {
      setError(recordError?.message ?? String(recordError));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {log.steps.map((step, index) => (
          <li key={index} className="grid gap-2 rounded-md border p-2 md:grid-cols-[1fr_1fr_auto]">
            <div className="text-sm">
              <span className="font-medium">{index + 1}. </span>
              {step.action}
            </div>
            <div className="text-sm text-muted-foreground">{step.expected}</div>
            <div className="flex gap-1" role="group" aria-label={t('manualResults.stepOutcome', 'Outcome of step {{n}}', { n: index + 1 })}>
              {STEP_OUTCOMES.map((outcome) => (
                <Button
                  key={outcome}
                  type="button"
                  size="sm"
                  variant={stepOutcomes[index] === outcome ? 'default' : 'outline'}
                  disabled={!canRecord}
                  aria-pressed={stepOutcomes[index] === outcome}
                  onClick={() => setStepOutcomes((current) => current.map((o, i) => (i === index ? outcome : o)))}
                >
                  {t(`manualResults.step.${outcome}`, outcome)}
                </Button>
              ))}
            </div>
            <GherkinArguments argument={step.gherkin}/>
          </li>
        ))}
      </ol>
      <div className="grid gap-1">
        <Label htmlFor={`manual-notes-${row.id}`}>{t('manualResults.notes', 'Notes')}</Label>
        <Textarea
          id={`manual-notes-${row.id}`}
          value={notes}
          disabled={!canRecord}
          placeholder={t('manualResults.notesPlaceholder', 'What happened, the issue opened, the environment used')}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {(['passed', 'failed', 'blocked'] as ManualVerdict[]).map((outcome) => (
          <Button
            key={outcome}
            variant={outcome === 'failed' ? 'destructive' : outcome === 'passed' ? 'default' : 'outline'}
            disabled={!canRecord || saving !== null}
            onClick={() => record(outcome)}
          >
            {saving === outcome && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t(`manualResults.verdict.${outcome}`, outcome)}
          </Button>
        ))}
      </div>
      {log.verdict && (
        <p className="text-xs text-muted-foreground">
          {t('manualResults.recordedBy', 'Recorded by {{name}} on {{when}}', {
            name: log.verdict.byUsername,
            when: new Date(log.verdict.at).toLocaleString(),
          })}
        </p>
      )}
    </div>
  );
}

export const ManualResultsCard: React.FC<{
  executionId: string;
  runStatus: string;
  rows: ManualResultRow[];
  onRecorded: () => void;
}> = ({ executionId, runStatus, rows, onRecorded }) => {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  const manual = rows
    .map((row) => ({ row, log: readManualLog(row.detailedLog) }))
    .filter((entry): entry is { row: ManualResultRow; log: ManualResultLog } => entry.log !== null);
  if (manual.length === 0) return null;

  const ended = RUN_ENDED.includes(runStatus);
  const waiting = manual.filter((entry) => entry.row.status === 'Pending').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" aria-hidden />
          {t('manualResults.title', 'Manual tests')}
          {waiting > 0 && <Badge variant="secondary">{t('manualResults.waiting', '{{count}} waiting for a result', { count: waiting })}</Badge>}
        </CardTitle>
        <CardDescription>
          {ended
            ? t('manualResults.description', 'Perform each test, mark how every step went, and give the verdict. The run’s counts and status follow.')
            : t('manualResults.notYet', 'Results can be recorded once the run has finished.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {manual.map(({ row, log }) => (
          <div key={row.id} className="rounded-md border">
            <button
              type="button"
              className="flex w-full items-center justify-between p-3 text-left"
              aria-expanded={openId === row.id}
              onClick={() => setOpenId(openId === row.id ? null : row.id)}
            >
              <span className="font-medium">{row.testName}</span>
              <Badge variant={row.status === 'Passed' ? 'default' : row.status === 'Failed' ? 'destructive' : 'secondary'}>
                {row.status === 'Pending'
                  ? t('manualResults.status.pending', 'Waiting')
                  : row.status === 'Skipped'
                    ? t('manualResults.status.blocked', 'Blocked')
                    : t(`manualResults.status.${row.status.toLowerCase()}`, row.status)}
              </Badge>
            </button>
            {openId === row.id && (
              <div className="border-t p-3">
                <ManualResultEditor
                  executionId={executionId}
                  row={row}
                  log={log}
                  canRecord={ended}
                  onRecorded={() => {
                    setOpenId(null);
                    onRecorded();
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default ManualResultsCard;

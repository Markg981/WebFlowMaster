import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import type { ReproducibilitySummary } from '@shared/execution-provenance';

export default function ReproducibilityCard({ executionId, planId, summary }: {
  executionId: string; planId: string; summary?: ReproducibilitySummary;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; testPlanId: string } | null>(null);
  // Keep the key through a network failure so confirming again cannot create a duplicate run.
  const [key] = useState(() => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join(''));
  const replay = async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/test-plan-executions/${executionId}/replay`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ mode: 'historical' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t('reproducibility.failed', 'Could not queue historical replay.'));
      setCreated(body);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <Card className="mb-6">
    <CardHeader><CardTitle>{t('reproducibility.title', 'Queued inputs and historical replay')}</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {summary?.provenance ? <>
        <p>{t('reproducibility.captured', 'Inputs captured at enqueue')}: {summary.provenance.capturedAt}</p>
        <p className="text-sm break-all">{t('reproducibility.inputs', 'Input fingerprint (SHA-256)')}: <code>{summary.provenance.inputFingerprint}</code></p>
        <p className="text-sm break-all">{t('reproducibility.datasets', 'Dataset fingerprint (SHA-256)')}: <code>{summary.provenance.datasetsFingerprint}</code></p>
        <ul className="space-y-2 text-sm">{summary.provenance.definitions.map(row => <li key={`${row.type}:${row.id}`} className="break-all">
          {row.name} · {row.type} #{row.id} · {row.version === null ? t('reproducibility.unversioned', 'Unversioned') : `v${row.version}`} · {row.source === 'published' ? t('reproducibility.published', 'Published') : t('reproducibility.working', 'Working copy')}<br /><code>{row.fingerprint}</code>
        </li>)}</ul>
        <ul className="space-y-2 text-sm">{summary.provenance.datasets.map(row => <li key={row.testId} className="break-all">
          {t('reproducibility.dataSource', 'Dataset source')} · UI #{row.testId} · {row.source ? `${row.source.name} (#${row.source.id}, ${row.source.updatedAt})` : t('reproducibility.inline', 'Inline or absent')} · {row.rowCount} {t('reproducibility.rows', 'rows')}<br /><code>{row.fingerprint}</code>
        </li>)}</ul>
      </> : <p>{t('reproducibility.legacy', 'This run does not retain verified queued inputs. Historical replay is unavailable.')}</p>}
      {summary?.replayOf && <p>{t('reproducibility.source', 'Historical replay of')} <Link className="underline" href={`/test-plans/${planId}/executions/${summary.replayOf.executionId}/report`}>{summary.replayOf.executionId}</Link></p>}
      <p className="text-sm text-muted-foreground">{t('reproducibility.live', 'Environment variables and secrets, grids, agents, browser binaries, BDD profiles, quarantine, review policies, integrations and the application under test are resolved live.')}</p>
      {summary?.available && (user?.role === 'editor' || user?.role === 'owner') && !created && <AlertDialog>
        <AlertDialogTrigger asChild><Button variant="outline" disabled={busy}>{t('reproducibility.replay', 'Replay historical configuration')}</Button></AlertDialogTrigger>
        <AlertDialogContent><AlertDialogHeader>
          <AlertDialogTitle>{t('reproducibility.confirmTitle', 'Replay these historical inputs?')}</AlertDialogTitle>
          <AlertDialogDescription>{t('reproducibility.confirmBody', 'A new manual run uses the retained test definitions, datasets and plan settings. Current access, review and quota policies apply; external dependencies use their current state.')}</AlertDialogDescription>
        </AlertDialogHeader><AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={replay}>{t('reproducibility.confirm', 'Queue historical replay')}</AlertDialogAction>
        </AlertDialogFooter></AlertDialogContent>
      </AlertDialog>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {created && <p role="status"><Link className="underline" href={`/test-plans/${created.testPlanId}/executions/${created.id}/report`}>{t('reproducibility.queued', 'Open queued replay')}</Link></p>}
    </CardContent>
  </Card>;
}

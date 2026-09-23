import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, Upload } from 'lucide-react';

/**
 * What plans run of this test, and how to change it.
 *
 * Saving a test changes its working copy; a plan runs the version that was published. This panel
 * says which one that is in a sentence rather than a field — "plans run version 3; version 5 has
 * changes not yet published" is the thing a person needs to know before they walk away from an
 * edit at six in the evening.
 */

export interface PublishingState {
  testId: number;
  publishedVersion: number | null;
  latestVersion: number | null;
  runs: 'published' | 'working_copy' | 'nothing';
  hasUnpublishedChanges: boolean;
  reviewRequired: boolean;
  pendingReview: { id: number; version: number; requestedBy: number | null; note: string | null } | null;
  rollbackTargets: number[];
}

async function send(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? 'Something went wrong');
  return payload;
}

export default function PublishingPanel({
  state,
  currentUserId,
  canEdit,
  onChanged,
}: {
  state: PublishingState;
  currentUserId: number | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      setNote('');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const what =
    state.runs === 'published'
      ? t('publishing.runsPublished', 'Plans run version {{n}}.', { n: state.publishedVersion })
      : state.runs === 'working_copy'
        ? t('publishing.runsWorkingCopy', 'Not published: plans run the latest save.')
        : t('publishing.runsNothing', 'Not published: plans skip this test until a reviewed version is published.');

  return (
    <div className="rounded-md border p-3 space-y-2" data-testid="publishing-panel">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{what}</span>
        {state.reviewRequired && <Badge variant="outline">{t('publishing.reviewRequired', 'review required')}</Badge>}
      </div>
      {state.hasUnpublishedChanges && state.publishedVersion !== null && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('publishing.unpublishedChanges', 'Version {{n}} has changes that are not published yet.', { n: state.latestVersion })}
        </p>
      )}

      {state.pendingReview ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>{t('publishing.waiting', 'Version {{n}} is waiting for review.', { n: state.pendingReview.version })}</span>
          {canEdit && state.pendingReview.requestedBy === currentUserId && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(() => send(`/api/test-reviews/${state.pendingReview!.id}/withdraw`))}>
              {t('publishing.withdraw', 'Withdraw')}
            </Button>
          )}
        </div>
      ) : (
        canEdit &&
        state.hasUnpublishedChanges &&
        (state.reviewRequired ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('publishing.notePlaceholder', 'What changed, for the reviewer (optional)')}
              aria-label={t('publishing.noteLabel', 'Note for the reviewer')}
            />
            <Button size="sm" disabled={busy} onClick={() => act(() => send(`/api/tests/${state.testId}/reviews`, { note }))}>
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              {t('publishing.askReview', 'Ask for review of version {{n}}', { n: state.latestVersion })}
            </Button>
          </div>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => act(() => send(`/api/tests/${state.testId}/publish`))}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            {t('publishing.publish', 'Publish version {{n}}', { n: state.latestVersion })}
          </Button>
        ))
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

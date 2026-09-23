import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { History, Loader2, RotateCcw, Undo2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import PublishingPanel, { type PublishingState } from './PublishingPanel';

/**
 * What this test used to be.
 *
 * A test that passed last week and fails today poses one question first — did the application
 * change, or did the test? Saving used to overwrite everything, and the builder turns a name
 * collision into an overwrite, so re-recording a flow discarded the previous walk with no trace
 * and nobody could answer it.
 *
 * Restoring adds a version rather than removing the ones after it, and this says so, because a
 * person about to restore is deciding whether they are about to lose today's work. They are not.
 */

export interface TestVersionSummary {
  version: number;
  name: string;
  url: string;
  summary: string | null;
  restoredFromVersion: number | null;
  createdAt: string;
  authorName: string | null;
  stepCount: number;
  /** How this version actually did, counted from the runs that named it. */
  runs: number;
  passed: number;
  failed: number;
  lastRunAt: string | null;
}

interface TestHistoryResponse {
  versions: TestVersionSummary[];
  /** Runs from before results carried a version. Reported, never attributed to a version. */
  unversionedRuns: number;
}

interface TestHistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  test: { id: number; name: string } | null;
  /** Puts the test back to that version; the parent refreshes what it is showing. */
  onRestore: (version: number) => Promise<void>;
}

const TestHistoryDialog: React.FC<TestHistoryDialogProps> = ({ isOpen, onClose, test, onRestore }) => {
  const { t } = useTranslation();
  const [restoring, setRestoring] = useState<number | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading, error: loadError, refetch } = useQuery<TestHistoryResponse, Error>({
    queryKey: ['testVersions', test?.id],
    queryFn: async () => {
      const response = await fetch(`/api/tests/${test!.id}/versions`);
      if (!response.ok) throw new Error('Could not load the history');
      return response.json();
    },
    enabled: isOpen && test !== null,
  });

  const { user } = useAuth();
  const canEdit = user?.role !== 'viewer';
  // What plans run: the published version, the working copy, or nothing (migration 0032).
  const { data: publishing, refetch: refetchPublishing } = useQuery<PublishingState, Error>({
    queryKey: ['testPublishing', test?.id],
    queryFn: async () => {
      const response = await fetch(`/api/tests/${test!.id}/publishing`);
      if (!response.ok) throw new Error('Could not load the publishing state');
      return response.json();
    },
    enabled: isOpen && test !== null,
  });
  const [rollingBack, setRollingBack] = useState<number | null>(null);

  const handleRollback = async (version: number) => {
    setError('');
    setRollingBack(version);
    try {
      const response = await fetch(`/api/tests/${test!.id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Could not roll back');
      await refetchPublishing();
    } catch (rollbackError: any) {
      setError(rollbackError?.message ?? 'Could not roll back');
    } finally {
      setRollingBack(null);
    }
  };

  const versions = Array.isArray(data?.versions) ? data!.versions : [];
  const unversionedRuns = data?.unversionedRuns ?? 0;

  const handleRestore = async (version: number) => {
    setError('');
    setRestoring(version);
    try {
      await onRestore(version);
      await refetch();
      await refetchPublishing();
    } catch (restoreError: any) {
      setError(restoreError?.message ?? 'Could not restore that version');
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <History className="mr-2 h-5 w-5" />
            {t('testHistory.title', 'History of "{{name}}"', { name: test?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'testHistory.description',
              'Every save is here, newest first. Restoring one adds it to the top as a new version — nothing between is removed, and today’s work stays recoverable.',
            )}
          </DialogDescription>
        </DialogHeader>

        {publishing?.runs && (
          <PublishingPanel
            state={publishing}
            currentUserId={user?.id ?? null}
            canEdit={canEdit}
            onChanged={() => {
              refetchPublishing();
              refetch();
            }}
          />
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('testHistory.loading', 'Reading the history…')}</p>
        ) : loadError ? (
          <p className="text-sm text-destructive">{loadError.message}</p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('testHistory.empty', 'Nothing yet. The next save is version 1.')}
          </p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto" data-testid="test-history-list">
            {versions.map((version, index) => (
              <div key={version.version} className="flex items-start gap-3 border rounded-md p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {t('testHistory.version', 'Version {{n}}', { n: version.version })}
                    </span>
                    {index === 0 && (
                      <Badge variant="outline">{t('testHistory.current', 'Current')}</Badge>
                    )}
                    {publishing?.publishedVersion === version.version && (
                      <Badge data-testid={`published-${version.version}`}>{t('testHistory.published', 'Published')}</Badge>
                    )}
                    {version.restoredFromVersion !== null && (
                      <Badge variant="secondary">
                        {t('testHistory.restoredFrom', 'restored from {{n}}', { n: version.restoredFromVersion })}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {version.summary ?? t('testHistory.noSummary', 'Saved.')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {version.name} · {t('testHistory.steps', '{{count}} steps', { count: version.stepCount })} ·{' '}
                    {new Date(version.createdAt).toLocaleString()} ·{' '}
                    {version.authorName ?? t('testHistory.unknownAuthor', 'a member who has left')}
                  </p>
                  {/* How the version did, which is what turns a list of edits into something
                      somebody can choose between. A version nobody ever ran says so. */}
                  <p className="text-xs">
                    {version.runs === 0 ? (
                      <span className="text-muted-foreground">{t('testHistory.neverRan', 'Never run')}</span>
                    ) : (
                      <>
                        <span className="text-green-600">
                          {t('testHistory.passed', '{{count}} passed', { count: version.passed })}
                        </span>
                        {' · '}
                        <span className={version.failed > 0 ? 'text-destructive' : 'text-muted-foreground'}>
                          {t('testHistory.failed', '{{count}} failed', { count: version.failed })}
                        </span>
                        {version.runs > version.passed + version.failed && (
                          <span className="text-muted-foreground">
                            {' · '}
                            {t('testHistory.noVerdict', '{{count}} never got to answer', {
                              count: version.runs - version.passed - version.failed,
                            })}
                          </span>
                        )}
                      </>
                    )}
                  </p>
                </div>
                {canEdit && publishing?.rollbackTargets?.includes(version.version) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRollback(version.version)}
                    disabled={rollingBack !== null}
                    title={t('testHistory.rollbackHint', 'Plans run this version again. It was live before.')}
                  >
                    {rollingBack === version.version ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4 mr-1" />}
                    {t('testHistory.rollback', 'Roll back to this')}
                  </Button>
                )}
                {index > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestore(version.version)}
                    disabled={restoring !== null}
                  >
                    {restoring === version.version ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4 mr-1" />
                    )}
                    {t('testHistory.restore', 'Restore')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {unversionedRuns > 0 && (
          // Runs from before results recorded a version. Said out loud rather than spread over
          // the versions they might belong to: attributing them would be inventing history.
          <p className="text-xs text-muted-foreground">
            {t(
              'testHistory.unversioned',
              '{{count}} earlier runs of this test did not record which version they used.',
              { count: unversionedRuns },
            )}
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
};

export default TestHistoryDialog;

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
import { History, Loader2, RotateCcw } from 'lucide-react';

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

  const { data, isLoading, error: loadError, refetch } = useQuery<TestVersionSummary[], Error>({
    queryKey: ['testVersions', test?.id],
    queryFn: async () => {
      const response = await fetch(`/api/tests/${test!.id}/versions`);
      if (!response.ok) throw new Error('Could not load the history');
      return response.json();
    },
    enabled: isOpen && test !== null,
  });

  const versions = Array.isArray(data) ? data : [];

  const handleRestore = async (version: number) => {
    setError('');
    setRestoring(version);
    try {
      await onRestore(version);
      await refetch();
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
                </div>
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

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
};

export default TestHistoryDialog;

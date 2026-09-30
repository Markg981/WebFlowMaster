import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

/**
 * Bringing epics and stories in from the organization's Jira or Azure DevOps, through the issue
 * trackers set up in Settings. Three ways: the project's epics and stories, some keys, or a query.
 * Sync brings the ones already imported up to date. Nothing is written to the tracker.
 */

export interface TrackerOption {
  id: string;
  name: string;
  provider: 'jira' | 'azure_devops' | string;
}

export type ImportRequest = { trackerId: string; keys?: string[]; query?: string };

type Mode = 'project' | 'keys' | 'query';

interface Props {
  isOpen: boolean;
  trackers: TrackerOption[];
  busy: boolean;
  onClose: () => void;
  onImport: (request: ImportRequest) => void;
  onSync: (trackerId: string) => void;
}

export default function ImportRequirementsDialog({ isOpen, trackers, busy, onClose, onImport, onSync }: Props) {
  const { t } = useTranslation();
  const [trackerId, setTrackerId] = useState('');
  const [mode, setMode] = useState<Mode>('project');
  const [keys, setKeys] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setTrackerId(trackers[0]?.id ?? '');
    setMode('project');
    setKeys('');
    setQuery('');
  }, [isOpen, trackers]);

  const tracker = trackers.find((candidate) => candidate.id === trackerId);
  const isJira = tracker?.provider === 'jira';
  const keyList = keys.split(/[\s,;]+/).map((k) => k.trim()).filter(Boolean);
  const valid = !!tracker && (mode === 'project' || (mode === 'keys' && keyList.length > 0) || (mode === 'query' && query.trim() !== ''));

  const submit = () => {
    if (!tracker) return;
    onImport({
      trackerId: tracker.id,
      ...(mode === 'keys' ? { keys: keyList } : {}),
      ...(mode === 'query' ? { query: query.trim() } : {}),
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('requirements.import.title', 'Import from a tracker')}</DialogTitle>
          <DialogDescription>
            {t('requirements.import.description', 'Epics and stories are read from the tracker and kept up to date by Sync; nothing is written back to it. A story brings its epic along.')}
          </DialogDescription>
        </DialogHeader>

        {trackers.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="requirements-no-tracker">
            {t('requirements.import.noTracker', 'No Jira or Azure DevOps is connected. Add one in Settings → Issue trackers; the same connection is used here.')}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="import-tracker">{t('requirements.import.tracker', 'Tracker')}</Label>
              <Select value={trackerId} onValueChange={setTrackerId}>
                <SelectTrigger id="import-tracker" aria-label={t('requirements.import.tracker', 'Tracker')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {trackers.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-2">
              {(['project', 'keys', 'query'] as const).map((option) => (
                <Button key={option} type="button" size="sm" variant={mode === option ? 'default' : 'outline'} aria-pressed={mode === option} onClick={() => setMode(option)}>
                  {option === 'project'
                    ? t('requirements.import.modeProject', "The project's epics and stories")
                    : option === 'keys'
                      ? t('requirements.import.modeKeys', 'These keys')
                      : isJira
                        ? t('requirements.import.modeJql', 'A JQL query')
                        : t('requirements.import.modeWiql', 'A WIQL query')}
                </Button>
              ))}
            </div>

            {mode === 'keys' && (
              <div className="space-y-1">
                <Label htmlFor="import-keys">{t('requirements.import.keys', 'Keys')}</Label>
                <Textarea id="import-keys" rows={3} value={keys} onChange={(e) => setKeys(e.target.value)} placeholder={isJira ? 'SHOP-142, SHOP-143' : '4711, 4712'} />
              </div>
            )}
            {mode === 'query' && (
              <div className="space-y-1">
                <Label htmlFor="import-query">{isJira ? 'JQL' : 'WIQL'}</Label>
                <Textarea
                  id="import-query"
                  rows={3}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="font-mono text-xs"
                  placeholder={isJira ? 'project = SHOP AND fixVersion = "2.4"' : "SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] UNDER 'Shop\\Sprint 12'"}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {tracker && (
            <Button variant="outline" onClick={() => onSync(tracker.id)} disabled={busy}>
              {t('requirements.import.sync', 'Sync imported')}
            </Button>
          )}
          <Button onClick={submit} disabled={!valid || busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('requirements.import.submit', 'Import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

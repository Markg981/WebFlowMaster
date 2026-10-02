import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, FileUp, Loader2 } from 'lucide-react';

/**
 * The organization's tests as a file (server/test-bundle.ts): export a project's web and API tests to
 * keep under version control, and import such a file back — same names are updated, with a new
 * version each, the others created.
 */

type Outcome = { kind: 'test' | 'api_test'; name: string; outcome: 'created' | 'updated' | 'unchanged' | 'invalid'; reason?: string };

const ALL = 'all';
const NONE = 'none';

async function importBundle(body: unknown): Promise<{ dryRun: boolean; results: Outcome[] }> {
  const response = await fetch('/api/tests/import-bundle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

const OUTCOME_VARIANT: Record<Outcome['outcome'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  created: 'default',
  updated: 'secondary',
  unchanged: 'outline',
  invalid: 'destructive',
};

export function TestFilesDialog({ open, onOpenChange, canEdit, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; canEdit: boolean; onImported: () => void }) {
  const { t } = useTranslation();
  const { data: projects = [] } = useQuery<Array<{ id: number; name: string }>>({ queryKey: ['/api/projects'], enabled: open });
  const [exportProject, setExportProject] = useState(ALL);
  const [format, setFormat] = useState<'yaml' | 'json'>('yaml');
  const [content, setContent] = useState('');
  const [importProject, setImportProject] = useState(NONE);
  const [results, setResults] = useState<{ dryRun: boolean; results: Outcome[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const exportHref = `/api/tests/export?format=${format}${exportProject === ALL ? '' : `&projectId=${exportProject}`}`;

  const send = (dryRun: boolean) => async () => {
    setBusy(true);
    setError('');
    try {
      const outcome = await importBundle({ content, dryRun, projectId: importProject === NONE ? null : Number(importProject) });
      setResults(outcome);
      if (!dryRun) onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = (next: boolean) => {
    if (!next) {
      setContent('');
      setResults(null);
      setError('');
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="test-files">
        <DialogHeader>
          <DialogTitle>{t('testFiles.title', 'Tests as files')}</DialogTitle>
          <DialogDescription>
            {t(
              'testFiles.description',
              'A project\'s web and API tests as one YAML or JSON file, to keep in a repository beside the application. Importing it back updates the tests of the same name — each gets a new version — and creates the others. Secrets in API tests are written as variables.',
            )}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">{t('testFiles.export', 'Export')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label>{t('testFiles.project', 'Project')}</Label>
              <Select value={exportProject} onValueChange={setExportProject}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('testFiles.allTests', 'All tests')}</SelectItem>
                  <SelectItem value={NONE}>{t('testFiles.noProject', 'Tests in no project')}</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('testFiles.format', 'Format')}</Label>
              <Select value={format} onValueChange={(value) => setFormat(value as 'yaml' | 'json')}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yaml">YAML</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button asChild variant="outline">
              <a href={exportHref} download data-testid="test-files-export">
                <Download className="mr-2 h-4 w-4" /> {t('testFiles.download', 'Download')}
              </a>
            </Button>
          </div>
        </section>

        {canEdit && (
          <section className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{t('testFiles.import', 'Import')}</p>
            <Label htmlFor="test-files-file" className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <FileUp className="h-4 w-4" /> {t('testFiles.openFile', 'Open a file…')}
            </Label>
            <input
              id="test-files-file"
              type="file"
              accept=".yaml,.yml,.json"
              className="sr-only"
              onChange={(e) => e.target.files?.[0]?.text().then((text) => { setContent(text); setResults(null); })}
            />
            <Textarea rows={6} className="font-mono text-xs" placeholder="kind: webflowmaster/tests" value={content} onChange={(e) => { setContent(e.target.value); setResults(null); }} data-testid="test-files-content" />
            <div className="space-y-1">
              <Label>{t('testFiles.newTestsGoTo', 'New tests go to')}</Label>
              <Select value={importProject} onValueChange={setImportProject}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('testFiles.noProjectShort', 'No project')}</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {results && (
              <ul className="max-h-56 space-y-1 overflow-y-auto text-sm" data-testid="test-files-results">
                {results.results.map((r) => (
                  <li key={`${r.kind}-${r.name}`} className="flex flex-wrap items-center gap-2">
                    <Badge variant={OUTCOME_VARIANT[r.outcome]}>{t(`testFiles.outcomes.${r.outcome}`, r.outcome)}</Badge>
                    <span>{r.name}</span>
                    {r.kind === 'api_test' && <span className="text-xs text-muted-foreground">API</span>}
                    {r.reason && <span className="text-xs text-destructive">{r.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
            {results?.dryRun === false && <p className="text-sm text-muted-foreground">{t('testFiles.done', 'Imported.')}</p>}
          </section>
        )}

        {error && <p className="text-sm text-destructive" data-testid="test-files-error">{error}</p>}

        <DialogFooter>
          {canEdit && (
            <>
              <Button variant="outline" onClick={send(true)} disabled={busy || !content.trim()} data-testid="test-files-preview">
                {t('testFiles.preview', 'Show what changes')}
              </Button>
              <Button onClick={send(false)} disabled={busy || !content.trim() || results?.dryRun !== true} data-testid="test-files-import">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('testFiles.importButton', 'Import')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

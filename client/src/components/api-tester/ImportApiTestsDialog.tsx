import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileUp, Loader2 } from 'lucide-react';

/**
 * API tests from an OpenAPI 3 / Swagger 2 description or a Postman collection (server/api-import.ts):
 * paste or open the file, see what it makes, keep what you want, import.
 */

interface PreviewTest {
  index: number;
  name: string;
  method: string;
  url: string;
  module: string | null;
  exists: boolean;
  warnings: string[];
}

interface Preview {
  format: 'openapi' | 'swagger' | 'postman' | 'wsdl';
  title: string;
  tests: PreviewTest[];
  variables: Array<{ name: string; value: string | null; why: string }>;
  warnings: string[];
}

interface Outcome {
  created: Array<{ id: number; name: string }>;
  skipped: Array<{ name: string }>;
  invalid: Array<{ name: string; reason: string }>;
}

const FORMAT_LABEL: Record<Preview['format'], string> = { openapi: 'OpenAPI 3', swagger: 'Swagger 2', postman: 'Postman', wsdl: 'WSDL (SOAP)' };
const NO_PROJECT = 'none';

async function post(body: unknown) {
  const response = await fetch('/api/api-tests/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

export function ImportApiTestsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useQuery<Array<{ id: number; name: string }>>({ queryKey: ['/api/projects'], enabled: open });
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [projectId, setProjectId] = useState(NO_PROJECT);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setContent('');
    setPreview(null);
    setSelected(new Set());
    setOutcome(null);
    setError('');
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    file.text().then((text) => {
      setContent(text);
      setPreview(null);
      setOutcome(null);
    });
  };

  const showPreview = () =>
    run(async () => {
      const result: Preview = await post({ content, dryRun: true });
      setPreview(result);
      setSelected(new Set(result.tests.filter((test) => !test.exists).map((test) => test.index)));
    });

  const importSelected = () =>
    run(async () => {
      const result: Outcome = await post({
        content,
        select: [...selected],
        projectId: projectId === NO_PROJECT ? null : Number(projectId),
      });
      setOutcome(result);
      queryClient.invalidateQueries({ queryKey: ['apiTests'] });
    });

  const toggle = (index: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="import-api-tests">
        <DialogHeader>
          <DialogTitle>{t('apiTester.import.title', 'Import API tests')}</DialogTitle>
          <DialogDescription>
            {t(
              'apiTester.import.description',
              'From an OpenAPI 3 or Swagger 2 description (JSON or YAML) or a Postman collection: one test per operation or request, starting from {{baseUrl}}, with the expected status as an assertion. Secrets become variables to set in an environment.',
              { baseUrl: '{{baseUrl}}' },
            )}
          </DialogDescription>
        </DialogHeader>

        {outcome ? (
          <div className="space-y-2 text-sm" data-testid="import-outcome">
            <p>{t('apiTester.import.created', '{{count}} tests imported.', { count: outcome.created.length })}</p>
            {outcome.skipped.length > 0 && (
              <p className="text-muted-foreground">{t('apiTester.import.skipped', '{{count}} left out: they already exist.', { count: outcome.skipped.length })}</p>
            )}
            {outcome.invalid.map((item) => (
              <p key={item.name} className="text-destructive">{item.name}: {item.reason}</p>
            ))}
          </div>
        ) : !preview ? (
          <div className="space-y-2">
            <Label htmlFor="import-file" className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <FileUp className="h-4 w-4" /> {t('apiTester.import.openFile', 'Open a file…')}
            </Label>
            <input id="import-file" type="file" accept=".json,.yaml,.yml,.wsdl,.xml" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
            <Textarea
              rows={10}
              className="font-mono text-xs"
              placeholder={t('apiTester.import.paste', 'Or paste the description or the collection here')}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              data-testid="import-content"
            />
          </div>
        ) : (
          <div className="space-y-3" data-testid="import-preview">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{FORMAT_LABEL[preview.format]}</Badge>
              <span className="font-medium">{preview.title}</span>
              <span className="text-muted-foreground">
                {t('apiTester.import.selectedCount', '{{selected}} of {{total}} selected', { selected: selected.size, total: preview.tests.length })}
              </span>
            </div>
            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
              {preview.tests.map((test) => (
                <li key={test.index} className="flex items-start gap-2 text-sm">
                  <Checkbox checked={selected.has(test.index)} onCheckedChange={() => toggle(test.index)} aria-label={test.name} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">{test.method}</Badge>
                      <span className="truncate">{test.name}</span>
                      {test.module && <span className="text-xs text-muted-foreground">{test.module}</span>}
                      {test.exists && <Badge variant="secondary">{t('apiTester.import.exists', 'already there')}</Badge>}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{test.url}</div>
                    {test.warnings.map((w) => (
                      <div key={w} className="text-xs text-amber-600">{w}</div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {preview.variables.length > 0 && (
              <div className="rounded-md border p-2 text-xs" data-testid="import-variables">
                <p className="mb-1 font-medium">{t('apiTester.import.variables', 'Set these in an environment before running them:')}</p>
                <ul className="space-y-0.5">
                  {preview.variables.map((v) => (
                    <li key={v.name}>
                      <code className="font-mono">{`{{${v.name}}}`}</code>
                      {v.value && <> = <code className="font-mono break-all">{v.value}</code></>} — <span className="text-muted-foreground">{v.why}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.warnings.map((w) => (
              <p key={w} className="text-xs text-amber-600">{w}</p>
            ))}
            <div className="space-y-1">
              <Label>{t('apiTester.import.project', 'Project')}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="md:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT}>{t('apiTester.savedTestsPanel.noProject.label', 'No project')}</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive" data-testid="import-error">{error}</p>}

        <DialogFooter>
          {outcome ? (
            <Button onClick={() => { reset(); onOpenChange(false); }}>{t('apiTester.import.close', 'Close')}</Button>
          ) : !preview ? (
            <Button onClick={showPreview} disabled={busy || !content.trim()} data-testid="import-preview-button">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('apiTester.import.preview', 'Show what it makes')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy}>{t('apiTester.import.back', 'Back')}</Button>
              <Button onClick={importSelected} disabled={busy || selected.size === 0} data-testid="import-confirm">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('apiTester.import.confirm', 'Import {{count}} tests', { count: selected.size })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

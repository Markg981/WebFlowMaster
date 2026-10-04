import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
  endpoints?: Array<{ id: string; label: string; address: string }>;
  selectedEndpoint?: string;
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
  const [documents, setDocuments] = useState<Array<{ location: string; content: string }>>([]);
  const [rootIndex, setRootIndex] = useState(0);
  const [endpoint, setEndpoint] = useState<string | undefined>();
  const generation = useRef(0);
  const operation = useRef(0);
  const copy = (key: string, fallback: string) => t(`apiTester.import.${key}`, fallback);
  useEffect(() => { if (!open) { generation.current++; operation.current++; setBusy(false); } }, [open]);
  useEffect(() => () => { generation.current++; operation.current++; }, []);
  const invalidate = () => { generation.current++; setPreview(null); setOutcome(null); setSelected(new Set()); setEndpoint(undefined); setError(''); };

  const reset = () => {
    generation.current++; operation.current++; setBusy(false);
    setContent('');
    setDocuments([]); setRootIndex(0); setEndpoint(undefined);
    setPreview(null);
    setSelected(new Set());
    setOutcome(null);
    setError('');
  };

  const run = async (work: (epoch: number) => Promise<void>) => {
    const epoch = ++generation.current;
    const currentOperation = ++operation.current;
    setBusy(true);
    setError('');
    try {
      await work(epoch);
    } catch (e) {
      if (generation.current === epoch) setError((e as Error).message);
    } finally {
      if (operation.current === currentOperation) setBusy(false);
    }
  };

  const readFiles = (files: FileList | null) => {
    if (!files?.length) return;
    invalidate();
    const list = Array.from(files);
    if (list.length > 32) { setError(copy('documentLimit', 'A bundle may contain at most 32 documents.')); return; }
    if (list.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) { setError(copy('byteLimit', 'A bundle may contain at most 10 MiB.')); return; }
    void run(async epoch => {
      const loaded = await Promise.all(list.map(async file => ({ location: file.webkitRelativePath || file.name, content: await file.text() })));
      if (generation.current !== epoch) return;
      const root = Math.max(0, loaded.findIndex(document => /\.wsdl$/i.test(document.location)));
      setDocuments(loaded); setRootIndex(root); setContent(loaded[root].content);
    });
  };

  const source = (selectedEndpoint = endpoint) => {
    const locations = documents.map(document => document.location.trim());
    if (locations.some(location => !location) || new Set(locations).size !== locations.length) throw new Error(copy('locationError', 'Each document needs a unique logical location.'));
    const totalBytes = new Blob([content, ...documents.filter((_, index) => index !== rootIndex).map(document => document.content)]).size;
    if (totalBytes > 10 * 1024 * 1024) throw new Error(copy('byteLimit', 'A bundle may contain at most 10 MiB.'));
    return { content, ...(documents.length ? { rootLocation: locations[rootIndex], documents: documents.filter((_, index) => index !== rootIndex).map(document => ({ ...document, location: document.location.trim() })) } : {}), ...(selectedEndpoint ? { endpoint: selectedEndpoint } : {}) };
  };

  const showPreview = (selectedEndpoint = endpoint) =>
    run(async epoch => {
      const result: Preview = await post({ ...source(selectedEndpoint), dryRun: true });
      if (generation.current !== epoch) return;
      setPreview(result);
      setEndpoint(result.selectedEndpoint ?? selectedEndpoint);
      setSelected(new Set(result.tests.filter((test) => !test.exists).map((test) => test.index)));
    });

  const importSelected = () =>
    run(async epoch => {
      const result: Outcome = await post({
        ...source(),
        select: [...selected],
        projectId: projectId === NO_PROJECT ? null : Number(projectId),
      });
      if (generation.current !== epoch) return;
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
            <input id="import-file" type="file" multiple accept=".json,.yaml,.yml,.wsdl,.xml,.xsd" className="sr-only" disabled={busy} onChange={(e) => { readFiles(e.target.files); e.target.value = ''; }} />
            <Label htmlFor="import-directory" className="ml-4 inline-flex cursor-pointer items-center gap-2 text-sm"><FileUp className="h-4 w-4" />{copy('openDirectory', 'Open a directory…')}</Label>
            <input id="import-directory" type="file" multiple {...{ webkitdirectory: '', directory: '' }} className="sr-only" disabled={busy} onChange={(e) => { readFiles(e.target.files); e.target.value = ''; }} />
            {documents.length > 0 && <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">{copy('bundleHelp', 'Upload the root WSDL and its WSDL/XSD dependencies. Logical locations match imports; directory paths are preserved. Maximum 32 documents, 10 MiB.')}</p>
              <label className="grid gap-1 text-sm">{copy('rootDocument', 'Root document')}<select className="rounded-md border bg-background p-2" value={rootIndex} disabled={busy} onChange={event => { invalidate(); const index = Number(event.target.value); setDocuments(current => current.map((document, i) => i === rootIndex ? { ...document, content } : document)); setRootIndex(index); setContent(documents[index].content); }}>{documents.map((document, index) => <option key={index} value={index}>{document.location}</option>)}</select></label>
              {documents.map((document, index) => <label key={index} className="grid gap-1 text-sm">{t('apiTester.import.logicalLocation', 'Document {{index}} logical location', { index: index + 1 })}<Input disabled={busy} value={document.location} onChange={event => { invalidate(); setDocuments(current => current.map((item, i) => i === index ? { ...item, location: event.target.value } : item)); }} /></label>)}
            </div>}
            <Textarea
              rows={10}
              className="font-mono text-xs"
              placeholder={t('apiTester.import.paste', 'Or paste the description or the collection here')}
              value={content}
              onChange={(e) => { invalidate(); setContent(e.target.value); }}
              data-testid="import-content"
            />
          </div>
        ) : (
          <div className="space-y-3" data-testid="import-preview">
            {preview.endpoints && preview.endpoints.length > 0 && <label className="grid gap-1 text-sm">{copy('endpoint', 'SOAP endpoint')}<select className="rounded-md border bg-background p-2" value={endpoint ?? preview.selectedEndpoint ?? ''} disabled={busy} onChange={event => { const selectedEndpoint = event.target.value; setEndpoint(selectedEndpoint); setPreview(null); setSelected(new Set()); void showPreview(selectedEndpoint); }}>{preview.endpoints.map(item => <option key={item.id} value={item.id}>{item.label} — {item.address}</option>)}</select></label>}
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
            <Button onClick={() => void showPreview()} disabled={busy || !content.trim()} data-testid="import-preview-button">
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

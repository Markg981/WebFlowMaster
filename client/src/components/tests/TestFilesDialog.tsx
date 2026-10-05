import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, FileUp, Loader2 } from 'lucide-react';
import { bddRequest, type BddProfile } from '@/lib/api/bdd';

/**
 * The organization's tests as a file (server/test-bundle.ts): export a project's web and API tests to
 * keep under version control, and import such a file back — same names are updated, with a new
 * version each, the others created.
 */

type Outcome = { kind: 'test' | 'api_test'; name: string; outcome: 'created' | 'updated' | 'unchanged' | 'invalid'; reason?: string; gherkin?: {language:string;scenario:string;rule?:string;tags:string[];arguments:('docString'|'dataTable')[];mode:'manual'|'cucumber'} };

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
  const [format, setFormat] = useState<'yaml' | 'json' | 'gherkin'>('yaml');
  const [importFormat, setImportFormat] = useState<'bundle' | 'gherkin'>('bundle');
  const [content, setContent] = useState('');
  const [importProject, setImportProject] = useState(NONE);
  const [results, setResults] = useState<{ dryRun: boolean; results: Outcome[]; identity: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'manual'|'cucumber'>('manual');
  const [binding, setBinding] = useState<{id:string;revision:string}|null>(null);
  const {data: profileData, error: profilesError} = useQuery<{profiles:BddProfile[]}>({queryKey:['/api/bdd/profiles'],enabled:open&&canEdit,queryFn:()=>bddRequest('/api/bdd/profiles')});
  const profiles=(profileData?.profiles??[]).filter(p=>p.projectId==null||String(p.projectId)===importProject);
  const profile=profiles.find(p=>p.id===binding?.id&&p.revision===binding?.revision);
  const missingProfile=mode==='cucumber'&&!profile;
  const importIdentity=JSON.stringify([open,content,importProject,importFormat,mode,profile?.id,profile?.revision]);
  const currentImportIdentity=useRef(importIdentity);
  currentImportIdentity.current=importIdentity;
  useEffect(()=>{setResults(null);},[importIdentity]);

  const exportHref = `/api/tests/export?format=${format}${exportProject === ALL ? '' : `&projectId=${exportProject}`}`;

  const send = (dryRun: boolean) => async () => {
    if(missingProfile||(!dryRun&&(results?.dryRun!==true||results.identity!==currentImportIdentity.current)))return;
    const requestIdentity=currentImportIdentity.current;
    setBusy(true);
    setError('');
    try {
      if(missingProfile) return;
      const outcome = await importBundle({ content, dryRun, projectId: importProject === NONE ? null : Number(importProject), ...(importFormat === 'gherkin' ? { format: 'gherkin' } : {}), bdd:{mode,...(mode==='cucumber'&&profile?{binding:{id:profile.id,revision:profile.revision}}:{})} });
      if(currentImportIdentity.current===requestIdentity)setResults({...outcome,identity:requestIdentity});
      if (!dryRun) onImported();
    } catch (e) {
      if(currentImportIdentity.current===requestIdentity)setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = (next: boolean) => {
    if (!next) {
      setContent('');
      setResults(null);
      setError('');
      setMode('manual');
      setBinding(null);
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
              <Select value={format} onValueChange={(value) => setFormat(value as 'yaml' | 'json' | 'gherkin')}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yaml">YAML</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="gherkin">Gherkin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button asChild variant="outline">
              <a href={exportHref} download data-testid="test-files-export">
                <Download className="mr-2 h-4 w-4" /> {t('testFiles.download', 'Download')}
              </a>
            </Button>
          </div>
          {format === 'gherkin' && <p className="text-sm text-muted-foreground">{t('testFiles.gherkinExport', 'Exports web tests only. WebFlowMaster metadata preserves original actions; Cucumber execution requires your own step definitions.')}</p>}
        </section>

        {canEdit && (
          <section className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{t('testFiles.import', 'Import')}</p>
            <div className="space-y-1">
              <Label htmlFor="test-files-import-format">{t('testFiles.format', 'Format')}</Label>
              <select id="test-files-import-format" className="rounded-md border bg-background p-2 text-sm" value={importFormat} onChange={(e) => { setImportFormat(e.target.value as 'bundle' | 'gherkin'); setResults(null); }}>
                <option value="bundle">YAML / JSON</option>
                <option value="gherkin">Gherkin (.feature)</option>
              </select>
            </div>
            {importFormat === 'gherkin' && <p className="text-sm text-muted-foreground">{t('testFiles.gherkinImport', 'Standard Gherkin dialects, Rule, Background, Scenario Outline, tags, doc strings and data tables are supported. Choose manual execution or an authorized Cucumber support profile. WFM metadata restores exported web actions.')}</p>}
            <div className="space-y-1">
              <Label htmlFor="test-files-mode">{t('bdd.mode','Execution mode')}</Label>
              <select id="test-files-mode" data-testid="test-files-mode" className="border rounded p-2 bg-background text-sm" value={mode} onChange={e=>{setMode(e.target.value as 'manual'|'cucumber');setResults(null);}}>
                <option value="manual">{t('bdd.manual','Manual')}</option><option value="cucumber">{t('bdd.cucumber','Cucumber')}</option>
              </select>
            </div>
            {mode==='cucumber'&&<div className="space-y-1"><Label htmlFor="test-files-profile">{t('bdd.profile','Execution profile')}</Label><select id="test-files-profile" data-testid="test-files-profile" className="border rounded p-2 bg-background text-sm" value={profile?.id??''} onChange={e=>{const selected=profiles.find(p=>p.id===e.target.value);setBinding(selected?{id:selected.id,revision:selected.revision}:null);setResults(null);}}><option value="">{t('bdd.selectProfile','Select an authorized profile')}</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {p.revision}</option>)}</select>{!profiles.length&&<p className="text-sm text-muted-foreground">{t('bdd.noProfiles','No execution profiles are available for this project. Ask an organization owner to configure one.')}</p>}</div>}
            {profilesError&&<p role="alert" className="text-destructive">{profilesError.message}</p>}
            <Label htmlFor="test-files-file" className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <FileUp className="h-4 w-4" /> {t('testFiles.openFile', 'Open a file…')}
            </Label>
            <input
              id="test-files-file"
              type="file"
              accept=".yaml,.yml,.json,.feature"
              className="sr-only"
              onChange={(e) => { const file = e.target.files?.[0]; file?.text().then((text) => { setContent(text); setImportFormat(file.name.toLowerCase().endsWith('.feature') ? 'gherkin' : 'bundle'); setResults(null); }); }}
            />
            <Textarea rows={6} className="font-mono text-xs" placeholder={importFormat === 'gherkin' ? 'Feature: Login' : 'kind: webflowmaster/tests'} value={content} onChange={(e) => { setContent(e.target.value); setResults(null); }} data-testid="test-files-content" />
            <div className="space-y-1">
              <Label>{t('testFiles.newTestsGoTo', 'New tests go to')}</Label>
              <Select value={importProject} onValueChange={(value) => { setImportProject(value); setResults(null); }}>
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
                    {r.gherkin&&<div className="w-full text-xs text-muted-foreground" data-testid="test-files-gherkin-preview"><span>{t('bdd.language','Dialect')}: {r.gherkin.language} · {r.gherkin.scenario}{r.gherkin.rule&&` · ${r.gherkin.rule}`} · {t(`bdd.${r.gherkin.mode}`,r.gherkin.mode)}</span><span> {r.gherkin.tags.join(' ')} {r.gherkin.arguments.map(arg=>t(`bdd.${arg}`,arg==='docString'?'Doc string':'Step data table')).join(', ')}</span></div>}
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
              <Button variant="outline" onClick={send(true)} disabled={busy || !content.trim() || missingProfile} data-testid="test-files-preview">
                {t('testFiles.preview', 'Show what changes')}
              </Button>
              <Button onClick={send(false)} disabled={busy || !content.trim() || missingProfile || results?.dryRun !== true || results.identity !== importIdentity} data-testid="test-files-import">
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

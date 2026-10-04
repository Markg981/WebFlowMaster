import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface Template { purpose: string; subject: string; html: string; text: string; version: number; custom: boolean; variables: string[] }
interface Preview { subject: string; html: string; text: string }
export default function EmailTemplatesCard() {
  const { user } = useAuth();
  return <TemplateEditor key={`${user?.organizationId}:${user?.id}`} organizationId={user?.organizationId} userId={user?.id} />;
}
function TemplateEditor({ organizationId, userId }: { organizationId?: number | null; userId?: number }) {
  const { t } = useTranslation();
  const query = useQuery<{ templates: Template[] }>({ queryKey: ['mail-templates', organizationId, userId], queryFn: async () => (await apiRequest('GET', '/api/mail-templates')).json() });
  const [draft, setDraft] = useState<Template | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'saved' | 'error' | 'stale' | null>(null);
  const generation = useRef(0);
  useEffect(() => { if (!draft && query.data?.templates[0]) setDraft(query.data.templates[0]); }, [query.data, draft]);
  useEffect(() => () => { generation.current++; }, []);
  const change = (field: 'subject' | 'html' | 'text', value: string) => {
    generation.current++; setDraft(current => current ? { ...current, [field]: value } : null); setPreview(null); if (status !== 'stale') setStatus(null);
  };
  async function action(kind: 'save' | 'preview' | 'reset') {
    if (!draft) return;
    const epoch = ++generation.current; setBusy(true); setStatus(current => current === 'stale' ? 'stale' : null);
    try {
      const response = await apiRequest(kind === 'save' ? 'PUT' : kind === 'reset' ? 'DELETE' : 'POST', `/api/mail-templates/${draft.purpose}${kind === 'preview' ? '/preview' : ''}`, kind === 'reset' ? { version: draft.version } : { subject: draft.subject, html: draft.html, text: draft.text, version: draft.version });
      const result = await response.json();
      if (generation.current !== epoch) return;
      if (kind === 'preview') setPreview(result);
      else { setDraft(result); setPreview(null); setStatus('saved'); void query.refetch(); }
    } catch (error) {
      if (generation.current === epoch) setStatus(current => current === 'stale' || error instanceof Error && /^409\b/.test(error.message) ? 'stale' : 'error');
    } finally { if (generation.current === epoch) setBusy(false); }
  }
  async function reload() {
    const epoch = ++generation.current; setBusy(true);
    const fresh = await query.refetch();
    if (generation.current !== epoch) return;
    setDraft(fresh.data?.templates.find(row => row.purpose === draft?.purpose) ?? fresh.data?.templates[0] ?? null); setPreview(null); setStatus(null); setBusy(false);
  }
  return <Card>
    <CardHeader><CardTitle>{t('emailTemplates.title')}</CardTitle><CardDescription>{t('emailTemplates.description')}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {query.isLoading ? <p>{t('emailTemplates.loading')}</p> : query.isError ? <p role="alert">{t('emailTemplates.loadError')}</p> : draft && <>
        <div><Label htmlFor="mail-template-purpose">{t('emailTemplates.purpose')}</Label><select id="mail-template-purpose" className="w-full rounded-md border bg-background p-2" value={draft.purpose} disabled={busy} onChange={event => {
          generation.current++; setDraft(query.data!.templates.find(row => row.purpose === event.target.value)!); setPreview(null); setStatus(null);
        }}>{query.data?.templates.map(row => <option key={row.purpose} value={row.purpose}>{t(`emailDelivery.purposes.${row.purpose}`)}</option>)}</select></div>
        <p className="text-sm text-muted-foreground">{t('emailTemplates.variables')}: {draft.variables.map(variable => `{{${variable}}}`).join(', ')}</p>
        {draft.purpose !== 'run_finished' && <p className="text-sm text-muted-foreground">{t('emailTemplates.requiredLink')}</p>}
        <div><Label htmlFor="mail-template-subject">{t('emailTemplates.subject')}</Label><Input id="mail-template-subject" disabled={busy} maxLength={254} value={draft.subject} onChange={event => change('subject', event.target.value)} /></div>
        <div><Label htmlFor="mail-template-html">{t('emailTemplates.html')}</Label><Textarea id="mail-template-html" disabled={busy} rows={10} maxLength={50000} className="font-mono text-sm" value={draft.html} onChange={event => change('html', event.target.value)} /></div>
        <div><Label htmlFor="mail-template-text">{t('emailTemplates.text')}</Label><Textarea id="mail-template-text" disabled={busy} rows={6} maxLength={20000} value={draft.text} onChange={event => change('text', event.target.value)} /></div>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => void action('preview')}>{t('emailTemplates.preview')}</Button><Button type="button" disabled={busy || status === 'stale'} onClick={() => void action('save')}>{t(busy ? 'emailTemplates.saving' : 'emailTemplates.save')}</Button><Button type="button" variant="outline" disabled={busy || status === 'stale'} onClick={() => void action('reset')}>{t('emailTemplates.reset')}</Button></div>
        {status && <p role={status === 'saved' ? 'status' : 'alert'}>{t(`emailTemplates.${status}`)}</p>}
        {status === 'stale' && <Button type="button" variant="outline" onClick={() => void reload()}>{t('emailTemplates.reload')}</Button>}
        {preview && <section className="space-y-2"><h3 className="font-medium">{preview.subject}</h3><iframe title={t('emailTemplates.previewTitle')} sandbox="" referrerPolicy="no-referrer" className="h-80 w-full rounded-md border bg-white" srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; navigate-to 'none'"></head><body>${preview.html}</body></html>`} /><pre className="whitespace-pre-wrap rounded-md border p-3 text-sm">{preview.text}</pre></section>}
      </>}
    </CardContent>
  </Card>;
}

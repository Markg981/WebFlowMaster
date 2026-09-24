import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, KeyRound, Loader2 } from 'lucide-react';

/**
 * Single sign-on with the organization's identity provider (server/sso.ts). Owners only.
 *
 * The owner registers the application with their provider, using the callback address shown
 * here, and copies back the issuer, the client id and the secret.
 */

export interface SsoSettings {
  issuer: string;
  clientId: string;
  domains: string[];
  defaultRole: 'viewer' | 'editor';
  enabled: boolean;
  required: boolean;
  updatedAt: string;
}

interface SsoResponse {
  settings: SsoSettings | null;
  callbackUrl: string;
}

async function send(method: string, url: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? 'Something went wrong');
  return payload;
}

const EMPTY = { issuer: '', clientId: '', clientSecret: '', domains: '', defaultRole: 'viewer' as const, enabled: true, required: false };

export default function SsoCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<{ issuer: string; clientId: string; clientSecret: string; domains: string; defaultRole: 'viewer' | 'editor'; enabled: boolean; required: boolean }>(EMPTY);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data, isLoading } = useQuery<SsoResponse>({
    queryKey: ['organization-sso'],
    queryFn: () => send('GET', '/api/organization/sso'),
  });
  const saved = data?.settings ?? null;

  useEffect(() => {
    if (!data) return;
    setForm(
      data.settings
        ? { ...data.settings, clientSecret: '', domains: data.settings.domains.join(', ') }
        : EMPTY,
    );
  }, [data]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    run(async () => {
      const result = await send('PUT', '/api/organization/sso', {
        ...form,
        domains: form.domains.split(/[\s,;]+/).filter(Boolean),
        required: form.enabled && form.required,
      });
      queryClient.setQueryData(['organization-sso'], result);
      setNotice(t('sso.saved', 'Saved.'));
    });
  };

  const test = () =>
    run(async () => {
      const result = await send('POST', '/api/organization/sso/test');
      if (result.ok) setNotice(t('sso.testOk', 'The provider answered: {{issuer}}', { issuer: result.issuer }));
      else setError(t('sso.testFailed', 'The provider did not answer: {{message}}', { message: result.message }));
    });

  const remove = () =>
    run(async () => {
      await send('DELETE', '/api/organization/sso');
      setConfirmRemove(false);
      queryClient.invalidateQueries({ queryKey: ['organization-sso'] });
    });

  const canSave = form.issuer.trim() && form.clientId.trim() && form.domains.trim() && (saved || form.clientSecret.trim());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <span>{t('sso.title', 'Single sign-on')}</span>
          {saved?.enabled && <Badge variant="secondary">{t('sso.on', 'on')}</Badge>}
          {saved?.required && <Badge variant="secondary">{t('sso.requiredBadge', 'required')}</Badge>}
        </CardTitle>
        <CardDescription>
          {t(
            'sso.description',
            'Members sign in with your identity provider (OpenID Connect: Entra ID, Okta, Google Workspace, Keycloak…). The first time someone from your domains signs in, their account is created.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground">{t('security.loading', 'Loading…')}</p>
        ) : (
          <form onSubmit={save} className="space-y-4" data-testid="sso-form">
            <div className="space-y-1">
              <Label>{t('sso.callbackUrl', 'Redirect URI to register with your provider')}</Label>
              <div className="flex gap-2">
                <Input readOnly value={data.callbackUrl} data-testid="sso-callback-url" className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t('sso.copy', 'Copy')}
                  onClick={() => navigator.clipboard?.writeText(data.callbackUrl)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="sso-issuer">{t('sso.issuer', 'Issuer')}</Label>
                <Input id="sso-issuer" placeholder="https://login.microsoftonline.com/<tenant>/v2.0" value={form.issuer} onChange={(e) => set('issuer', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sso-client-id">{t('sso.clientId', 'Client ID')}</Label>
                <Input id="sso-client-id" value={form.clientId} onChange={(e) => set('clientId', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sso-client-secret">{t('sso.clientSecret', 'Client secret')}</Label>
                <Input
                  id="sso-client-secret"
                  type="password"
                  autoComplete="off"
                  placeholder={saved ? t('sso.secretKept', 'Stored. Leave empty to keep it.') : ''}
                  value={form.clientSecret}
                  onChange={(e) => set('clientSecret', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sso-domains">{t('sso.domains', 'E-mail domains')}</Label>
                <Input id="sso-domains" placeholder="example.com, example.org" value={form.domains} onChange={(e) => set('domains', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sso-default-role">{t('sso.defaultRole', 'Role of new accounts')}</Label>
                <Select value={form.defaultRole} onValueChange={(value) => set('defaultRole', value as 'viewer' | 'editor')}>
                  <SelectTrigger id="sso-default-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">{t('sso.roleViewer', 'Viewer')}</SelectItem>
                    <SelectItem value="editor">{t('sso.roleEditor', 'Editor')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 border-t pt-4">
              <div>
                <Label htmlFor="sso-enabled" className="text-sm font-medium">{t('sso.enabled', 'Offer single sign-on')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('sso.enabledHint', 'Off keeps the settings and signs nobody in through the provider.')}
                </p>
              </div>
              <Switch id="sso-enabled" checked={form.enabled} onCheckedChange={(value) => set('enabled', value)} />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="sso-required" className="text-sm font-medium">{t('sso.required', 'Require it')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'sso.requiredHint',
                    'Members other than owners can no longer sign in with a password, and their password sessions end. Owners keep theirs, to get back in if the provider fails. API keys are not affected.',
                  )}
                </p>
              </div>
              <Switch id="sso-required" checked={form.enabled && form.required} disabled={!form.enabled} onCheckedChange={(value) => set('required', value)} />
            </div>

            <p className="text-xs text-muted-foreground">
              {t(
                'sso.removalNote',
                'Your provider decides who gets in: someone removed here comes back with a new account at their next sign-in. End their access at the provider.',
              )}
            </p>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy || !canSave}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('sso.save', 'Save')}
              </Button>
              {saved && (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={test}>
                  {t('sso.test', 'Test the provider')}
                </Button>
              )}
              {saved && !confirmRemove && (
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRemove(true)}>
                  {t('sso.remove', 'Remove')}
                </Button>
              )}
              {confirmRemove && (
                <>
                  <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={remove}>
                    {t('sso.removeConfirm', 'Remove single sign-on')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                    {t('security.cancel', 'Cancel')}
                  </Button>
                </>
              )}
            </div>
            {notice && <p className="text-sm text-muted-foreground" data-testid="sso-notice">{notice}</p>}
            {error && <p className="text-sm text-destructive" data-testid="sso-error">{error}</p>}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

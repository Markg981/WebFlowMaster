import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, KeyRound, Loader2 } from 'lucide-react';
import { DomainVerification, RoleMappingEditor, type DomainStatus, type RoleMappingRow } from './SsoRolesAndDomains';
import { ScimProvisioning, type ScimTokenStatus } from './ScimProvisioning';
import SamlAdvancedSettings, { type SamlAdvancedForm } from './SamlAdvancedSettings';

/**
 * Single sign-on with the organization's identity provider (server/sso.ts). Owners only.
 *
 * OpenID Connect: the owner registers the application with their provider, using the callback
 * address shown here, and copies back the issuer, the client id and the secret.
 * SAML 2.0 (server/sso-saml.ts): the owner gives the provider this organization's entity ID and ACS
 * address (or its metadata URL), and copies back the provider's entity ID, sign-on URL and signing
 * certificate — or pastes the provider's metadata, which fills the three.
 */

type Protocol = 'oidc' | 'saml';

export interface SsoSettings {
  protocol: Protocol;
  issuer: string;
  clientId: string | null;
  samlSsoUrl: string | null;
  samlCertificate: string | null;
  samlCertificateInfo: { subject: string; validTo: string; expired: boolean } | null;
  samlAllowIdpInitiated?: boolean;
  samlRequireEncryptedAssertions?: boolean;
  samlSloUrl?: string | null;
  samlSpCertificate?: string | null;
  samlSpPrivateKeyConfigured?: boolean;
  domains: string[];
  domainStatus?: DomainStatus[];
  verificationRequired?: boolean;
  defaultRole: 'viewer' | 'editor';
  enabled: boolean;
  required: boolean;
  groupAttribute?: string;
  roleMappings?: RoleMappingRow[];
  requireGroup?: boolean;
  scimToken?: ScimTokenStatus | null;
  updatedAt: string;
}

interface SsoResponse {
  settings: SsoSettings | null;
  callbackUrl: string;
  saml: { entityId: string; acsUrl: string; metadataUrl: string; sloUrl?: string };
  scim?: { baseUrl: string };
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

interface Form extends SamlAdvancedForm {
  protocol: Protocol;
  issuer: string;
  clientId: string;
  clientSecret: string;
  samlSsoUrl: string;
  samlCertificate: string;
  domains: string;
  defaultRole: 'viewer' | 'editor';
  enabled: boolean;
  required: boolean;
  groupAttribute: string;
  roleMappings: RoleMappingRow[];
  requireGroup: boolean;
}

const EMPTY: Form = {
  protocol: 'oidc', issuer: '', clientId: '', clientSecret: '', samlSsoUrl: '', samlCertificate: '',
  domains: '', defaultRole: 'viewer', enabled: true, required: false,
  groupAttribute: 'groups', roleMappings: [], requireGroup: false,
  samlAllowIdpInitiated: false, samlRequireEncryptedAssertions: false,
  samlSloUrl: '', samlSpCertificate: '', samlSpPrivateKey: '', samlClearSpKey: false,
};

function CopyField({ label, value, testId }: { label: string; value: string; testId: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} data-testid={testId} className="font-mono text-xs" />
        <Button type="button" variant="outline" size="icon" aria-label={t('sso.copy', 'Copy')} onClick={() => navigator.clipboard?.writeText(value)}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function SsoCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [metadataXml, setMetadataXml] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data, isLoading, isError, isFetching, refetch } = useQuery<SsoResponse>({
    queryKey: ['organization-sso'],
    queryFn: () => send('GET', '/api/organization/sso'),
  });
  const saved = data?.settings ?? null;

  useEffect(() => {
    if (!data) return;
    const s = data.settings;
    setForm(
      s
        ? {
            protocol: s.protocol ?? 'oidc',
            issuer: s.issuer,
            clientId: s.clientId ?? '',
            clientSecret: '',
            samlSsoUrl: s.samlSsoUrl ?? '',
            samlCertificate: s.samlCertificate ?? '',
            samlAllowIdpInitiated: s.samlAllowIdpInitiated ?? false,
            samlRequireEncryptedAssertions: s.samlRequireEncryptedAssertions ?? false,
            samlSloUrl: s.samlSloUrl ?? '',
            samlSpCertificate: s.samlSpCertificate ?? '',
            samlSpPrivateKey: '',
            samlClearSpKey: false,
            domains: s.domains.join(', '),
            defaultRole: s.defaultRole,
            enabled: s.enabled,
            required: s.required,
            groupAttribute: s.groupAttribute ?? 'groups',
            roleMappings: s.roleMappings ?? [],
            requireGroup: s.requireGroup ?? false,
          }
        : EMPTY,
    );
  }, [data]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

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
      const common = {
        protocol: form.protocol,
        issuer: form.issuer,
        domains: form.domains.split(/[\s,;]+/).filter(Boolean),
        defaultRole: form.defaultRole,
        enabled: form.enabled,
        required: form.enabled && form.required,
        groupAttribute: form.groupAttribute.trim() || null,
        roleMappings: form.roleMappings.filter((m) => m.group.trim() !== '').map((m) => ({ group: m.group.trim(), role: m.role })),
        requireGroup: form.requireGroup && form.roleMappings.some((m) => m.group.trim() !== ''),
      };
      const body = form.protocol === 'oidc'
        ? { ...common, clientId: form.clientId, clientSecret: form.clientSecret }
        : {
          ...common, samlSsoUrl: form.samlSsoUrl, samlCertificate: form.samlCertificate,
          samlAllowIdpInitiated: form.samlAllowIdpInitiated,
          samlRequireEncryptedAssertions: form.samlRequireEncryptedAssertions,
          samlSloUrl: form.samlSloUrl.trim() || null,
          samlSpCertificate: form.samlClearSpKey ? null : form.samlSpCertificate || null,
          samlSpPrivateKey: form.samlClearSpKey ? '' : form.samlSpPrivateKey,
          samlClearSpKey: form.samlClearSpKey,
        };
      const result = await send('PUT', '/api/organization/sso', body);
      setForm(current => ({ ...current, samlSpPrivateKey: '', samlClearSpKey: false }));
      queryClient.setQueryData(['organization-sso'], result);
      setNotice(t('sso.saved', 'Saved.'));
    });
  };

  const readMetadata = () =>
    run(async () => {
      const parsed = await send('POST', '/api/organization/sso/saml-metadata', { xml: metadataXml });
      setForm((current) => ({ ...current, issuer: parsed.entityId, samlSsoUrl: parsed.ssoUrl, samlCertificate: parsed.certificate, samlSloUrl: parsed.sloUrl ?? '' }));
      setMetadataXml('');
      setNotice(t('sso.saml.metadataRead', 'Filled from the metadata. Check the values, then save.'));
    });

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

  const oidcReady = form.clientId.trim() && (saved?.protocol === 'oidc' || form.clientSecret.trim());
  const samlReady = form.samlSsoUrl.trim() && form.samlCertificate.trim();
  const canSave = form.issuer.trim() && form.domains.trim() && (form.protocol === 'oidc' ? oidcReady : samlReady);
  const certInfo = saved?.protocol === 'saml' && form.samlCertificate === saved.samlCertificate ? saved.samlCertificateInfo : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <span>{t('sso.title', 'Single sign-on')}</span>
          {saved?.enabled && <Badge variant="secondary">{t('sso.on', 'on')}</Badge>}
          {saved?.required && <Badge variant="secondary">{t('sso.requiredBadge', 'required')}</Badge>}
          {saved && <Badge variant="outline">{saved.protocol === 'saml' ? 'SAML 2.0' : 'OpenID Connect'}</Badge>}
        </CardTitle>
        <CardDescription>
          {t(
            'sso.description',
            'Members sign in with your identity provider (OpenID Connect or SAML 2.0: Entra ID, Okta, Google Workspace, ADFS, Keycloak…). The first time someone from your domains signs in, their account is created.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isError && !data ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{t('sso.loadFailed', 'Could not load single sign-on settings.')}</p>
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>{t('sso.retry', 'Retry')}</Button>
          </div>
        ) : isLoading || !data ? (
          <p className="text-sm text-muted-foreground">{t('security.loading', 'Loading…')}</p>
        ) : (
          <form onSubmit={save} className="space-y-4" data-testid="sso-form">
            <div className="space-y-1">
              <Label htmlFor="sso-protocol">{t('sso.protocol', 'Protocol')}</Label>
              <Select value={form.protocol} onValueChange={(value) => set('protocol', value as Protocol)}>
                <SelectTrigger id="sso-protocol" data-testid="sso-protocol" className="md:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oidc">OpenID Connect</SelectItem>
                  <SelectItem value="saml">SAML 2.0</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.protocol === 'oidc' ? (
              <>
                <CopyField label={t('sso.callbackUrl', 'Redirect URI to register with your provider')} value={data.callbackUrl} testId="sso-callback-url" />
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
                      placeholder={saved?.protocol === 'oidc' ? t('sso.secretKept', 'Stored. Leave empty to keep it.') : ''}
                      value={form.clientSecret}
                      onChange={(e) => set('clientSecret', e.target.value)}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {t('sso.saml.spHint', 'Give your identity provider these values, or the metadata URL, which carries them all.')}
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <CopyField label={t('sso.saml.entityId', 'Entity ID (audience) of WebFlowMaster')} value={data.saml.entityId} testId="sso-saml-entity-id" />
                  <CopyField label={t('sso.saml.acsUrl', 'Assertion consumer service (ACS) URL')} value={data.saml.acsUrl} testId="sso-saml-acs-url" />
                  {data.saml.sloUrl && <CopyField label={t('sso.saml.spSloUrl', 'WebFlowMaster single logout callback URL')} value={data.saml.sloUrl} testId="sso-saml-slo-url" />}
                  <div className="md:col-span-2">
                    <CopyField label={t('sso.saml.metadataUrl', 'Service provider metadata URL (available once saved)')} value={data.saml.metadataUrl} testId="sso-saml-metadata-url" />
                  </div>
                </div>
                <div className="space-y-1 border-t pt-4">
                  <Label htmlFor="sso-saml-metadata">{t('sso.saml.pasteMetadata', "Your provider's metadata (optional: fills the provider fields below)")}</Label>
                  <Textarea id="sso-saml-metadata" rows={3} className="font-mono text-xs" placeholder="<md:EntityDescriptor …>" value={metadataXml} onChange={(e) => setMetadataXml(e.target.value)} />
                  <Button type="button" size="sm" variant="outline" disabled={busy || !metadataXml.trim()} onClick={readMetadata}>
                    {t('sso.saml.readMetadata', 'Read the metadata')}
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="sso-saml-issuer">{t('sso.saml.idpEntityId', "Provider's entity ID")}</Label>
                    <Input id="sso-saml-issuer" placeholder="https://sts.windows.net/<tenant>/" value={form.issuer} onChange={(e) => set('issuer', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sso-saml-sso-url">{t('sso.saml.ssoUrl', 'Sign-on URL (HTTP-Redirect)')}</Label>
                    <Input id="sso-saml-sso-url" placeholder="https://login.microsoftonline.com/<tenant>/saml2" value={form.samlSsoUrl} onChange={(e) => set('samlSsoUrl', e.target.value)} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label htmlFor="sso-saml-cert">{t('sso.saml.certificate', 'Signing certificate (X.509, PEM or base64)')}</Label>
                    <Textarea id="sso-saml-cert" rows={4} className="font-mono text-xs" placeholder="-----BEGIN CERTIFICATE-----" value={form.samlCertificate} onChange={(e) => set('samlCertificate', e.target.value)} />
                    {certInfo && (
                      <p className={`text-xs ${certInfo.expired ? 'text-destructive' : 'text-muted-foreground'}`} data-testid="sso-saml-cert-info">
                        {certInfo.expired
                          ? t('sso.saml.certExpired', 'Expired on {{date}}: sign-ins are refused until you paste the new certificate.', { date: certInfo.validTo.slice(0, 10) })
                          : t('sso.saml.certValid', '{{subject}} · valid until {{date}}', { subject: certInfo.subject, date: certInfo.validTo.slice(0, 10) })}
                      </p>
                    )}
                  </div>
                </div>
                <SamlAdvancedSettings value={form} privateKeyConfigured={!!saved?.samlSpPrivateKeyConfigured} disabled={busy} onChange={next => setForm(current => ({ ...current, ...next }))} />
              </>
            )}

            <div className="grid gap-4 md:grid-cols-2">
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

            {saved?.domainStatus && (
              <DomainVerification
                domains={saved.domainStatus}
                required={!!saved.verificationRequired}
                onVerified={() => queryClient.invalidateQueries({ queryKey: ['organization-sso'] })}
              />
            )}

            <RoleMappingEditor
              attribute={form.groupAttribute}
              mappings={form.roleMappings}
              requireGroup={form.requireGroup}
              onChange={(next) => setForm((current) => ({ ...current, groupAttribute: next.attribute, roleMappings: next.mappings, requireGroup: next.requireGroup }))}
            />

            {saved && data.scim && (
              <ScimProvisioning
                baseUrl={data.scim.baseUrl}
                token={saved.scimToken ?? null}
                onChanged={() => queryClient.invalidateQueries({ queryKey: ['organization-sso'] })}
              />
            )}

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
                'Your provider decides who gets in: someone removed here comes back with a new account at their next sign-in. End their access at the provider — with SCIM provisioning, that deactivates them here at once — or map groups and refuse whoever is in none.',
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

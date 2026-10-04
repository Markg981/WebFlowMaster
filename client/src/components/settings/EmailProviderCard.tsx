import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MailSettingsInput } from '@shared/mail-settings';
interface Settings extends MailSettingsInput { hasSmtpPassword: boolean; hasSigningSecret: boolean; callbackId: string | null; configured: boolean; trackingConfigured: boolean }
export default function EmailProviderCard() {
 const { t } = useTranslation(); const { user } = useAuth(); const client = useQueryClient();
 const identity = `${user?.organizationId}:${user?.id}`; const currentIdentity = useRef(identity); currentIdentity.current = identity;
 const key = ['mail-settings', user?.organizationId, user?.id];
 const query = useQuery<Settings>({ queryKey: key, queryFn: async () => (await apiRequest('GET', '/api/mail-settings')).json() });
 const [draft, setDraft] = useState<Settings | null>(null); const [draftIdentity, setDraftIdentity] = useState(identity);
 const [pending, setPending] = useState(false); const [message, setMessage] = useState(''); const [stale, setStale] = useState(false);
 useEffect(() => { setDraft(null); setDraftIdentity(identity); setPending(false); setMessage(''); setStale(false); }, [identity]);
 useEffect(() => { if (query.data) setDraft(old => old ?? { ...query.data, smtpPassword: undefined, signingSecret: undefined }); }, [query.data, identity]);
 const values = draftIdentity === identity ? draft : null;
 const copy = (name: string, fallback: string) => t(`emailProvider.${name}`, fallback);
 const edit = (changes: Partial<Settings>) => { setDraft(old => old && ({ ...old, ...changes })); setMessage(''); };
 async function save() {
  if (!values || pending) return; const target = identity; setPending(true); setMessage('');
  const { hasSmtpPassword: _password, hasSigningSecret: _secret, callbackId: _callback, configured: _configured, trackingConfigured: _tracking, ...payload } = values;
  if (!payload.smtpPassword) delete payload.smtpPassword; if (!payload.signingSecret) delete payload.signingSecret;
  if (!payload.smtpHost) delete payload.smtpHost;
  try { const result = await (await apiRequest('PUT', '/api/mail-settings', payload)).json();
   if (currentIdentity.current !== target) return;
   client.setQueryData(key, result); void client.invalidateQueries({ queryKey: ['mail-deliveries', user?.organizationId, user?.id] });
   setDraft({ ...result, smtpPassword: undefined, signingSecret: undefined }); setStale(false); setMessage(copy('saved', 'Email settings saved.'));
  } catch (error) { if (currentIdentity.current !== target) return;
   const conflict = (error as { status?: number }).status === 409; setStale(conflict);
   setMessage(conflict ? copy('stale', 'Settings changed elsewhere. Your draft is preserved; reload to discard it and load the latest settings.') : copy('error', 'Email settings could not be saved. Check the required provider fields.'));
  } finally { if (currentIdentity.current === target) setPending(false); }
 }
 const field = (name: keyof Settings, label: string, type = 'text') => <label className="grid gap-1 text-sm">{label}<Input type={type} autoComplete={type === 'password' ? 'new-password' : 'off'} value={String(values?.[name] ?? '')} onChange={event => edit({ [name]: type === 'number' ? Number(event.target.value) : event.target.value })} /></label>;
 return <Card><CardHeader><CardTitle>{copy('title', 'Organization email')}</CardTitle><CardDescription>{copy('description', 'Choose how this organization sends email and verifies delivery events.')}</CardDescription></CardHeader><CardContent className="space-y-4">
 {!values ? <p role={query.isError ? 'alert' : undefined}>{query.isError ? copy('loadError', 'Email settings could not be loaded.') : copy('loading', 'Loading…')}</p> : <>
 <fieldset disabled={pending || query.isFetching} className="space-y-4">
 <label className="grid gap-1 text-sm">{copy('smtpMode', 'Email sending')}<select className="rounded-md border bg-background p-2" value={values.smtpMode} onChange={event => edit({ smtpMode: event.target.value as Settings['smtpMode'] })}><option value="inherit">{copy('inherit', 'Installation defaults')}</option><option value="custom">{copy('custom', 'Custom SMTP')}</option><option value="disabled">{copy('disabled', 'Disabled')}</option></select></label>
 {values.smtpMode === 'custom' && <div className="grid gap-3 sm:grid-cols-2">
 {field('smtpHost', copy('smtpHost', 'SMTP host'))}{field('smtpPort', copy('smtpPort', 'SMTP port'), 'number')}{field('smtpUsername', copy('smtpUsername', 'SMTP username'))}{field('smtpPassword', copy('smtpPassword', 'SMTP password'), 'password')}{field('fromAddress', copy('fromAddress', 'From address'))}
 <label className="grid gap-1 text-sm">{copy('tls', 'SMTP encryption')}<select className="rounded-md border bg-background p-2" value={values.smtpSecure ? 'implicit' : 'starttls'} onChange={event => edit({ smtpSecure: event.target.value === 'implicit' })}><option value="starttls">STARTTLS</option><option value="implicit">{copy('implicitTls', 'Implicit TLS')}</option></select></label>
 <p className="text-sm text-muted-foreground sm:col-span-2">{copy('credentialHelp', 'Credentials are write-only. Leave blank to keep the stored value; use the clear control to remove it.')}</p>
 {values.hasSmtpPassword && <label className="text-sm"><input type="checkbox" checked={Boolean(values.clearSmtpPassword)} onChange={event => edit({ clearSmtpPassword: event.target.checked })} /> {copy('clearPassword', 'Clear stored SMTP password')}</label>}
 </div>}
 <label className="grid gap-1 text-sm">{copy('provider', 'Tracking provider')}<select className="rounded-md border bg-background p-2" value={values.provider} onChange={event => edit({ provider: event.target.value as Settings['provider'], signingSecret: undefined, clearSigningSecret: false })}><option value="none">{copy('none', 'No confirmed tracking')}</option><option value="generic">{copy('generic', 'Generic signed events')}</option><option value="ses">Amazon SES / SNS</option><option value="sendgrid">SendGrid</option><option value="mailgun">Mailgun</option></select></label>
 {['generic', 'mailgun'].includes(values.provider) && <>{field('signingSecret', copy('signingSecret', 'Webhook signing secret'), 'password')}<p className="text-sm text-muted-foreground">{copy('credentialHelp', 'Credentials are write-only. Leave blank to keep the stored value; use the clear control to remove it.')}</p>{values.hasSigningSecret && <label className="text-sm"><input type="checkbox" checked={Boolean(values.clearSigningSecret)} onChange={event => edit({ clearSigningSecret: event.target.checked })} /> {copy('clearSecret', 'Clear stored webhook signing secret')}</label>}</>}
 {values.provider === 'sendgrid' && field('sendgridPublicKey', copy('sendgridPublicKey', 'SendGrid verification public key'))}
 {values.provider === 'ses' && field('sesTopicArn', copy('sesTopicArn', 'SNS topic ARN'))}
 {values.provider !== 'none' && <><p className="text-sm text-muted-foreground">{copy(`help.${values.provider}`, values.provider === 'ses' ? 'Enable original headers in SES notifications and subscribe the exact SNS topic to this HTTPS callback.' : values.provider === 'sendgrid' ? 'Enable signed SendGrid Event Webhooks for delivered, deferred and bounce events.' : values.provider === 'mailgun' ? 'Configure delivered and failed Mailgun webhooks with the webhook signing key.' : 'Send normalized delivery events using the documented HMAC contract.')}</p>{values.callbackId && <label className="grid gap-1 text-sm">{copy('callback', 'Provider callback URL')}<Input readOnly value={`${window.location.origin}/api/mail-deliveries/providers/${values.callbackId}`} /></label>}<label className="text-sm"><input type="checkbox" checked={Boolean(values.rotateCallback)} onChange={event => edit({ rotateCallback: event.target.checked })} /> {copy('rotate', 'Rotate callback URL on save')}</label><p className="text-sm text-muted-foreground">{copy('rotateHelp', 'Rotation invalidates the old callback URL, including outstanding events. Update the provider after saving. Public callbacks require HTTPS.')}</p></>}
 <Button type="button" onClick={() => void save()}>{pending ? copy('saving', 'Saving…') : copy('save', 'Save email settings')}</Button>
 </fieldset>
 {message && <p role="status" className="text-sm">{message}</p>}{stale && <Button type="button" variant="outline" disabled={pending || query.isFetching} onClick={() => { const target = identity; void query.refetch().then(result => { if (currentIdentity.current === target && result.data) { setDraft({ ...result.data, smtpPassword: undefined, signingSecret: undefined }); setStale(false); setMessage(''); } }); }}>{copy('reload', 'Reload settings')}</Button>}
 </>}
 </CardContent></Card>;
}

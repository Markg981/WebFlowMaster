import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Copy, Loader2 } from 'lucide-react';

/**
 * Provisioning with SCIM 2.0 (server/scim.ts), part of the single sign-on card: the base URL to give
 * the identity provider, and its bearer token — issued here, shown once, revoked here.
 */

export interface ScimTokenStatus {
  prefix: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

async function send(method: string, url: string) {
  const response = await fetch(url, { method, credentials: 'include' });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? 'Something went wrong');
  return payload;
}

export function ScimProvisioning({ baseUrl, token, onChanged }: { baseUrl: string; token: ScimTokenStatus | null; onChanged: () => void }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);

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

  const issue = () =>
    run(async () => {
      const result = await send('POST', '/api/organization/sso/scim-token');
      setShown(result.token);
      onChanged();
    });

  const revoke = () =>
    run(async () => {
      await send('DELETE', '/api/organization/sso/scim-token');
      setShown('');
      setConfirmRevoke(false);
      onChanged();
    });

  const date = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="sso-scim">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">{t('sso.scim.title', 'Provisioning (SCIM)')}</p>
        {token && <Badge variant="secondary">{t('sso.scim.on', 'on')}</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          'sso.scim.description',
          'Your identity provider creates, deactivates and removes accounts here, and pushes its groups, as soon as they change there — not at the next sign-in. Give it the base URL and a token.',
        )}
      </p>
      <div className="space-y-1">
        <Label>{t('sso.scim.baseUrl', 'SCIM base URL (tenant URL)')}</Label>
        <div className="flex gap-2">
          <Input readOnly value={baseUrl} data-testid="sso-scim-base-url" className="font-mono text-xs" />
          <Button type="button" variant="outline" size="icon" aria-label={t('sso.copy', 'Copy')} onClick={() => navigator.clipboard?.writeText(baseUrl)}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {shown && (
        <div className="space-y-1" data-testid="sso-scim-token">
          <Label>{t('sso.scim.tokenShown', 'Token — copy it now, it is not shown again')}</Label>
          <div className="flex gap-2">
            <Input readOnly value={shown} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" aria-label={t('sso.copy', 'Copy')} onClick={() => navigator.clipboard?.writeText(shown)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {token ? (
        <p className="text-xs text-muted-foreground" data-testid="sso-scim-status">
          {t('sso.scim.status', 'Token {{prefix}}… issued {{created}}, last used {{used}}.', {
            prefix: token.prefix,
            created: date(token.createdAt),
            used: date(token.lastUsedAt),
          })}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t('sso.scim.none', 'No token: provisioning is off.')}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={issue} data-testid="sso-scim-issue">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {token ? t('sso.scim.replace', 'Replace the token') : t('sso.scim.issue', 'Issue a token')}
        </Button>
        {token && !confirmRevoke && (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRevoke(true)}>
            {t('sso.scim.revoke', 'Revoke')}
          </Button>
        )}
        {confirmRevoke && (
          <>
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={revoke}>
              {t('sso.scim.revokeConfirm', 'Revoke: the provider stops provisioning')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRevoke(false)}>
              {t('security.cancel', 'Cancel')}
            </Button>
          </>
        )}
      </div>
      {token && (
        <p className="text-xs text-muted-foreground">
          {t('sso.scim.replaceHint', 'Replacing the token ends the old one at once: paste the new one at the provider.')}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

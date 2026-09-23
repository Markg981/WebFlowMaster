import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2, ShieldCheck } from 'lucide-react';
import MfaSetup, { RecoveryCodes } from '@/components/security/MfaSetup';

/**
 * The member's second factor, and — for an owner — whether everyone must have one.
 */

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  required: boolean;
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

export default function SecurityCard({ isOwner = false }: { isOwner?: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'idle' | 'regenerate' | 'disable'>('idle');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: status, isLoading } = useQuery<MfaStatus>({
    queryKey: ['mfa'],
    queryFn: async () => {
      const response = await fetch('/api/mfa', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load the security settings');
      return response.json();
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['mfa'] });
    queryClient.invalidateQueries({ queryKey: ['/api/user'] });
  };

  const reset = () => {
    setMode('idle');
    setCode('');
    setPassword('');
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

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    run(async () => {
      if (mode === 'regenerate') {
        const result = await send('POST', '/api/mfa/recovery-codes', { code: code.trim() });
        setFreshCodes(result.recoveryCodes);
      } else {
        await send('DELETE', '/api/mfa', { password, code: code.trim() });
      }
      reset();
      refresh();
    });
  };

  const setPolicy = (required: boolean) =>
    run(async () => {
      await send('PUT', '/api/organization/mfa-policy', { required });
      refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span>{t('security.mfa.title', 'Two-factor authentication')}</span>
          {status?.enabled && <Badge variant="secondary">{t('security.mfa.on', 'on')}</Badge>}
        </CardTitle>
        <CardDescription>
          {t(
            'security.mfa.description',
            'A code from an app on your phone, asked for after your password. A stolen password alone then gets nobody in.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !status ? (
          <p className="text-sm text-muted-foreground">{t('security.loading', 'Loading…')}</p>
        ) : freshCodes ? (
          <RecoveryCodes codes={freshCodes} onDone={() => setFreshCodes(null)} />
        ) : !status.enabled ? (
          <MfaSetup onEnabled={refresh} />
        ) : (
          <>
            <p className="text-sm" data-testid="mfa-status">
              {t('security.mfa.enabledSince', 'On since {{date}}.', { date: new Date(status.enabledAt!).toLocaleDateString() })}{' '}
              {t('security.mfa.codesLeft', '{{count}} recovery codes left.', { count: status.recoveryCodesLeft })}
            </p>
            {mode === 'idle' ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setMode('regenerate')}>
                  {t('security.mfa.regenerate', 'New recovery codes')}
                </Button>
                {!status.required && (
                  <Button variant="outline" size="sm" onClick={() => setMode('disable')}>
                    {t('security.mfa.disable', 'Turn off')}
                  </Button>
                )}
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3 max-w-sm">
                {mode === 'disable' && (
                  <div className="space-y-1">
                    <Label htmlFor="mfa-password">{t('security.mfa.password', 'Password')}</Label>
                    <Input id="mfa-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="mfa-code">{t('security.mfa.codeOrRecovery', 'Code from the app, or a recovery code')}</Label>
                  <Input id="mfa-code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" variant={mode === 'disable' ? 'destructive' : 'default'} disabled={busy || code.trim().length < 6 || (mode === 'disable' && !password)}>
                    {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {mode === 'disable' ? t('security.mfa.disableConfirm', 'Turn off') : t('security.mfa.regenerateConfirm', 'Replace the codes')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={reset}>
                    {t('security.cancel', 'Cancel')}
                  </Button>
                </div>
              </form>
            )}
            {status.required && (
              <p className="text-xs text-muted-foreground">
                {t('security.mfa.requiredNote', 'Your organization requires it, so it cannot be turned off.')}
              </p>
            )}
          </>
        )}

        {isOwner && status && (
          <div className="flex items-start justify-between gap-4 border-t pt-4">
            <div>
              <Label htmlFor="mfa-policy" className="text-sm font-medium">
                {t('security.policy.label', 'Require it of every member')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {status.enabled
                  ? t('security.policy.hint', 'Members without it are asked to set it up before they can do anything else. API keys are not affected.')
                  : t('security.policy.needsOwn', 'Turn it on for yourself first.')}
              </p>
            </div>
            <Switch
              id="mfa-policy"
              checked={status.required}
              disabled={busy || (!status.enabled && !status.required)}
              onCheckedChange={setPolicy}
            />
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

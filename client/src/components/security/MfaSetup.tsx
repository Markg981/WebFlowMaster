import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Copy, Download, Loader2 } from 'lucide-react';

/**
 * Turning on the second factor: scan, prove it works, keep the recovery codes.
 *
 * Three steps, and the middle one is not optional. A secret that was shown but never confirmed
 * is how people lock themselves out — the QR scanned into the wrong account, a phone with the
 * wrong time — so nothing is switched on until a code from the new secret comes back.
 */

interface Enrollment {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? 'Something went wrong');
  return payload as T;
}

/** The recovery codes, shown once, with ways to keep them. Also used after regenerating. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const text = codes.join('\n');
  return (
    <Alert>
      <AlertTitle>{t('security.recoveryCodes.title', 'Save your recovery codes')}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="text-xs">
          {t(
            'security.recoveryCodes.body',
            'Each one signs you in once if you lose your phone. This is the only time they are shown.',
          )}
        </p>
        <ul className="grid grid-cols-2 gap-1 font-mono text-sm" data-testid="recovery-codes">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(text)}>
            <Copy className="h-4 w-4 mr-1" />
            {t('security.recoveryCodes.copy', 'Copy')}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(text + '\n')}`} download="recovery-codes.txt">
              <Download className="h-4 w-4 mr-1" />
              {t('security.recoveryCodes.download', 'Download')}
            </a>
          </Button>
          <Button size="sm" onClick={onDone}>
            {t('security.recoveryCodes.done', 'I have saved them')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export default function MfaSetup({ onEnabled }: { onEnabled: () => void }) {
  const { t } = useTranslation();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      setEnrollment(await postJson<Enrollment>('/api/mfa/enrollment'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await postJson<{ recoveryCodes: string[] }>('/api/mfa/enrollment/confirm', { code: code.trim() });
      setRecoveryCodes(result.recoveryCodes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (recoveryCodes) return <RecoveryCodes codes={recoveryCodes} onDone={onEnabled} />;

  if (!enrollment) {
    return (
      <div className="space-y-2">
        <Button onClick={start} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {t('security.mfa.start', 'Set up two-factor authentication')}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="space-y-4">
      <p className="text-sm">
        {t(
          'security.mfa.scan',
          'Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the code it shows.',
        )}
      </p>
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
        <img src={enrollment.qrDataUrl} alt={t('security.mfa.qrAlt', 'QR code for your authenticator app')} className="h-44 w-44 rounded border bg-white p-1" />
        <div className="text-xs space-y-1">
          <p className="text-muted-foreground">{t('security.mfa.manual', 'Or type this key in by hand:')}</p>
          <code className="block break-all bg-muted px-2 py-1 rounded" data-testid="mfa-secret">
            {enrollment.secret.replace(/(.{4})/g, '$1 ').trim()}
          </code>
        </div>
      </div>
      <div className="space-y-1 max-w-xs">
        <Label htmlFor="mfa-confirm-code">{t('security.mfa.codeLabel', 'Code from the app')}</Label>
        <Input
          id="mfa-confirm-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy || code.trim().length < 6}>
        {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {t('security.mfa.confirm', 'Turn on')}
      </Button>
    </form>
  );
}

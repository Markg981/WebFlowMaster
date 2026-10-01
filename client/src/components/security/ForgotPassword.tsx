import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * "Forgot your password?" on the sign-in page: a reset link mailed to the address one signs in
 * with (server/auth.ts, POST /api/password-reset/request). Offered only where the installation
 * sends e-mail; the answer is the same whether or not the account exists.
 */
export default function ForgotPassword({ username }: { username: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(username);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { data } = useQuery<{ available: boolean }>({
    queryKey: ['/api/password-reset/available'],
    queryFn: async () => {
      const res = await fetch('/api/password-reset/available');
      if (!res.ok) return { available: false };
      return res.json();
    },
    staleTime: 60_000,
  });
  if (!data?.available) return null;

  if (!open) {
    return (
      <button type="button" className="text-sm text-primary hover:underline" onClick={() => setOpen(true)}>
        {t('authPage.forgot.link', 'Forgot your password?')}
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: address.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `Request failed (${res.status})`);
      setAnswer(t('authPage.forgot.sent', 'If an account with that address exists, a link to choose a new password is on its way. Check your mailbox.'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return answer ? (
    <p className="text-sm text-muted-foreground" data-testid="forgot-sent">
      {answer}
    </p>
  ) : (
    <form onSubmit={submit} className="space-y-2" data-testid="forgot-form">
      <Label htmlFor="forgot-address">{t('authPage.forgot.label', 'The address you sign in with')}</Label>
      <div className="flex gap-2">
        <Input id="forgot-address" type="email" value={address} onChange={(e) => setAddress(e.target.value)} required />
        <Button type="submit" variant="outline" disabled={pending || !address.trim()}>
          {t('authPage.forgot.submit', 'Send me a link')}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

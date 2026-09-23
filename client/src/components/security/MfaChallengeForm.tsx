import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

/**
 * The second step of signing in: the password was right, now the code.
 *
 * One field for both kinds of code — six digits from the app, or a recovery code — because the
 * server tells them apart and a person with a lost phone should not have to find a second form.
 */
export default function MfaChallengeForm() {
  const { t } = useTranslation();
  const { verifyMfaMutation, cancelMfaChallenge } = useAuth();
  const [code, setCode] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    verifyMfaMutation.mutate(code.trim(), { onError: () => setCode('') });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="mfa-login-code" className="text-sm font-semibold">
          {t('security.challenge.label', 'Code from your authenticator app')}
        </Label>
        <Input
          id="mfa-login-code"
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
        />
        <p className="text-xs text-muted-foreground">
          {t('security.challenge.hint', 'Lost your phone? Enter one of your recovery codes instead.')}
        </p>
      </div>
      {verifyMfaMutation.error && (
        <Alert variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{verifyMfaMutation.error.message}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full h-11 text-base font-bold" disabled={verifyMfaMutation.isPending || code.trim().length < 6}>
        {verifyMfaMutation.isPending ? t('security.challenge.verifying', 'Checking…') : t('security.challenge.submit', 'Verify')}
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={cancelMfaChallenge}>
        {t('security.challenge.back', 'Back to sign in')}
      </Button>
    </form>
  );
}

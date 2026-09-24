import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

/**
 * The signed-in person's account: who they are, and changing their password.
 *
 * Nobody could change a password before. The current one is asked again, and the new one ends
 * every other session of this person (server/auth.ts), which the card says, so someone who changes
 * it because it leaked knows the leak is closed.
 */
const ChangePasswordCard: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const change = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/user/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Could not change the password');
      return body;
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage({
        kind: 'ok',
        text: t('settings.account.passwordChanged', 'Password changed. Any other session you had open has been signed out.'),
      });
    },
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  });

  const tooShort = newPassword.length > 0 && newPassword.length < 8;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit = currentPassword !== '' && newPassword.length >= 8 && newPassword === confirmPassword && !change.isPending;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (canSubmit) change.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <span>{t('settings.account.title', 'Account')}</span>
        </CardTitle>
        <CardDescription>
          {t('settings.account.signedInAs', 'Signed in as {{username}}. Usernames cannot be changed.', { username: user?.username ?? '' })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">{t('settings.account.currentPassword', 'Current password')}</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">{t('settings.account.newPassword', 'New password')}</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            {tooShort && (
              <p className="text-sm text-destructive">{t('settings.account.tooShort', 'At least 8 characters.')}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmNewPassword">{t('settings.account.confirmPassword', 'Repeat the new password')}</Label>
            <Input
              id="confirmNewPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {mismatch && (
              <p className="text-sm text-destructive">{t('settings.account.mismatch', 'The two new passwords are different.')}</p>
            )}
          </div>
          {message && (
            <p className={`text-sm ${message.kind === 'ok' ? 'text-muted-foreground' : 'text-destructive'}`} role="status">
              {message.text}
            </p>
          )}
          <Button type="submit" disabled={!canSubmit}>
            {change.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('settings.account.changePassword', 'Change password')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default ChangePasswordCard;

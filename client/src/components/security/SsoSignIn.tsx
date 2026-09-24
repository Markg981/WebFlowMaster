import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, KeyRound } from 'lucide-react';

/**
 * "Sign in with SSO" (server/sso.ts): the e-mail address picks the organization, and the browser
 * goes to its identity provider. A navigation, not a fetch — it ends on the provider's page, and
 * comes back to /api/sso/callback, or here with ?sso_error= when something was refused.
 */

export const SSO_ERRORS = [
  'unknown_domain',
  'provider_unreachable',
  'expired',
  'provider_error',
  'no_email',
  'email_unverified',
  'domain_not_allowed',
  'account_elsewhere',
  'account_disabled',
  'account_linked',
] as const;

export function ssoErrorFromUrl(): string {
  return new URLSearchParams(window.location.search).get('sso_error') ?? '';
}

export default function SsoSignIn({ open: openAtStart = false }: { open?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(openAtStart);
  const [email, setEmail] = useState('');
  const [error] = useState(ssoErrorFromUrl);

  const { data } = useQuery<{ available: boolean }>({
    queryKey: ['/api/sso/available'],
    queryFn: async () => {
      const response = await fetch('/api/sso/available');
      if (!response.ok) return { available: false };
      return response.json();
    },
    staleTime: 60_000,
  });

  const messages: Record<(typeof SSO_ERRORS)[number], string> = {
    unknown_domain: t('sso.errors.unknown_domain', 'No organization here signs in that address with single sign-on. Check it, or sign in with your password.'),
    provider_unreachable: t('sso.errors.provider_unreachable', "Your organization's identity provider could not be reached. Try again, or ask an owner to check the single sign-on settings."),
    expired: t('sso.errors.expired', 'The sign-in took too long, or was started in another window. Try again.'),
    provider_error: t('sso.errors.provider_error', 'Your identity provider did not complete the sign-in. Try again; if it keeps happening, an owner will find the reason in the server log.'),
    no_email: t('sso.errors.no_email', 'Your identity provider did not send your e-mail address. An owner has to add the email claim to the application there.'),
    email_unverified: t('sso.errors.email_unverified', 'Your identity provider says your e-mail address is not verified.'),
    domain_not_allowed: t('sso.errors.domain_not_allowed', 'Your e-mail address is not in a domain your organization signs in.'),
    account_elsewhere: t('sso.errors.account_elsewhere', 'An account with your address belongs to another organization on this installation.'),
    account_disabled: t('sso.errors.account_disabled', 'This account is disabled.'),
    account_linked: t('sso.errors.account_linked', 'Your address is already linked to another identity at your provider. Ask an owner of your organization.'),
  };
  const errorMessage = error ? (messages as Record<string, string>)[error] ?? messages.provider_error : '';

  const start = (event: React.FormEvent) => {
    event.preventDefault();
    window.location.assign(`/api/sso/start?email=${encodeURIComponent(email.trim())}`);
  };

  if (!data?.available && !errorMessage) return null;

  return (
    <div className="space-y-3" data-testid="sso-sign-in">
      {errorMessage && (
        <Alert variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20" data-testid="sso-sign-in-error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
      {data?.available && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            {t('sso.or', 'or')}
            <div className="h-px flex-1 bg-border" />
          </div>
          {!open ? (
            <Button type="button" variant="outline" className="w-full h-11" onClick={() => setOpen(true)}>
              <KeyRound className="h-4 w-4 mr-2" />
              {t('sso.signIn', 'Sign in with SSO')}
            </Button>
          ) : (
            <form onSubmit={start} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="sso-email">{t('sso.email', 'Work e-mail address')}</Label>
                <Input
                  id="sso-email"
                  type="email"
                  autoComplete="email"
                  className="bg-muted/30"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" variant="outline" className="w-full h-11" disabled={!email.includes('@')}>
                <KeyRound className="h-4 w-4 mr-2" />
                {t('sso.continue', 'Continue to your identity provider')}
              </Button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

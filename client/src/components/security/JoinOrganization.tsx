import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import { Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiRequest, errorMessage, queryClient } from '@/lib/queryClient';
import type { SessionUser } from '@/hooks/use-auth';

/**
 * A signed-in person opening an invitation link (server/tenancy/organization-memberships.ts): the
 * invitation adds its organization to the ones their account belongs to, rather than creating an
 * account. They see whose invitation it is and as what before accepting, and land in the new
 * organization afterwards; every cached query is of the one just left, so the cache is cleared.
 */
export default function JoinOrganization({ token }: { token: string }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  const preview = useQuery<{ organizationName: string; role: string; username: string }>({
    queryKey: ['/api/invitations/preview', token],
    queryFn: async () => {
      const response = await fetch(`/api/invitations/preview?token=${encodeURIComponent(token)}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('invalid');
      return response.json();
    },
    retry: false,
  });

  const leave = () => {
    window.history.replaceState(null, '', window.location.pathname);
    navigate('/dashboard');
  };

  const join = async () => {
    setJoining(true);
    setError('');
    try {
      const res = await apiRequest('POST', '/api/invitations/accept', { token });
      const joined = (await res.json()) as SessionUser;
      queryClient.clear();
      queryClient.setQueryData(['/api/user'], joined);
      leave();
    } catch (joinError) {
      setError(errorMessage(joinError as Error));
      setJoining(false);
    }
  };

  const role = preview.data
    ? t(`settings.members.roles.${preview.data.role}`, preview.data.role)
    : '';

  return (
    <div className="space-y-4" data-testid="join-organization">
      {preview.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('joinOrganization.loading', 'Reading the invitation…')}
        </p>
      ) : preview.data ? (
        <>
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="space-y-1">
              <p className="font-semibold">
                {t('joinOrganization.title', 'Join {{organization}}', {
                  organization: preview.data.organizationName,
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t(
                  'joinOrganization.description',
                  'You were invited to join {{organization}} as {{role}}. Your account keeps its other organizations; you can switch between them from the header.',
                  { organization: preview.data.organizationName, role },
                )}
              </p>
            </div>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button onClick={() => void join()} disabled={joining} data-testid="join-confirm">
              {joining && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('joinOrganization.join', 'Join as {{role}}', { role })}
            </Button>
            <Button variant="outline" onClick={leave} disabled={joining}>
              {t('joinOrganization.cancel', 'Not now')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Alert variant="destructive">
            <AlertDescription>
              {t(
                'joinOrganization.invalid',
                'This invitation is not valid for your account: it may have expired, been used, or be meant for another username.',
              )}
            </AlertDescription>
          </Alert>
          <Button variant="outline" onClick={leave}>
            {t('joinOrganization.back', 'Back to the app')}
          </Button>
        </>
      )}
    </div>
  );
}

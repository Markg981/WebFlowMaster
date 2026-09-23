import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import MfaSetup from './MfaSetup';

/**
 * Shown instead of the application to a member whose organization requires a second factor they
 * do not have yet. Every other request would be refused anyway (mfa_enrollment_required), so
 * this is the honest screen: set it up, or sign out.
 */
export default function MfaEnrollmentRequired() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { logoutMutation } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            {t('security.required.title', 'Set up two-factor authentication')}
          </CardTitle>
          <CardDescription>
            {t(
              'security.required.body',
              'Your organization requires a code from an authenticator app at every sign-in. Set it up to continue.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <MfaSetup onEnabled={() => queryClient.invalidateQueries({ queryKey: ['/api/user'] })} />
          <Button variant="ghost" size="sm" onClick={() => logoutMutation.mutate()}>
            {t('security.required.signOut', 'Sign out')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

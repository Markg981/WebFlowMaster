import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatDateTime } from '@/lib/dates';

/** The member's own signed-in sessions, with the means to end them (audit R-5). */

interface SessionSummary {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string;
  ip: string;
}

const QUERY_KEY = ['mySessions'];

export default function SessionsCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<SessionSummary | 'others' | null>(null);

  const { data = [], isError } = useQuery<SessionSummary[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const response = await fetch('/api/me/sessions', { credentials: 'include' });
      if (!response.ok) throw new Error('load');
      return response.json();
    },
  });

  const revoke = useMutation({
    mutationFn: async (target: SessionSummary | 'others') => {
      const url = target === 'others' ? '/api/me/sessions' : `/api/me/sessions/${target.id}`;
      const response = await fetch(url, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error('revoke');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onSettled: () => setRevoking(null),
  });

  const others = data.filter((s) => !s.current);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.sessions.title', 'Signed-in sessions')}</CardTitle>
        <CardDescription>
          {t(
            'settings.sessions.description',
            'Browsers and devices signed in to your account. End any you do not recognise.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('settings.sessions.loadFailed', 'Could not load the sessions.')}
          </p>
        )}
        <ul className="space-y-2">
          {data.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {s.userAgent || t('settings.sessions.device', 'Device')}
                  {s.current && (
                    <Badge className="ml-2">{t('settings.sessions.current', 'This session')}</Badge>
                  )}
                </div>
                <div className="text-muted-foreground">
                  {t('settings.sessions.created', 'Started')} {formatDateTime(s.createdAt)} ·{' '}
                  {t('settings.sessions.lastSeen', 'Last active')} {formatDateTime(s.lastSeenAt)}
                  {s.ip ? ` · ${s.ip}` : ''}
                </div>
              </div>
              {!s.current && (
                <Button variant="outline" size="sm" onClick={() => setRevoking(s)}>
                  {t('settings.sessions.revoke', 'End session')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {others.length > 0 ? (
          <Button variant="destructive" size="sm" onClick={() => setRevoking('others')}>
            {t('settings.sessions.revokeOthers', 'End all other sessions')}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('settings.sessions.none', 'No other sessions.')}
          </p>
        )}
      </CardContent>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={
          revoking === 'others'
            ? t('settings.sessions.revokeOthersTitle', 'End all other sessions?')
            : t('settings.sessions.revokeTitle', 'End this session?')
        }
        description={
          revoking === 'others'
            ? t(
                'settings.sessions.revokeOthersDescription',
                'Every other browser and device is signed out at once. This one stays signed in.',
              )
            : t(
                'settings.sessions.revokeDescription',
                'The browser or device is signed out at once.',
              )
        }
        confirmLabel={t('common.revoke', 'Revoke')}
        destructive
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </Card>
  );
}

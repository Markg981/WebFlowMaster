import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface DeliveryHistory {
  configured: boolean;
  trackingConfigured: boolean;
  deliveries: Array<{ id: string; recipient: string; purpose: string; state: string; createdAt: string }>;
}

/** Owner-only history: SMTP acceptance is not proof that the recipient received a message. */
export default function EmailDeliveryCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, isLoading, isError, refetch, isFetching } = useQuery<DeliveryHistory>({
    queryKey: ['mail-deliveries', user?.organizationId, user?.id],
    queryFn: async () => (await apiRequest('GET', '/api/mail-deliveries?limit=100')).json(),
  });
  const states: Record<string, string> = {
    queued: t('emailDelivery.states.queued', 'Preparing'),
    accepted: t('emailDelivery.states.accepted', 'Accepted by SMTP'),
    delivered: t('emailDelivery.states.delivered', 'Delivered'),
    soft_bounce: t('emailDelivery.states.soft_bounce', 'Temporary bounce'),
    hard_bounce: t('emailDelivery.states.hard_bounce', 'Hard bounce'),
    rejected: t('emailDelivery.states.rejected', 'Rejected by SMTP'),
    failed: t('emailDelivery.states.failed', 'Send failed'),
    suppressed: t('emailDelivery.states.suppressed', 'Suppressed after hard bounce'),
  };
  const purposes: Record<string, string> = {
    invitation: t('emailDelivery.purposes.invitation', 'Invitation'),
    password_reset: t('emailDelivery.purposes.password_reset', 'Password reset'),
    run_finished: t('emailDelivery.purposes.run_finished', 'Run notification'),
    other: t('emailDelivery.purposes.other', 'Email'),
  };
  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" />{t('emailDelivery.title', 'Email delivery')}</CardTitle>
      <CardDescription>{t('emailDelivery.description', 'Invitations, password resets and run notifications include HTML and plain text. SMTP acceptance does not confirm delivery.')}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {isLoading ? <p>{t('emailDelivery.loading', 'Loading…')}</p> : isError || !data ?
        <p role="alert" className="text-sm text-destructive">{t('emailDelivery.error', 'Email delivery history could not be loaded.')}</p> : <>
          {!data.configured && <p className="text-sm text-muted-foreground">{t('emailDelivery.notConfigured', 'Email sending is not configured on this installation.')}</p>}
          {!data.trackingConfigured && <p className="text-sm text-muted-foreground">{t('emailDelivery.noTracking', 'Delivery and bounce tracking is not configured.')}</p>}
          <Button type="button" size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>{t('emailDelivery.refresh', 'Refresh')}</Button>
          {data.deliveries.length === 0 ? <p className="text-sm text-muted-foreground">{t('emailDelivery.empty', 'No messages recorded yet.')}</p> : <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('emailDelivery.history', 'Latest 100 messages for this organization')}</caption>
              <thead><tr className="border-b text-left">
                <th className="p-2">{t('emailDelivery.recipient', 'Recipient')}</th><th className="p-2">{t('emailDelivery.purpose', 'Message')}</th>
                <th className="p-2">{t('emailDelivery.state', 'Status')}</th><th className="p-2">{t('emailDelivery.created', 'Sent at')}</th>
              </tr></thead>
              <tbody>{data.deliveries.map(delivery => <tr key={delivery.id} className="border-b">
                <td className="p-2 break-all">{delivery.recipient}</td><td className="p-2">{purposes[delivery.purpose] ?? purposes.other}</td>
                <td className="p-2">{states[delivery.state] ?? delivery.state}</td><td className="p-2 whitespace-nowrap">{new Date(delivery.createdAt).toLocaleString()}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </>}
    </CardContent>
  </Card>;
}

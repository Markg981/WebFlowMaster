import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageSquareText } from 'lucide-react';

/**
 * The organization's test SMS inbox (server/sms-inbox.ts): the address an SMS provider posts the
 * test numbers' messages to, issued by an owner and shown once, and what arrived lately.
 */

interface Inbox {
  prefix: string | null;
  createdAt: string | null;
  inboundUrl: string | null;
  messages: Array<{ id: number; toNumber: string; fromNumber: string | null; body: string; provider: string | null; receivedAt: string }>;
}

async function call(method: string, url: string) {
  const response = await fetch(url, { method, credentials: 'include' });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

export default function SmsInboxCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const { data } = useQuery<Inbox>({ queryKey: ['/api/organization/sms-inbox'], queryFn: () => call('GET', '/api/organization/sms-inbox') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['/api/organization/sms-inbox'] });
  const issue = useMutation({
    mutationFn: () => call('POST', '/api/organization/sms-inbox/token'),
    onSuccess: (result: { inboundUrl: string }) => { setIssuedUrl(result.inboundUrl); setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const revoke = useMutation({
    mutationFn: () => call('DELETE', '/api/organization/sms-inbox/token'),
    onSuccess: () => { setIssuedUrl(null); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Card data-testid="sms-inbox">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" /> {t('smsInbox.title', 'SMS inbox')}</CardTitle>
        <CardDescription>
          {t('smsInbox.description', 'Codes sent by text message, for Wait for SMS steps. Set the inbound address below as the incoming-message webhook of your test numbers at Twilio, Vonage or any provider that posts To and Body (or to and text). Messages are kept seven days.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {issuedUrl ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('smsInbox.copyNow', 'Inbound address — copy it now, it will not be shown again')}</p>
            <Input readOnly value={issuedUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} data-testid="sms-inbound-url" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data?.prefix
              ? t('smsInbox.active', 'Inbound address active ({{prefix}}…), issued {{date}}.', { prefix: data.prefix, date: data.createdAt ? new Date(data.createdAt).toLocaleString() : '' })
              : t('smsInbox.none', 'No inbound address: no message can arrive.')}
          </p>
        )}
        {isOwner && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => issue.mutate()} disabled={issue.isPending}>
              {data?.prefix ? t('smsInbox.replace', 'Replace the address') : t('smsInbox.issue', 'Create an inbound address')}
            </Button>
            {data?.prefix && <Button variant="ghost" onClick={() => revoke.mutate()} disabled={revoke.isPending}>{t('smsInbox.revoke', 'Revoke')}</Button>}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div>
          <p className="mb-1 text-sm font-medium">{t('smsInbox.recent', 'Latest messages')}</p>
          {data?.messages.length ? (
            <ul className="divide-y rounded-md border text-xs" data-testid="sms-messages">
              {data.messages.map((m) => (
                <li key={m.id} className="space-y-0.5 px-3 py-2">
                  <p className="text-muted-foreground">{new Date(m.receivedAt).toLocaleString()} · {m.fromNumber ?? '?'} → {m.toNumber}{m.provider ? ` · ${m.provider}` : ''}</p>
                  <p className="wrap-break-word">{m.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{t('smsInbox.noMessages', 'Nothing has arrived yet.')}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

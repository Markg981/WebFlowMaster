import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Send } from 'lucide-react';

/** What this run owed outside (notifications) and how it went: sent, retrying or failed with the reason. */

export interface DeliveryRow {
  id: string;
  kind: string;
  target: string;
  status: 'queued' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
}

export default function DeliveriesCard({ executionId }: { executionId: string }) {
  const { t } = useTranslation();
  const { data: rows = [] } = useQuery<DeliveryRow[]>({
    queryKey: ['deliveries', executionId],
    queryFn: async () => {
      const response = await fetch(`/api/test-plan-executions/${executionId}/deliveries`);
      const body = response.ok ? await response.json() : [];
      return Array.isArray(body) ? body : [];
    },
  });
  if (rows.length === 0) return null;

  return (
    <Card data-testid="deliveries-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          {t('deliveries.title', 'Deliveries')}
        </CardTitle>
        <CardDescription>
          {t(
            'deliveries.description',
            'Notifications this run owed, with their state. Failed ones are retried for up to 5 attempts over about an hour.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={row.status === 'failed' ? 'destructive' : 'secondary'}>
              {t(`deliveries.${row.status}`, row.status)}
            </Badge>
            <span>{t(`deliveries.${row.kind}`, row.kind)}</span>
            <span className="text-muted-foreground">{row.target}</span>
            <span className="text-muted-foreground">
              {t('deliveries.attempts', '{{count}} attempt(s)', { count: row.attempts })}
            </span>
            {row.lastError && <span className="text-destructive">{row.lastError}</span>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

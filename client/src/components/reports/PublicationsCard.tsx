import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClipboardList, ExternalLink, Loader2, Upload } from 'lucide-react';
import { isExecutionInFlight } from '@shared/execution-status';

/**
 * Where this run went in TestRail, Xray or Zephyr Scale, and a way to send it again: after the
 * manual verdicts, to a tool that was down, or to another connection than the plan's.
 *
 * Not shown for an organization with no connection and a run published nowhere.
 */

export interface PublicationRow {
  id: number;
  connectionName: string;
  provider: string;
  status: 'published' | 'failed' | 'nothing_to_publish';
  externalKey: string | null;
  externalUrl: string | null;
  publishedCount: number;
  unmappedCount: number;
  message: string | null;
  createdAt: string;
}

interface ConnectionOption {
  id: string;
  name: string;
}

/** The plan's own connection, since a Select item cannot have an empty value. */
const PLAN_CONNECTION = '__plan__';

export default function PublicationsCard({ executionId, runStatus }: { executionId: string; runStatus: string }) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(PLAN_CONNECTION);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: publications = [], refetch } = useQuery<PublicationRow[]>({
    queryKey: ['publications', executionId],
    queryFn: async () => {
      const response = await fetch(`/api/test-plan-executions/${executionId}/publications`);
      const rows = response.ok ? await response.json() : [];
      return Array.isArray(rows) ? rows : [];
    },
  });
  const { data: connections = [] } = useQuery<ConnectionOption[]>({
    queryKey: ['testManagement'],
    queryFn: async () => {
      const response = await fetch('/api/test-management');
      const rows = response.ok ? await response.json() : [];
      return Array.isArray(rows) ? rows : [];
    },
  });

  if (publications.length === 0 && connections.length === 0) return null;
  const ended = !isExecutionInFlight(runStatus);

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const response = await fetch(`/api/test-plan-executions/${executionId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: target === PLAN_CONNECTION ? null : target }),
      });
      const body = await response.json().catch(() => ({}));
      // A 502 is a publication that was recorded as failed: the list shows why.
      if (!response.ok && response.status !== 502) setError(body.error || t('publications.failed', 'The run was not published.'));
      await refetch();
    } finally {
      setPublishing(false);
    }
  };

  const statusLabel = (row: PublicationRow) =>
    row.status === 'published'
      ? t('publications.status.published', 'Published')
      : row.status === 'failed'
        ? t('publications.status.failed', 'Failed')
        : t('publications.status.nothing', 'Nothing to publish');

  return (
    <Card data-testid="publications-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          {t('publications.title', 'Test management')}
        </CardTitle>
        <CardDescription>
          {t('publications.description', 'Where this run was published, case by case. Publishing again makes a new run in the tool, with the verdicts as they are now.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {publications.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('publications.none', 'Not published yet.')}</p>
        ) : (
          <ul className="space-y-2">
            {publications.map((row) => (
              <li key={row.id} className="text-sm border rounded-md p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={row.status === 'published' ? 'default' : row.status === 'failed' ? 'destructive' : 'secondary'}>{statusLabel(row)}</Badge>
                  <span className="font-medium">{row.connectionName}</span>
                  {row.externalKey &&
                    (row.externalUrl ? (
                      <a href={row.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                        {row.externalKey}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="font-mono">{row.externalKey}</span>
                    ))}
                  <span className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</span>
                </div>
                {row.status === 'published' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('publications.counts', '{{published}} case(s) published, {{unmapped}} test(s) with no case left out.', { published: row.publishedCount, unmapped: row.unmappedCount })}
                  </p>
                )}
                {row.message && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap wrap-break-word">{row.message}</p>}
              </li>
            ))}
          </ul>
        )}
        {ended && connections.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="w-64" aria-label={t('publications.target', 'Publish to')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PLAN_CONNECTION}>{t('publications.planConnection', 'The plan’s connection')}</SelectItem>
                {connections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {connection.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={publish} disabled={publishing} size="sm">
              {publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {publications.length ? t('publications.again', 'Publish again') : t('publications.publish', 'Publish')}
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}

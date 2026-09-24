import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Network } from 'lucide-react';
import type { NetworkRequestSummary, NetworkSummary } from '@shared/network';

/**
 * What the test's page asked the network for: the requests that failed, then the slowest.
 *
 * Read out of the HAR the run recorded, so it is here whether or not the file itself was kept.
 * The file, when kept, is offered for DevTools; everything a first look needs is on this panel.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RequestRow({ request }: { request: NetworkRequestSummary }) {
  const failed = request.status === 0 || request.status >= 400;
  return (
    <li className="flex items-start gap-2 text-xs">
      <Badge variant={failed ? 'destructive' : 'outline'} className="whitespace-nowrap font-mono">
        {request.status === 0 ? '—' : request.status}
      </Badge>
      <span className="font-mono shrink-0">{request.method}</span>
      <span className="font-mono break-all flex-1" title={request.url}>
        {request.url}
      </span>
      <span className="text-muted-foreground whitespace-nowrap">
        {request.timeMs} ms
        {request.status === 0 && request.statusText ? ` · ${request.statusText}` : ''}
      </span>
    </li>
  );
}

export default function NetworkPanel({ summary, harUrl }: { summary: NetworkSummary; harUrl?: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border p-3 dark:border-slate-700" data-testid="network-panel">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Network className="h-4 w-4" />
        <span className="text-sm font-medium">{t('network.title', 'Network')}</span>
        <span className="text-xs text-muted-foreground">
          {t('network.summary', '{{requests}} requests, {{failed}} failed, {{bytes}} received', {
            requests: summary.requests,
            failed: summary.failed,
            bytes: formatBytes(summary.transferredBytes),
          })}
        </span>
        {harUrl && (
          <a href={harUrl} download className="text-xs underline ml-auto">
            {t('network.download', 'Download the HAR (opens in any browser’s DevTools)')}
          </a>
        )}
      </div>

      {summary.failures.length > 0 && (
        <section className="mb-3">
          <h4 className="text-xs font-medium text-destructive mb-1">{t('network.failed', 'Failed requests')}</h4>
          <ul className="space-y-1" data-testid="network-failures">
            {summary.failures.map((request, index) => (
              <RequestRow key={`f-${index}`} request={request} />
            ))}
          </ul>
          {summary.failed > summary.failures.length && (
            <p className="text-xs text-muted-foreground mt-1">
              {t('network.more', 'and {{count}} more in the HAR', { count: summary.failed - summary.failures.length })}
            </p>
          )}
        </section>
      )}

      {summary.slowest.length > 0 && (
        <section>
          <h4 className="text-xs font-medium mb-1">{t('network.slowest', 'Slowest requests')}</h4>
          <ul className="space-y-1" data-testid="network-slowest">
            {summary.slowest.map((request, index) => (
              <RequestRow key={`s-${index}`} request={request} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

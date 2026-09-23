import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download } from 'lucide-react';

/**
 * Who changed what, when, and from where.
 *
 * The trail has been written for a while — members, invitations, keys — but only an API call
 * could read it, which in practice meant nobody did. Now that it covers the organization's
 * tests, plans, schedules, environments and sign-ins, this is where an owner answers "who
 * deleted the nightly schedule?" without asking around. Owners only; the server enforces it.
 */

export interface AuditEntry {
  id: number;
  action: string;
  actorUserId: number | null;
  actorUsername: string | null;
  apiKeyId: string | null;
  ipAddress: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditPage {
  entries: AuditEntry[];
  limit: number;
  offset: number;
  hasMore: boolean;
  categories: string[];
}

const PAGE_SIZE = 25;
const ALL = 'all';

/** The one line a reader needs from an entry's metadata, in the order they usually look. */
export function describeEntry(metadata: Record<string, unknown> | null): string {
  if (!metadata) return '';
  const parts: string[] = [];
  const name = metadata.name ?? metadata.keyName ?? metadata.username ?? metadata.key;
  if (typeof name === 'string') parts.push(name);
  if (Array.isArray(metadata.fields) && metadata.fields.length > 0) parts.push(`(${metadata.fields.join(', ')})`);
  if (typeof metadata.isActive === 'boolean') parts.push(metadata.isActive ? '→ on' : '→ off');
  if (typeof metadata.from === 'string' && typeof metadata.to === 'string') parts.push(`${metadata.from} → ${metadata.to}`);
  if (typeof metadata.reason === 'string') parts.push(metadata.reason.replace(/_/g, ' '));
  if (typeof metadata.restoredFromVersion === 'number') parts.push(`v${metadata.restoredFromVersion}`);
  return parts.join(' ');
}

export default function AuditLogCard() {
  const { t } = useTranslation();
  const [category, setCategory] = useState(ALL);
  const [offset, setOffset] = useState(0);

  const filter = category === ALL ? '' : `&category=${encodeURIComponent(category)}`;
  const { data, isLoading, isError } = useQuery<AuditPage>({
    queryKey: ['auditLog', category, offset],
    queryFn: async () => {
      const response = await fetch(`/api/organization/audit-log?limit=${PAGE_SIZE}&offset=${offset}${filter}`);
      if (!response.ok) throw new Error('Could not load the audit log');
      return response.json();
    },
    placeholderData: (previous) => previous,
  });

  const categories = data?.categories ?? [];

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <Select
            value={category}
            onValueChange={(value) => {
              setCategory(value);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label={t('auditLog.filterLabel', 'Show')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('auditLog.categories.all', 'Everything')}</SelectItem>
              {categories.map((name) => (
                <SelectItem key={name} value={name}>
                  {t(`auditLog.categories.${name}`, name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/organization/audit-log?format=csv${filter}`} download>
              <Download className="h-4 w-4 mr-2" />
              {t('auditLog.export', 'Export CSV')}
            </a>
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('auditLog.loading', 'Loading…')}</p>
        ) : isError || !data ? (
          <p className="text-sm text-destructive">{t('auditLog.error', 'The audit log could not be loaded.')}</p>
        ) : data.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('auditLog.empty', 'Nothing recorded yet.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('auditLog.columns.when', 'When')}</TableHead>
                  <TableHead>{t('auditLog.columns.who', 'Who')}</TableHead>
                  <TableHead>{t('auditLog.columns.what', 'What')}</TableHead>
                  <TableHead>{t('auditLog.columns.details', 'Details')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.entries.map((entry) => (
                  <TableRow key={entry.id} data-testid={`audit-entry-${entry.id}`}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">
                      {entry.actorUsername ?? t('auditLog.system', 'system')}
                      {entry.apiKeyId && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          {t('auditLog.viaKey', 'API key')}
                        </Badge>
                      )}
                      {entry.ipAddress && <span className="block text-muted-foreground">{entry.ipAddress}</span>}
                    </TableCell>
                    <TableCell className="text-xs">{t(`auditLog.actions.${entry.action.replace('.', '_')}`, entry.action)}</TableCell>
                    <TableCell className="text-xs">{describeEntry(entry.metadata)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data && (offset > 0 || data.hasMore) && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              {t('auditLog.newer', 'Newer')}
            </Button>
            <Button variant="outline" size="sm" disabled={!data.hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>
              {t('auditLog.older', 'Older')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

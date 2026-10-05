import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OrganizationQuotaSummary, QuotaOverrides } from '@shared/tenant-quotas';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type NumericQuota = Exclude<keyof QuotaOverrides, 'mode'>;
export default function QuotaAdministrationCard() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<OrganizationQuotaSummary>();
  const [draft, setDraft] = useState<QuotaOverrides>();
  const [notice, setNotice] = useState('');
  const { data, isLoading, isError, refetch } = useQuery<{ items: OrganizationQuotaSummary[]; total: number }>({
    queryKey: ['quotaAdministration', search, offset],
    queryFn: async () => (await apiRequest('GET', `/api/admin/organization-quotas?search=${encodeURIComponent(search)}&offset=${offset}&limit=20`)).json(),
  });
  const refresh = () => { void client.invalidateQueries({ queryKey: ['quotaAdministration'] }); void client.invalidateQueries({ queryKey: ['organizationUsage'] }); };
  const fail = (error: Error) => setNotice(error.message.includes('409')
    ? t('quota.conflict', 'Quotas changed or storage needs reconciliation. Refresh the organization and check its inventory before saving again.')
    : t('quota.saveError', 'Quota changes could not be saved. Check your permissions and the entered values.'));
  const save = useMutation({
    mutationFn: async () => (await apiRequest('PATCH', `/api/admin/organization-quotas/${selected!.organizationId}`, { revision: selected!.revision, overrides: draft })).json() as Promise<OrganizationQuotaSummary>,
    onSuccess: result => { setSelected(result); setDraft(result.overrides); setNotice(''); refresh(); }, onError: fail,
  });
  const reconcile = useMutation({
    mutationFn: async () => (await apiRequest('POST', `/api/admin/organization-quotas/${selected!.organizationId}/reconcile-artifacts`, {})).json() as Promise<OrganizationQuotaSummary>,
    onSuccess: result => { setSelected(result); setNotice(''); refresh(); },
    onError: () => setNotice(t('quota.reconcileError', 'Storage reconciliation failed. Existing usage and reservations were preserved.')),
  });
  const fields: Array<[NumericQuota, string]> = [
    ['maxConcurrentRuns', t('quota.concurrent', 'Concurrent runs')], ['maxQueuedRuns', t('quota.queued', 'Queued runs')],
    ['maxTests', t('quota.tests', 'Saved tests')], ['maxArtifactBytes', t('quota.bytes', 'Artifact storage (bytes)')],
    ['maxMonthlyExecutionMinutes', t('quota.resources', 'Monthly execution minutes')],
  ];
  const busy = save.isPending || reconcile.isPending;
  return <Card>
    <CardHeader><CardTitle>{t('quota.administration', 'Quota administration')}</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm text-muted-foreground">{t('quota.independent', 'Quotas work independently of payments. Unlimited local use is available through configuration.')}</p>
      <Label htmlFor="quota-search">{t('quota.search', 'Find an organization')}</Label>
      <Input id="quota-search" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} />
      {isLoading && <p>{t('quota.loading', 'Loading quotas…')}</p>}
      {isError && <p role="alert">{t('quota.loadError', 'Quotas could not be loaded.')}</p>}
      <div className="flex flex-wrap gap-2">
        {data?.items.map(item => <Button key={item.organizationId} variant={selected?.organizationId === item.organizationId ? 'default' : 'outline'} disabled={busy}
          onClick={() => { setSelected(item); setDraft(item.overrides); setNotice(''); }}>{item.name}</Button>)}
      </div>
      {data && <div className="flex gap-2">
        <Button variant="outline" disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - 20))}>{t('quota.previous', 'Previous')}</Button>
        <Button variant="outline" disabled={offset + 20 >= data.total || busy} onClick={() => setOffset(offset + 20)}>{t('quota.next', 'Next')}</Button>
        <Button variant="outline" disabled={busy} onClick={async () => {
          const result = await refetch(); const current = result.data?.items.find(item => item.organizationId === selected?.organizationId);
          if (current) { setSelected(current); setDraft(current.overrides); setNotice(''); }
        }}>{t('quota.refresh', 'Refresh')}</Button>
      </div>}
      {selected && draft && <form className="space-y-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
        <h3 className="font-semibold">{selected.name}</h3>
        <p className="text-sm text-muted-foreground">{t('quota.valuesHelp', 'Inherit uses the installation default. Zero means unlimited for tests, storage and monthly minutes; running and queued limits must be positive.')}</p>
        <div className="space-y-1">
          <Label htmlFor="quota-mode-select">{t('quota.mode', 'Quota mode')}</Label>
          <select id="quota-mode-select" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={busy}
            value={draft.mode ?? 'inherit'} onChange={event => setDraft({ ...draft, mode: event.target.value === 'inherit' ? null : event.target.value as QuotaOverrides['mode'] })}>
            <option value="inherit">{t('quota.inherit', 'Inherit')}</option>
            <option value="off">{t('quota.off', 'Quotas disabled')}</option>
            <option value="monitor">{t('quota.monitor', 'Monitoring only')}</option>
            <option value="enforce">{t('quota.enforce', 'Limits enforced')}</option>
          </select>
          <p className="text-xs text-muted-foreground">{t('quota.effectiveMode', 'Effective mode')}: {t(`quota.${selected.quotas.mode}`, selected.quotas.mode)}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {fields.map(([key, label]) => <div key={key} className="space-y-1">
            <Label htmlFor={`quota-${key}`}>{label}</Label>
            <Input id={`quota-${key}`} type="number" step="1" min={key === 'maxConcurrentRuns' || key === 'maxQueuedRuns' ? 1 : 0}
              max={key === 'maxConcurrentRuns' || key === 'maxQueuedRuns' ? 2_147_483_647 : Number.MAX_SAFE_INTEGER}
              disabled={draft[key] === null || busy} value={draft[key] ?? selected.quotas[key]}
              onChange={event => setDraft({ ...draft, [key]: event.target.value === '' ? 0 : Number(event.target.value) })} />
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft[key] === null} disabled={busy}
              aria-label={`${t('quota.inherit', 'Inherit')} ${label}`} onChange={event => setDraft({ ...draft, [key]: event.target.checked ? null : selected.quotas[key] })} />{t('quota.inherit', 'Inherit')}</label>
          </div>)}
        </div>
        <div className="rounded-md bg-muted p-3 text-sm space-y-1">
          <p>{t('quota.tests', 'Saved tests')}: {selected.usage.tests}</p>
          <p>{t('quota.artifacts', 'Retained artifact storage')}: {selected.usage.artifactsReconciledAt
            ? `${selected.usage.artifactBytes} B + ${selected.usage.reservedArtifactBytes} B` : t('quota.notMeasured', 'Not measured yet')}</p>
          <p>{t('quota.resources', 'Monthly execution minutes')}: {(selected.usage.executionMs / 60_000).toFixed(2)}</p>
        </div>
        {notice && <p role="alert" className="text-sm text-destructive">{notice}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>{t('quota.save', 'Save quotas')}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => reconcile.mutate()}>{t('quota.reconcile', 'Reconcile artifact storage')}</Button>
        </div>
      </form>}
    </CardContent>
  </Card>;
}

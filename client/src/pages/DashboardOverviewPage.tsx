import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DASHBOARD_WIDGET_IDS, DEFAULT_DASHBOARD_WIDGETS, dashboardDocumentSchema, type Dashboard, type DashboardDocument, type DashboardWidget } from '@shared/dashboard-layout';
import { useAuth } from '@/hooks/use-auth';
import { apiRequest } from '@/lib/queryClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import ConfiguredDashboardWidget from '@/components/dashboard/ConfiguredDashboardWidget';

type List = { dashboards: Dashboard[]; preferences: { selectedDashboardId: string | null; defaultDashboardId: string | null } };
export default function DashboardOverviewPage() {
  const { t } = useTranslation(); const { user } = useAuth(); const cache = useQueryClient();
  const key = ['dashboards', user?.organizationId, user?.id];
  const query = useQuery<List>({ queryKey: key, enabled: !!user, queryFn: async () => (await apiRequest('GET', '/api/dashboards')).json() });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DashboardDocument | null>(null);
  const [nameAction, setNameAction] = useState<'create' | 'rename' | 'duplicate' | null>(null);
  const [name, setName] = useState(''); const [confirmDelete, setConfirmDelete] = useState(false);
  const [widgetType, setWidgetType] = useState<DashboardWidget['type']>('kpis');
  useEffect(() => {
    setSelectedId(null); setDraft(null); setNameAction(null); setName(''); setConfirmDelete(false);
  }, [user?.organizationId, user?.id]);
  const selected = query.data?.dashboards.find(d => d.id === (selectedId ?? query.data?.preferences.defaultDashboardId ?? query.data?.preferences.selectedDashboardId)) ?? query.data?.dashboards[0];
  const mutation = useMutation({ mutationFn: async ({ method, url, body }: { method: string; url: string; body?: unknown }) => {
    const response = await apiRequest(method, url, body); return response.status === 204 ? null : response.json();
  }, onSuccess: async (row, variables) => {
    if (variables.method === 'POST' && row?.id) { setSelectedId(row.id); await apiRequest('PUT', '/api/dashboards/preferences', { selectedDashboardId: row.id }); }
    if (variables.method === 'DELETE') setSelectedId(null);
    setDraft(null); setNameAction(null); setConfirmDelete(false); await cache.invalidateQueries({ queryKey: key });
  } });
  const labels: Record<DashboardWidget['type'], string> = {
    kpis: t('dashboardOverviewPage.customize.kpis', 'Key metrics'), status: t('dashboardOverviewPage.customize.status', 'Test status'), trend: t('dashboardOverviewPage.customize.trend', 'Test trend'), schedules: t('dashboardOverviewPage.customize.schedules', 'Schedules'), reports: t('dashboardOverviewPage.customize.reports', 'Recent reports'),
  };
  const update = (next: DashboardDocument) => selected && mutation.mutate({ method: 'PUT', url: `/api/dashboards/${selected.id}`, body: { ...next, version: selected.version } });
  const editWidget = (id: string, change: Partial<DashboardWidget>) => setDraft(d => d && ({ ...d, widgets: d.widgets.map(w => w.id === id ? { ...w, ...change } : w) }));
  const move = (index: number, offset: number) => setDraft(d => {
    if (!d) return d; const widgets = [...d.widgets]; [widgets[index], widgets[index + offset]] = [widgets[index + offset], widgets[index]]; return { ...d, widgets };
  });
  const openName = (action: typeof nameAction) => { mutation.reset(); setNameAction(action); setName(action === 'create' ? '' : action === 'duplicate' ? `${selected?.name ?? ''} ${t('dashboards.copy', 'copy')}` : selected?.name ?? ''); };
  return <div className="flex w-full flex-col gap-6 p-6 xl:p-8">
    <PageHeader title={t('dashboardOverviewPage.dashboardOverview.title')} description={t('dashboardOverviewPage.description')} />
    {query.isLoading && <p role="status">{t('dashboards.loading', 'Loading dashboards…')}</p>}
    {query.isError && <div role="alert">{t('dashboards.loadFailed', 'Could not load dashboards.')} <Button onClick={() => query.refetch()}>{t('dashboardOverviewPage.retry', 'Retry')}</Button></div>}
    {query.data && <div className="flex flex-wrap items-center gap-2">
      <label>{t('dashboards.select', 'Dashboard')} <select aria-label={t('dashboards.select', 'Dashboard')} className="rounded border bg-background p-2" value={selected?.id ?? ''} disabled={mutation.isPending || confirmDelete} onChange={e => { setSelectedId(e.target.value); setDraft(null); setNameAction(null); setConfirmDelete(false); mutation.mutate({ method: 'PUT', url: '/api/dashboards/preferences', body: { selectedDashboardId: e.target.value } }); }}>
        {query.data.dashboards.map(d => <option key={d.id} value={d.id}>{d.name} · {d.visibility === 'private' ? t('dashboards.private', 'Private') : t('dashboards.shared', 'Organization')} {query.data!.preferences.defaultDashboardId === d.id ? '★' : ''}</option>)}
      </select></label>
      <Button variant="outline" disabled={mutation.isPending} onClick={() => openName('create')}>{t('dashboards.create', 'Create dashboard')}</Button>
      {selected && <>
        <Button variant="outline" disabled={mutation.isPending} onClick={() => openName('duplicate')}>{t('dashboards.duplicate', 'Duplicate')}</Button>
        <Button variant="outline" disabled={mutation.isPending || query.data.preferences.defaultDashboardId === selected.id} onClick={() => mutation.mutate({ method: 'PUT', url: '/api/dashboards/preferences', body: { defaultDashboardId: selected.id } })}>{t('dashboards.default', 'Make default')}</Button>
        {selected.canManage && <>
          <Button variant="outline" disabled={mutation.isPending} onClick={() => openName('rename')}>{t('dashboards.rename', 'Rename')}</Button>
          <Button variant="outline" disabled={mutation.isPending || selected.visibility === 'organization' && selected.creatorId !== user?.id} onClick={() => update({ name: selected.name, widgets: selected.widgets, visibility: selected.visibility === 'private' ? 'organization' : 'private' })}>{selected.visibility === 'private' ? t('dashboards.share', 'Share with organization') : t('dashboards.makePrivate', 'Make private')}</Button>
          <Button variant="outline" disabled={mutation.isPending} aria-expanded={!!draft} aria-controls="dashboard-customization" onClick={() => { mutation.reset(); setDraft(draft ? null : { name: selected.name, visibility: selected.visibility, widgets: structuredClone(selected.widgets) }); }}>{t('dashboardOverviewPage.customize.open', 'Customize dashboard')}</Button>
          <Button variant="destructive" disabled={mutation.isPending} onClick={() => setConfirmDelete(true)}>{t('dashboards.delete', 'Delete')}</Button>
        </>}
      </>}
    </div>}
    {mutation.isError && <div role="alert" className="text-destructive">{t('dashboards.saveFailed', 'Could not save. If another member changed this dashboard, reload before trying again.')} <Button variant="outline" onClick={() => { query.refetch(); mutation.reset(); setDraft(null); }}>{t('dashboards.reload', 'Reload dashboards')}</Button></div>}
    {nameAction && <form className="flex flex-wrap items-end gap-2 rounded border p-4" onSubmit={e => {
      e.preventDefault(); if (!name.trim()) return;
      if (nameAction === 'create') mutation.mutate({ method: 'POST', url: '/api/dashboards', body: { name: name.trim(), visibility: 'private', widgets: DEFAULT_DASHBOARD_WIDGETS } });
      else if (nameAction === 'duplicate' && selected) mutation.mutate({ method: 'POST', url: `/api/dashboards/${selected.id}/duplicate`, body: { name: name.trim() } });
      else if (selected) update({ name: name.trim(), visibility: selected.visibility, widgets: selected.widgets });
    }}>
      <label>{t('dashboards.name', 'Dashboard name')} <input aria-label={t('dashboards.name', 'Dashboard name')} autoFocus required maxLength={100} value={name} onChange={e => setName(e.target.value)} className="rounded border bg-background p-2" /></label>
      <Button type="submit" disabled={mutation.isPending || !name.trim()}>{t('dashboards.confirm', 'Confirm')}</Button><Button type="button" variant="ghost" onClick={() => setNameAction(null)}>{t('dashboardOverviewPage.customize.cancel', 'Cancel')}</Button>
    </form>}
    {confirmDelete && selected && <div role="alertdialog" aria-label={t('dashboards.deleteConfirm', 'Delete this dashboard?')} className="rounded border p-4">
      <p>{t('dashboards.deleteConfirm', 'Delete this dashboard?')}</p><Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate({ method: 'DELETE', url: `/api/dashboards/${selected.id}` })}>{t('dashboards.confirmDelete', 'Confirm deletion')}</Button><Button variant="ghost" onClick={() => setConfirmDelete(false)}>{t('dashboardOverviewPage.customize.cancel', 'Cancel')}</Button>
    </div>}
    {draft && <fieldset id="dashboard-customization" disabled={mutation.isPending} className="rounded border p-4">
      <legend>{t('dashboardOverviewPage.customize.open', 'Customize dashboard')}</legend>
      <p>{t('dashboards.editorDescription', 'Add up to 20 widget instances. Shared dashboards use each reader’s project permissions.')}</p>
      <ol className="space-y-3">{draft.widgets.map((w, index) => <li key={w.id} className="flex flex-wrap items-center gap-3 rounded border p-3">
        <label><input type="checkbox" checked={w.visible} onChange={e => editWidget(w.id, { visible: e.target.checked })} /> {labels[w.type]}</label>
        <label>{t('dashboards.widgetTitle', 'Widget title')} <input aria-label={`${t('dashboards.widgetTitle', 'Widget title')} ${index + 1}`} maxLength={100} value={w.title ?? ''} onChange={e => editWidget(w.id, { title: e.target.value })} className="rounded border bg-background p-1" /></label>
        <label>{t('dashboards.width', 'Width')} <select aria-label={`${t('dashboards.width', 'Width')} ${index + 1}`} value={w.width} onChange={e => editWidget(w.id, { width: e.target.value as DashboardWidget['width'] })}><option value="half">{t('dashboards.half', 'Half')}</option><option value="full">{t('dashboards.full', 'Full')}</option></select></label>
        <label>{t('dashboards.project', 'Project ID (optional)')} <input type="number" min={1} aria-label={`${t('dashboards.project', 'Project ID (optional)')} ${index + 1}`} value={w.config.projectId ?? ''} onChange={e => editWidget(w.id, { config: { ...w.config, projectId: e.target.value ? Number(e.target.value) : undefined } })} className="w-24 rounded border bg-background p-1" /></label>
        {w.type !== 'schedules' && <label>{t('dashboards.period', 'Period in days')} <input type="number" min={1} max={365} aria-label={`${t('dashboards.period', 'Period in days')} ${index + 1}`} value={w.config.days ?? 30} onChange={e => editWidget(w.id, { config: { ...w.config, days: Number(e.target.value) } })} className="w-20 rounded border bg-background p-1" /></label>}
        {['reports', 'schedules'].includes(w.type) && <label>{t('dashboards.limit', 'Result limit')} <input type="number" min={1} max={50} aria-label={`${t('dashboards.limit', 'Result limit')} ${index + 1}`} value={w.config.limit ?? 5} onChange={e => editWidget(w.id, { config: { ...w.config, limit: Number(e.target.value) } })} className="w-20 rounded border bg-background p-1" /></label>}
        {w.type === 'schedules' && <label>{t('dashboards.environment', 'Environment (optional)')} <input aria-label={`${t('dashboards.environment', 'Environment (optional)')} ${index + 1}`} maxLength={100} value={w.config.environment ?? ''} onChange={e => editWidget(w.id, { config: { ...w.config, environment: e.target.value || undefined } })} className="rounded border bg-background p-1" /></label>}
        <Button variant="outline" size="sm" disabled={!index} aria-label={t('dashboards.moveUp', 'Move {{widget}} up', { widget: labels[w.type] })} onClick={() => move(index, -1)}>{t('dashboardOverviewPage.customize.up', 'up')}</Button>
        <Button variant="outline" size="sm" disabled={index === draft.widgets.length - 1} aria-label={t('dashboards.moveDown', 'Move {{widget}} down', { widget: labels[w.type] })} onClick={() => move(index, 1)}>{t('dashboardOverviewPage.customize.down', 'down')}</Button>
        <Button variant="ghost" aria-label={`${t('dashboards.removeWidget', 'Remove widget')} ${index + 1}`} onClick={() => setDraft({ ...draft, widgets: draft.widgets.filter(widget => widget.id !== w.id) })}>{t('dashboards.removeWidget', 'Remove widget')}</Button>
      </li>)}</ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <select aria-label={t('dashboards.widgetType', 'Widget type')} value={widgetType} onChange={e => setWidgetType(e.target.value as DashboardWidget['type'])}>{DASHBOARD_WIDGET_IDS.map(type => <option key={type} value={type}>{labels[type]}</option>)}</select>
        <Button variant="outline" disabled={draft.widgets.length >= 20} onClick={() => setDraft({ ...draft, widgets: [...draft.widgets, { id: crypto.randomUUID(), type: widgetType, visible: true, width: 'half', config: {} }] })}>{t('dashboards.addWidget', 'Add widget')}</Button>
        <Button disabled={!dashboardDocumentSchema.safeParse(draft).success} onClick={() => update(draft)}>{t('dashboardOverviewPage.customize.save', 'Save layout')}</Button>
        <Button variant="outline" onClick={() => setDraft({ ...draft, widgets: structuredClone(DEFAULT_DASHBOARD_WIDGETS) })}>{t('dashboardOverviewPage.customize.reset', 'Reset layout')}</Button>
        <Button variant="ghost" onClick={() => setDraft(null)}>{t('dashboardOverviewPage.customize.cancel', 'Cancel')}</Button>
      </div>
    </fieldset>}
    <div className="grid grid-cols-1 gap-x-5 gap-y-6 lg:grid-cols-2 [&>*]:min-w-0">{selected?.widgets.filter(w => w.visible).map(w => <div key={`${selected.id}:${w.id}`} data-testid="dashboard-widget" data-widget-id={w.id} className={w.width === 'full' ? 'lg:col-span-2' : ''}><ConfiguredDashboardWidget widget={w} /></div>)}</div>
  </div>;
}

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardOverviewPage from './DashboardOverviewPage';
import { DEFAULT_DASHBOARD_WIDGETS } from '@shared/dashboard-layout';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string, options?: Record<string, string>) => (fallback ?? key).replace('{{widget}}', options?.widget ?? '') }) }));
const auth = vi.hoisted(() => ({ user: { id: 1, organizationId: 2 } }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('@/components/dashboard/KpiPanel', () => ({ default: () => <div>KPI contents</div> }));
vi.mock('@/components/dashboard/TestStatusPieChart', () => ({ default: () => <div>Status contents</div> }));
vi.mock('@/components/dashboard/TestTrendBarChart', () => ({ default: () => <div>Trend contents</div> }));
vi.mock('@/components/dashboard/TestSchedulingsTable', () => ({ default: () => <div>Schedule contents</div> }));
vi.mock('@/components/dashboard/QuickAccessReports', () => ({ default: () => <div>Report contents</div> }));
const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', () => ({ apiRequest: api }));
let rows: any[], preferences: any;
function mount() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={cache}><DashboardOverviewPage /></QueryClientProvider>);
}
beforeEach(() => {
  auth.user = { id: 1, organizationId: 2 };
  rows = [{ id: 'first', creatorId: 1, name: 'My dashboard', visibility: 'private', version: 1, canManage: true, widgets: structuredClone(DEFAULT_DASHBOARD_WIDGETS) }];
  preferences = { selectedDashboardId: 'first', defaultDashboardId: 'first' }; api.mockReset();
  api.mockImplementation(async (method, url, body) => {
    let result: any;
    if (url === '/api/dashboards' && method === 'GET') result = { dashboards: structuredClone(rows), preferences: { ...preferences } };
    else if (url === '/api/analytics/dashboard/widget') result = body.config.projectId === 999 ? { unavailable: true } : { kpis: { totalRuns: 7 } };
    else if (url === '/api/dashboards/preferences') { preferences = { ...preferences, ...body }; result = preferences; }
    else if (url === '/api/dashboards' && method === 'POST') { result = { ...body, id: 'second', creatorId: 1, version: 1, canManage: true }; rows.push(result); }
    else if (url.endsWith('/duplicate')) { result = { ...rows[0], id: 'second', name: body.name, visibility: 'private', creatorId: 1 }; rows.push(result); }
    else if (method === 'DELETE') { rows = rows.filter(r => !url.endsWith(r.id)); preferences = { selectedDashboardId: rows[0]?.id, defaultDashboardId: rows[0]?.id }; return { status: 204 }; }
    else if (method === 'PUT') { rows = rows.map(r => url.endsWith(r.id) ? { ...r, ...body, version: r.version + 1 } : r); result = rows.find(r => url.endsWith(r.id)); }
    return { status: 200, json: async () => result };
  });
});
describe('multiple configurable dashboard interface', () => {
  it('keeps deletion confirmation on its dashboard and clears it on selection', async () => {
    rows.push({ ...rows[0], id: 'second', name: 'Other' });
    mount(); await screen.findByText('KPI contents'); fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('combobox', { name: 'Dashboard' })).toBeDisabled();
    // Even a synthetic/programmatic change must clear the confirmation.
    api.mockImplementationOnce(async () => { throw new Error('Preference update failed'); });
    fireEvent.change(screen.getByRole('combobox', { name: 'Dashboard' }), { target: { value: 'second' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm deletion' })).toBeNull());
    await screen.findByRole('alert');
    expect(api.mock.calls.some(([method]) => method === 'DELETE')).toBe(false);
  });
  it('clears dashboard drafts and confirmations when the authenticated identity changes', async () => {
    const mounted = mount(); await screen.findByText('KPI contents');
    fireEvent.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    auth.user = { id: 8, organizationId: 9 };
    mounted.rerender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardOverviewPage /></QueryClientProvider>);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save layout' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Confirm deletion' })).toBeNull();
  });
  it('opens the default dashboard on a new visit instead of the last selection', async () => {
    rows.push({ ...rows[0], id: 'second', name: 'Default', widgets: [] });
    preferences.defaultDashboardId = 'second'; preferences.selectedDashboardId = 'first';
    mount(); await waitFor(() => expect(screen.getByRole('combobox', { name: 'Dashboard' })).toHaveValue('second'));
    expect(screen.queryByText('KPI contents')).toBeNull();
  });
  it('preserves saved widget order/visibility and scopes queries to the member', async () => {
    rows[0].widgets.reverse(); rows[0].widgets.find((w: any) => w.type === 'kpis').visible = false;
    mount(); await screen.findByText('Report contents');
    expect(screen.queryByText('KPI contents')).toBeNull();
    expect(screen.getAllByTestId('dashboard-widget').map(el => el.getAttribute('data-widget-id'))).toEqual(['reports', 'schedules', 'trend', 'status']);
  });
  it('adds repeated widgets and edits title, width, period and order with revision', async () => {
    mount(); await screen.findByText('KPI contents'); fireEvent.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Widget type' }), { target: { value: 'trend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add widget' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Widget title 6' }), { target: { value: 'Long term' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Width 6' }), { target: { value: 'full' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Period in days 6' }), { target: { value: '365' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await screen.findByText('Long term');
    expect(rows[0].widgets).toHaveLength(6); expect(rows[0].widgets[5]).toMatchObject({ type: 'trend', title: 'Long term', width: 'full', config: { days: 365 } });
    expect(rows[0].version).toBe(2); expect(screen.getAllByText('Trend contents')).toHaveLength(2);
  });
  it('creates, renames, publishes, duplicates, selects a default and deletes', async () => {
    mount(); await screen.findByText('KPI contents'); fireEvent.click(screen.getByRole('button', { name: 'Create dashboard' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Dashboard name' }), { target: { value: 'Release' } }); fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Dashboard' })).toHaveValue('second'));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' })); fireEvent.change(screen.getByRole('textbox', { name: 'Dashboard name' }), { target: { value: 'Team release' } }); fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('option', { name: /Team release/ });
    fireEvent.click(screen.getByRole('button', { name: 'Share with organization' })); await screen.findByRole('button', { name: 'Make private' });
    fireEvent.click(screen.getByRole('button', { name: 'Make default' })); await waitFor(() => expect(preferences.defaultDashboardId).toBe('second'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
    await waitFor(() => expect(rows).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); await waitFor(() => expect(rows).toHaveLength(2));
  });
  it('shared readers can duplicate but cannot edit; inaccessible project shows no metrics', async () => {
    rows[0].canManage = false; rows[0].visibility = 'organization'; rows[0].widgets = [{ ...DEFAULT_DASHBOARD_WIDGETS[0], config: { projectId: 999 } }];
    mount(); await screen.findByText('Project unavailable. You do not have access to this widget’s project.');
    expect(screen.queryByText('KPI contents')).toBeNull(); expect(screen.queryByRole('button', { name: 'Customize dashboard' })).toBeNull(); expect(screen.getByRole('button', { name: 'Duplicate' })).toBeEnabled();
  });
  it('keeps unsaved widget changes after stale revision failure until explicit reload', async () => {
    mount(); await screen.findByText('KPI contents'); fireEvent.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Widget title 1' }), { target: { value: 'Unsaved' } });
    api.mockImplementationOnce(async () => { throw new Error('409 conflict'); }); fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await screen.findByRole('alert'); expect(screen.getByRole('textbox', { name: 'Widget title 1' })).toHaveValue('Unsaved'); expect(screen.getByText('KPI contents')).toBeInTheDocument();
  });
});

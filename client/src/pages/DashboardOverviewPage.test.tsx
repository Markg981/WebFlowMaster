import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardOverviewPage from './DashboardOverviewPage';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 1, organizationId: 2 } }) }));
vi.mock('@/components/dashboard/KpiPanel', () => ({ default: () => <div>KPI contents</div> }));
vi.mock('@/components/dashboard/TestStatusPieChart', () => ({ default: () => <div>Status contents</div> }));
vi.mock('@/components/dashboard/TestTrendBarChart', () => ({ default: () => <div>Trend contents</div> }));
vi.mock('@/components/dashboard/TestSchedulingsTable', () => ({ default: () => <div>Schedule contents</div> }));
vi.mock('@/components/dashboard/QuickAccessReports', () => ({ default: () => <div>Report contents</div> }));
const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', () => ({ apiRequest: api }));
const defaults = ['kpis', 'status', 'trend', 'schedules', 'reports'].map(id => ({ id, visible: true }));
let stored = defaults;
function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DashboardOverviewPage /></QueryClientProvider>);
}
beforeEach(() => {
  stored = defaults;
  api.mockReset();
  api.mockImplementation(async (method, url, body) => {
    if (url === '/api/analytics/dashboard') return { json: async () => ({ kpis: { totalRuns: 7 } }) };
    if (method === 'PUT') stored = body.widgets;
    if (method === 'DELETE') stored = defaults;
    return { json: async () => ({ widgets: stored }) };
  });
});
describe('dashboard customization', () => {
  it('loads saved visibility and order', async () => {
    stored = [...defaults].reverse().map(w => ({ ...w, visible: w.id !== 'kpis' }));
    mount();
    await screen.findByText('Report contents');
    await waitFor(() => expect(screen.queryByText('KPI contents')).toBeNull());
    expect(screen.getAllByTestId('dashboard-widget').map(el => el.getAttribute('data-widget-id'))).toEqual(['reports', 'schedules', 'trend', 'status']);
  });
  it('saves visibility and keyboard accessible reordering, then resets', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Customize dashboard' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Key metrics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Test status up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/api/dashboard/layout', { widgets: [defaults[1], { ...defaults[0], visible: false }, ...defaults.slice(2)] }));
    await waitFor(() => expect(screen.queryByText('KPI contents')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
    await screen.findByText('KPI contents');
    expect(api).toHaveBeenCalledWith('DELETE', '/api/dashboard/layout');
  });
  it('preserves displayed layout and shows save failure without closing the editor', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Customize dashboard' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Key metrics' }));
    api.mockImplementationOnce(async () => { throw new Error('offline'); });
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    expect(await screen.findByText('Could not save your layout. Try again.')).toBeInTheDocument();
    expect(screen.getByText('KPI contents')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save layout' })).toBeEnabled();
  });
  it('shows a retry on failed preference loading and disables customization', async () => {
    api.mockImplementation(async (_method, url) => {
      if (url === '/api/dashboard/layout') throw new Error('offline');
      return { json: async () => ({}) };
    });
    mount();
    expect(await screen.findByText('Could not load your layout.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Customize dashboard' })).toBeDisabled();
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SampleProjectCard from './SampleProjectCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, string>) =>
      (fallback ?? key).replace('{{reason}}', options?.reason ?? ''),
  }),
}));
const auth = vi.hoisted(() => ({ user: { id: 1, organizationId: 2, role: 'owner' } as any }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: auth.user }) }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('wouter', () => ({ useLocation: () => ['/dashboard', navigate] }));
const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', () => ({ apiRequest: api }));

let offered: boolean;
let created: any;

function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <SampleProjectCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  auth.user = { id: 1, organizationId: 2, role: 'owner' };
  offered = true;
  created = { plans: [], firstRunPlanId: 'plan-1', run: { id: 'run-1' } };
  toast.mockReset();
  navigate.mockReset();
  api.mockReset();
  api.mockImplementation(async (method: string) => ({
    json: async () => (method === 'GET' ? { offered } : created),
  }));
});

describe('SampleProjectCard', () => {
  it('creates the sample and opens the report of its first run', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Create sample project' }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/test-plans/plan-1/executions/run-1/report'),
    );
    expect(api).toHaveBeenCalledWith('POST', '/api/sample-project', {});
  });

  it('goes to the plans, saying why, when the first run did not start', async () => {
    created = { ...created, run: null, runError: 'No runner is available' };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Create sample project' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/test-plans'));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Its first run did not start: No runner is available',
      }),
    );
  });

  it('shows nothing when the server does not offer it', async () => {
    offered = false;
    const { container } = mount();
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('is not shown to viewers, nor asked for', () => {
    auth.user = { id: 1, organizationId: 2, role: 'viewer' };
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(api).not.toHaveBeenCalled();
  });

  it('"Not now" hides it, and it stays hidden', async () => {
    const first = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region')).toBeNull();
    first.unmount();
    api.mockClear();
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(api).not.toHaveBeenCalled();
  });
});

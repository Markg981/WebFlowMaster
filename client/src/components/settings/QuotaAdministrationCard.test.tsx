import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : _key }) }));
const request = vi.fn();
vi.mock('@/lib/queryClient', () => ({ apiRequest: (...args: unknown[]) => request(...args) }));
const item = { organizationId: 2, name: 'Customer', revision: 1,
  quotas: { mode: 'enforce', maxConcurrentRuns: 2, maxQueuedRuns: 100, maxTests: 0, maxArtifactBytes: 0, maxMonthlyExecutionMinutes: 0 },
  overrides: { mode: null, maxConcurrentRuns: null, maxQueuedRuns: null, maxTests: null, maxArtifactBytes: null, maxMonthlyExecutionMinutes: null },
  usage: { tests: 3, artifactBytes: 0, reservedArtifactBytes: 0, executionMs: 0, running: 0, queued: 0, artifactsReconciledAt: null } };
beforeEach(() => { request.mockReset(); request.mockResolvedValue({ json: async () => ({ items: [item], total: 1 }) }); });
async function renderCard() {
  const Component = (await import('./QuotaAdministrationCard')).default;
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Component /></QueryClientProvider>);
}
describe('QuotaAdministrationCard', () => {
  it('edits an inherited limit and submits the revision with the selected policy', async () => {
    await renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Customer' }));
    fireEvent.click(screen.getByLabelText('Inherit Saved tests'));
    fireEvent.change(screen.getByLabelText('Saved tests'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Quota mode'), { target: { value: 'off' } });
    request.mockImplementation(async (method: string) => ({ json: async () => method === 'PATCH' ? { ...item, revision: 2 } : { items: [item], total: 1 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Save quotas' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('PATCH', '/api/admin/organization-quotas/2', expect.objectContaining({ revision: 1, overrides: expect.objectContaining({ maxTests: 7, mode: 'off' }) })));
  });
  it('shows reconciliation status and an actionable save conflict', async () => {
    await renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Customer' }));
    expect(screen.getByText(/Not measured yet/)).toBeInTheDocument();
    request.mockRejectedValue(new Error('409: quota_revision_conflict'));
    fireEvent.click(screen.getByRole('button', { name: 'Save quotas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh');
  });
});

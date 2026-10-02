import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SavedTestsPanel } from './SavedTestsPanel';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key }) }));
vi.mock('./ImportApiTestsDialog', () => ({ ImportApiTestsDialog: () => null }));
vi.mock('@/components/tests/CommentsPanel', () => ({ default: ({ kind, targetId }: any) => <p>{kind}:{targetId}</p> }));
describe('saved API test discussions', () => {
  it('opens comments for the saved target without loading or editing the request', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['/api/projects'], []);
    const load = vi.fn();
    render(<QueryClientProvider client={client}><SavedTestsPanel savedTests={[{ id: 42, name: 'Order endpoint', method: 'GET', url: '/orders', updatedAt: new Date(), projectId: null } as any]}
      onLoadTest={load} onEditTest={vi.fn()} onDeleteTest={vi.fn()} onExportTest={vi.fn()} onOpenSaveModal={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    expect(await screen.findByText('api:42')).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });
});

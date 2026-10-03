import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SavedTestsPanel } from './SavedTestsPanel';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key }) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 1, role: 'editor' } }) }));
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

it('opens API history without loading the request and reloads a restored executable snapshot', async () => {
  const test = { id: 42, name: 'Order endpoint', method: 'GET', url: '/orders', updatedAt: new Date(), projectId: null };
  const restored = { ...test, method: 'POST', assertions: [{ expected: 201 }], teardown: { url: '/cleanup' } };
  const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () =>
    url.endsWith('/restore') ? { test: restored } : url.endsWith('/publishing') ? {} : {
      versions: [2, 1].map(version => ({ version, name: test.name, summary: 'Saved', createdAt: new Date().toISOString(), authorName: 'Alice', restoredFromVersion: null, stepCount: 0, runs: 0 })), unversionedRuns: 0,
    },
  }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['/api/projects'], []);
  const load = vi.fn();
  render(<QueryClientProvider client={client}><SavedTestsPanel savedTests={[test as any]} onLoadTest={load} onEditTest={vi.fn()} onDeleteTest={vi.fn()} onExportTest={vi.fn()} onOpenSaveModal={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'History of {{name}}' }));
  await screen.findByTestId('test-history-list');
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  await waitFor(() => expect(load).toHaveBeenCalledWith(restored));
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/api-tests/42/versions/1/restore')).toBe(true);
});

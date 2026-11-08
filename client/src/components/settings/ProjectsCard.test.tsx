import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectsCard from './ProjectsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, options?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
vi.mock('@/hooks/use-projects', () => ({
  useProjects: () => ({
    data: [{ id: 7, name: 'Checkout', isRestricted: false }],
    isLoading: false,
    error: null,
  }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ProjectsCard deletion', () => {
  it('asks for the project name before deleting', async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ProjectsCard />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete project Checkout' }));
    const confirmButton = await screen.findByRole('button', { name: 'Delete' });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Confirmation text' }), {
      target: { value: 'Checkout' },
    });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'DELETE');
      expect(call![0]).toBe('/api/projects/7');
    });
  });
});

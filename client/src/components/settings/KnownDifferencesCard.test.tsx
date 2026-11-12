import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import KnownDifferencesCard from './KnownDifferencesCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) =>
            String(options?.[name] ?? ''),
          )
        : _key,
  }),
}));
vi.mock('@/hooks/use-projects', () => ({
  useProjects: () => ({ data: [{ id: 1, name: 'Shop' }], isLoading: false }),
}));

/**
 * The organization's known differences in Settings: everyone can read them, a viewer cannot add
 * or delete one, and an expired one is shown as expired.
 */

const fetchMock = vi.fn();

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  projectId: 1,
  projectName: 'Shop',
  uiTestId: null,
  testName: null,
  checkpointName: 'total',
  kind: 'text',
  pathPattern: null,
  reason: 'new rounding',
  reference: 'ticket 1234',
  approvedByUserId: 1,
  createdAt: '2026-11-01T10:00:00.000Z',
  expiresAt: null,
  ...extra,
});

function renderCard(canEdit: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KnownDifferencesCard canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === 'DELETE'
      ? { ok: true, status: 204, json: async () => ({}) }
      : {
          ok: true,
          json: async () => ({
            rows: [row('kd-1'), row('kd-2', { expiresAt: '2020-01-01T00:00:00.000Z' })],
            total: 2,
            page: 1,
            pageSize: 25,
          }),
        },
  );
  vi.stubGlobal('fetch', fetchMock);
});

describe('KnownDifferencesCard', () => {
  it('lists the known differences and marks the expired ones', async () => {
    renderCard(true);
    expect(await screen.findByTestId('known-difference-kd-1')).toBeInTheDocument();
    expect(screen.getByTestId('known-difference-kd-2')).toHaveTextContent('Expired');
    expect(screen.getByTestId('known-difference-kd-1')).toHaveTextContent('Never');
  });

  it('gives a viewer no way to add or delete', async () => {
    renderCard(false);
    await screen.findByTestId('known-difference-kd-1');
    expect(screen.queryByRole('button', { name: /New/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete known difference' })).toBeNull();
  });

  it('deletes one after confirmation', async () => {
    renderCard(true);
    await screen.findByTestId('known-difference-kd-1');
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete known difference' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/comparison-known-differences/kd-1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});

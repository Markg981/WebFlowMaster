import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ImpactMapCard from './ImpactMapCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key) }),
}));
let role = 'editor';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { role } }) }));

/** Which files affect which tests, and a place to try the map on a change. */

const fetchMock = vi.fn();

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ImpactMapCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  role = 'editor';
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/impact-rules' && !init?.method) {
      return { ok: true, status: 200, json: async () => [
        { id: 'r1', pattern: 'src/checkout/**', tagId: 't1', tagName: 'checkout' },
        { id: 'r2', pattern: 'docs/**', tagId: null, tagName: null },
      ] };
    }
    if (url === '/api/tags') return { ok: true, status: 200, json: async () => [{ id: 't1', name: 'checkout' }] };
    if (url === '/api/test-plans') return { ok: true, status: 200, json: async () => [] };
    if (url === '/api/impact-rules/r1') return { ok: true, status: 204, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ImpactMapCard', () => {
  it('lists the rules, a rule without a tag as affecting no test, and removes one', async () => {
    renderCard();
    expect(await screen.findByText('src/checkout/**')).toBeTruthy();
    expect(screen.getByText('checkout')).toBeTruthy();
    expect(screen.getByText('no test')).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText('Remove rule')[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/impact-rules/r1', expect.objectContaining({ method: 'DELETE' })));
  });

  it('lets a viewer read and try the map, not change it', async () => {
    role = 'viewer';
    renderCard();
    expect(await screen.findByText('src/checkout/**')).toBeTruthy();
    expect(screen.queryByLabelText('Remove rule')).toBeNull();
    expect(screen.queryByText('Add rule')).toBeNull();
    expect(screen.getByText('Show which tests would run')).toBeTruthy();
  });
});

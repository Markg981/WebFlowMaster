import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SessionsCard from './SessionsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));

const fetchMock = vi.fn();
const sessions = [
  {
    id: 'a',
    current: true,
    createdAt: '2026-11-01T10:00:00Z',
    lastSeenAt: '2026-11-07T10:00:00Z',
    userAgent: 'Firefox',
    ip: '10.0.0.0',
  },
  {
    id: 'b',
    current: false,
    createdAt: '2026-11-02T10:00:00Z',
    lastSeenAt: '2026-11-06T10:00:00Z',
    userAgent: 'Safari',
    ip: '10.0.1.0',
  },
];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) =>
    init?.method === 'DELETE'
      ? { ok: true, status: 204, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => sessions },
  );
  vi.stubGlobal('fetch', fetchMock);
});

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionsCard />
    </QueryClientProvider>,
  );
}

describe('SessionsCard', () => {
  it('flags the current session and offers to end only the others', async () => {
    renderCard();
    expect(await screen.findByText('Safari')).toBeTruthy();
    expect(screen.getByText('This session')).toBeTruthy();
    expect(screen.getAllByText('End session')).toHaveLength(1);
  });

  it('asks for confirmation before ending a session', async () => {
    renderCard();
    fireEvent.click(await screen.findByText('End session'));
    expect(screen.getByText('End this session?')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/me/sessions/b',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});

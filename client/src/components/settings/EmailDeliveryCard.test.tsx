import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import EmailDeliveryCard from './EmailDeliveryCard';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 7, organizationId: 3 } }) }));
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
function show(payload: unknown, ok = true) {
  fetchMock.mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => payload, text: async () => 'Server error' });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EmailDeliveryCard /></QueryClientProvider>);
}
it('distinguishes SMTP acceptance from confirmed delivery and shows bounces', async () => {
  show({ configured: true, trackingConfigured: true, deliveries: [
    { id: 'a', recipient: 'accepted@example.com', purpose: 'invitation', state: 'accepted', createdAt: '2026-10-02T12:00:00Z' },
    { id: 'b', recipient: 'bounce@example.com', purpose: 'run_finished', state: 'hard_bounce', createdAt: '2026-10-02T12:00:00Z' },
  ] });
  expect(await screen.findByText('Accepted by SMTP')).toBeInTheDocument();
  expect(screen.getByText('Hard bounce')).toBeInTheDocument();
  expect(screen.getByText('bounce@example.com')).toBeInTheDocument();
  expect(String(fetchMock.mock.calls[0][0])).toContain('/api/mail-deliveries');
});
it('explains when bounce tracking is unavailable', async () => {
  show({ configured: true, trackingConfigured: false, deliveries: [] });
  expect(await screen.findByText('Delivery and bounce tracking is not configured.')).toBeInTheDocument();
  expect(screen.getByText('No messages recorded yet.')).toBeInTheDocument();
});
it('reports an API failure without rendering delivery data', async () => {
  show({}, false);
  expect(await screen.findByText('Email delivery history could not be loaded.')).toBeInTheDocument();
});

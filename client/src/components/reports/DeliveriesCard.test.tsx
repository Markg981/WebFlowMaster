import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import DeliveriesCard from './DeliveriesCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {}))
        text = text.split(`{{${name}}}`).join(String(value));
      return text;
    },
  }),
}));

const renderCard = (rows: unknown[]) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }));
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DeliveriesCard executionId="e1" />
    </QueryClientProvider>,
  );
};

describe('DeliveriesCard', () => {
  it('shows the status, target and last error of a failed delivery', async () => {
    renderCard([
      {
        id: 'd1',
        kind: 'webhook',
        target: 'https://hooks.test',
        status: 'failed',
        attempts: 5,
        lastError: 'Notification webhook answered 503 503.',
      },
    ]);
    await waitFor(() => expect(screen.getByTestId('deliveries-card')).toBeTruthy());
    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.getByText('https://hooks.test')).toBeTruthy();
    expect(screen.getByText('Notification webhook answered 503 503.')).toBeTruthy();
    expect(screen.getByText('5 attempt(s)')).toBeTruthy();
  });

  it('renders nothing when the run owed nothing', async () => {
    renderCard([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('deliveries-card')).toBeNull();
  });
});

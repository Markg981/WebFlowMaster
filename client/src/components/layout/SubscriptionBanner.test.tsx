import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SubscriptionBanner } from './SubscriptionBanner';
import { TestRouter } from '@/test-utils/router';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, values?: Record<string, string>) => {
      const text = typeof fallback === 'string' ? fallback : _key;
      return values ? text.replace(/\{\{(\w+)\}\}/g, (_m, name) => values[name] ?? '') : text;
    },
  }),
}));
const request = vi.fn();
vi.mock('@/lib/queryClient', () => ({ apiRequest: (...args: unknown[]) => request(...args) }));

/**
 * The line every member sees while runs cannot start: a 402 on Run should never be the first
 * they hear of it. And nothing at all when there is nothing to say.
 */
const answer = (status: string, entitlement: Record<string, unknown>) =>
  request.mockResolvedValue({
    json: async () => ({ subscription: { status }, entitlement }),
  });

function renderBanner() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TestRouter>
        <SubscriptionBanner />
      </TestRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => request.mockReset());

describe('SubscriptionBanner', () => {
  it('is silent for an active subscription', async () => {
    answer('active', { runsBlocked: false, reason: null, graceEndsAt: null });
    renderBanner();
    await waitFor(() => expect(request).toHaveBeenCalledWith('GET', '/api/billing'));
    expect(screen.queryByTestId('subscription-banner')).not.toBeInTheDocument();
  });

  it('is silent when billing cannot be read', async () => {
    request.mockResolvedValue({
      json: async () => {
        throw new Error('500: nope');
      },
    });
    renderBanner();
    await waitFor(() => expect(request).toHaveBeenCalled());
    // Let the query reach its error state before looking.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.queryByTestId('subscription-banner')).not.toBeInTheDocument();
  });

  it('warns an overdue organization of the day runs stop', async () => {
    answer('past_due', {
      runsBlocked: false,
      reason: null,
      graceEndsAt: '2026-10-19T10:00:00.000Z',
    });
    renderBanner();
    expect(await screen.findByTestId('subscription-banner')).toHaveTextContent(
      'Runs stop on 2026-10-19',
    );
    expect(screen.getByRole('link', { name: 'Billing settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('tells a suspended organization that runs cannot start, and what still works', async () => {
    answer('suspended', { runsBlocked: true, reason: 'suspended', graceEndsAt: null });
    renderBanner();
    const banner = await screen.findByTestId('subscription-banner');
    expect(banner).toHaveTextContent('suspended');
    expect(banner).toHaveTextContent('Reports and settings stay available');
  });
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BillingSummary } from '@shared/billing';
import BillingCard from './BillingCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, values?: Record<string, string>) => {
      const text = typeof fallback === 'string' ? fallback : _key;
      return values ? text.replace(/\{\{(\w+)\}\}/g, (_m, name) => values[name] ?? '') : text;
    },
    i18n: { language: 'en' },
  }),
}));
const request = vi.fn();
vi.mock('@/lib/queryClient', () => ({ apiRequest: (...args: unknown[]) => request(...args) }));

/**
 * What an owner sees: the plan, its status, usage against what it includes — and either the
 * way to pay or the honest line that there is no provider to pay through.
 */
const summary = (overrides: Partial<BillingSummary> = {}): BillingSummary => ({
  provider: 'none',
  plan: {
    code: 'team',
    name: 'Team',
    priceMonthMinor: 4900,
    priceYearMinor: 49000,
    currency: 'eur',
    trialDays: 0,
    active: true,
    quotas: {
      maxConcurrentRuns: 4,
      maxQueuedRuns: 100,
      maxTests: 500,
      maxArtifactBytes: null,
      maxMonthlyExecutionMinutes: 1000,
    },
    providerPriceIds: { month: 'price_month', year: 'price_year' },
  },
  subscription: {
    organizationId: 1,
    planCode: 'team',
    status: 'active',
    interval: 'month',
    currentPeriodStart: '2026-10-01T00:00:00.000Z',
    currentPeriodEnd: '2026-11-01T00:00:00.000Z',
    trialEndsAt: null,
    pastDueSince: null,
    provider: 'manual',
    providerCustomerId: null,
    providerSubscriptionId: null,
    suspendedReason: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  entitlement: { runsBlocked: false, reason: null, graceEndsAt: null },
  quotas: {
    mode: 'enforce',
    maxConcurrentRuns: 4,
    maxQueuedRuns: 100,
    maxTests: 500,
    maxArtifactBytes: 0,
    maxMonthlyExecutionMinutes: 1000,
  },
  usage: {
    tests: 120,
    artifactBytes: 0,
    reservedArtifactBytes: 0,
    executionMs: 600_000,
    periodStart: '2026-10-01T00:00:00Z',
    periodEnd: '2026-11-01T00:00:00Z',
    artifactsReconciledAt: null,
    running: 1,
    queued: 0,
  },
  pastDueGraceDays: 7,
  ...overrides,
});

function renderCard() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <BillingCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  request.mockReset();
});

describe('BillingCard', () => {
  it('shows the plan, its status, the period and usage against what the plan includes', async () => {
    request.mockResolvedValue({ json: async () => summary() });
    renderCard();
    expect(await screen.findByTestId('billing-plan')).toHaveTextContent('Team');
    expect(screen.getByTestId('billing-status')).toHaveTextContent('Active');
    expect(screen.getByTestId('billing-period')).toHaveTextContent('2026-10-01 – 2026-11-01');
    expect(screen.getByTestId('billing-usage-tests')).toHaveTextContent('120 / 500');
    expect(screen.getByTestId('billing-usage-minutes')).toHaveTextContent('10 / 1000');
    expect(screen.getByTestId('billing-usage-artifacts')).toHaveTextContent('Unlimited');
    expect(screen.getByTestId('billing-price')).toHaveTextContent('€49.00 / month');
  });

  it('without a provider says billing is the installation administrator’s, and offers no checkout', async () => {
    request.mockResolvedValue({ json: async () => summary() });
    renderCard();
    expect(await screen.findByTestId('billing-manual')).toBeInTheDocument();
    expect(screen.queryByTestId('billing-change-plan')).not.toBeInTheDocument();
  });

  it('with Stripe lists the other plans and sends the owner to the checkout URL', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    request.mockImplementation(async (method: string, url: string) => {
      if (url === '/api/billing') return { json: async () => summary({ provider: 'stripe' }) };
      if (url === '/api/billing/plans')
        return {
          json: async () => ({
            items: [
              summary().plan,
              {
                ...summary().plan,
                code: 'business',
                name: 'Business',
                priceMonthMinor: 19900,
                providerPriceIds: { month: 'price_business' },
              },
            ],
          }),
        };
      if (url === '/api/billing/checkout' && method === 'POST')
        return { json: async () => ({ url: 'https://checkout.stripe.test/session' }) };
      throw new Error(`unexpected ${method} ${url}`);
    });
    renderCard();
    fireEvent.click(await screen.findByTestId('billing-change-plan'));
    const list = await screen.findByTestId('billing-plan-list');
    await waitFor(() => expect(list).toHaveTextContent('Business'));
    expect(list).not.toHaveTextContent('Team');
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/session'),
    );
    expect(request).toHaveBeenCalledWith('POST', '/api/billing/checkout', {
      planCode: 'business',
      interval: 'month',
    });
    vi.unstubAllGlobals();
  });

  it('says plainly when runs are blocked, and when they are about to be', async () => {
    request.mockResolvedValue({
      json: async () =>
        summary({
          subscription: {
            ...summary().subscription,
            status: 'suspended',
            suspendedReason: 'Unpaid invoice',
          },
          entitlement: { runsBlocked: true, reason: 'suspended', graceEndsAt: null },
        }),
    });
    renderCard();
    expect(await screen.findByTestId('billing-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('billing-reason')).toHaveTextContent('Unpaid invoice');
    expect(screen.getByTestId('billing-status')).toHaveTextContent('Suspended');
  });

  it('shows the grace deadline of an overdue subscription that still runs', async () => {
    request.mockResolvedValue({
      json: async () =>
        summary({
          subscription: { ...summary().subscription, status: 'past_due' },
          entitlement: {
            runsBlocked: false,
            reason: null,
            graceEndsAt: '2026-10-20T00:00:00.000Z',
          },
        }),
    });
    renderCard();
    expect(await screen.findByTestId('billing-grace')).toHaveTextContent('2026-10-20');
    expect(screen.queryByTestId('billing-blocked')).not.toBeInTheDocument();
  });
});

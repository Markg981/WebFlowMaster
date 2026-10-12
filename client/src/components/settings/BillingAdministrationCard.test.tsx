import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BillingAdministrationCard from './BillingAdministrationCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : _key),
    i18n: { language: 'en' },
  }),
}));
const request = vi.fn();
vi.mock('@/lib/queryClient', () => ({ apiRequest: (...args: unknown[]) => request(...args) }));

/**
 * The installation administrator's billing: the catalogue, and moving an organization between
 * plans and statuses by hand — the whole of billing when there is no provider.
 */
const freePlan = {
  code: 'free',
  name: 'Free',
  priceMonthMinor: 0,
  priceYearMinor: 0,
  currency: 'eur',
  trialDays: 0,
  active: true,
  quotas: {
    maxConcurrentRuns: null,
    maxQueuedRuns: null,
    maxTests: null,
    maxArtifactBytes: null,
    maxMonthlyExecutionMinutes: null,
  },
  providerPriceIds: {},
};
const teamPlan = {
  ...freePlan,
  code: 'team',
  name: 'Team',
  priceMonthMinor: 4900,
  quotas: { ...freePlan.quotas, maxTests: 500 },
};
const customer = {
  organizationId: 2,
  name: 'Customer',
  subscription: {
    organizationId: 2,
    planCode: 'free',
    status: 'active',
    interval: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    trialEndsAt: null,
    pastDueSince: null,
    provider: 'manual',
    providerCustomerId: null,
    providerSubscriptionId: null,
    suspendedReason: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  entitlement: { runsBlocked: false, reason: null, graceEndsAt: null },
};

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (method: string, url: string) => {
    if (url === '/api/installation/billing/plans' && method === 'GET')
      return { json: async () => ({ items: [freePlan, teamPlan], intervals: ['month', 'year'] }) };
    if (url.startsWith('/api/installation/billing/organizations?'))
      return { json: async () => ({ items: [customer], total: 1 }) };
    if (method === 'PATCH' || method === 'POST') return { json: async () => ({}) };
    throw new Error(`unexpected ${method} ${url}`);
  });
});

function renderCard() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <BillingAdministrationCard />
    </QueryClientProvider>,
  );
}

describe('BillingAdministrationCard', () => {
  it('lists the plans with what they include', async () => {
    renderCard();
    const table = await screen.findByTestId('billing-plans-table');
    await waitFor(() => expect(table).toHaveTextContent('team'));
    expect(table).toHaveTextContent('500');
    expect(table).toHaveTextContent('Inherit');
  });

  it('moves an organization to a plan and a status, with a reason when suspending', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Customer' }));
    const form = await screen.findByTestId('billing-subscription-form');
    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'team' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'suspended' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Contract ended' } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('PATCH', '/api/installation/billing/organizations/2', {
        planCode: 'team',
        status: 'suspended',
        suspendedReason: 'Contract ended',
      }),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('adds a plan to the catalogue', async () => {
    renderCard();
    await screen.findByTestId('billing-plans-table');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'business' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Business' } });
    fireEvent.change(screen.getByLabelText('Monthly price (cents)'), {
      target: { value: '19900' },
    });
    fireEvent.change(screen.getByLabelText('Saved tests'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Provider price id (monthly)'), {
      target: { value: 'price_123' },
    });
    fireEvent.submit(screen.getByTestId('billing-new-plan'));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'POST',
        '/api/installation/billing/plans',
        expect.objectContaining({
          code: 'business',
          name: 'Business',
          priceMonthMinor: 19900,
          quotas: { maxTests: 5000, maxMonthlyExecutionMinutes: null },
          providerPriceIds: { month: 'price_123' },
        }),
      ),
    );
  });
});

import React from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BillingSummary } from '@shared/billing';
import { apiRequest } from '@/lib/queryClient';

/**
 * One line above every page while the organization cannot start runs, or soon will not: a
 * member who presses Run and gets a 402 should already have read why. Silent when there is
 * nothing to say, and silent when billing cannot be read — a banner about a failed request
 * would be noise on every page.
 */
export function SubscriptionBanner() {
  const { t } = useTranslation();
  const { data } = useQuery<BillingSummary>({
    queryKey: ['billing'],
    queryFn: async () => (await apiRequest('GET', '/api/billing')).json(),
    staleTime: 60_000,
    retry: false,
  });
  if (!data) return null;
  const { entitlement, subscription } = data;
  const date = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
  let message: string | null = null;
  if (entitlement.reason === 'suspended')
    message = t(
      'billing.banner.suspended',
      'This organization is suspended: new runs and recordings cannot start. Reports and settings stay available.',
    );
  else if (entitlement.reason === 'cancelled')
    message = t(
      'billing.banner.cancelled',
      'This organization has no active subscription: new runs and recordings cannot start until a plan is chosen.',
    );
  else if (entitlement.reason === 'past_due_grace_expired')
    message = t(
      'billing.banner.pastDueExpired',
      'Payment is overdue and the grace period has ended: new runs cannot start until it is settled.',
    );
  else if (subscription.status === 'past_due' && entitlement.graceEndsAt)
    message = t(
      'billing.banner.pastDue',
      'Payment is overdue. Runs stop on {{date}} unless it is settled.',
      {
        date: date(entitlement.graceEndsAt),
      },
    );
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="subscription-banner"
      className={
        entitlement.runsBlocked
          ? 'border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive'
          : 'border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'
      }
    >
      {message}{' '}
      <Link href="/settings" className="underline">
        {t('billing.banner.settings', 'Billing settings')}
      </Link>
    </div>
  );
}

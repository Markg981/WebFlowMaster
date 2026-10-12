import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BillingInterval, BillingPlan, BillingSummary } from '@shared/billing';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

/**
 * The organization's plan, where it stands and what it uses of what the plan includes.
 *
 * With a provider configured an owner can change plan (a checkout at the provider) and manage
 * what they pay (the provider's portal). Without one — the self-hosted default — the card says
 * so: the installation administrator sets the plan by hand, and a button that led nowhere would
 * be worse than none.
 */

export function formatPrice(minor: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function StatusBadge({ status }: { status: BillingSummary['subscription']['status'] }) {
  const { t } = useTranslation();
  const labels: Record<typeof status, string> = {
    trialing: t('billing.status.trialing', 'Trial'),
    active: t('billing.status.active', 'Active'),
    past_due: t('billing.status.past_due', 'Payment overdue'),
    suspended: t('billing.status.suspended', 'Suspended'),
    cancelled: t('billing.status.cancelled', 'Cancelled'),
  };
  const variant =
    status === 'active' || status === 'trialing'
      ? 'secondary'
      : status === 'past_due'
        ? 'outline'
        : 'destructive';
  return (
    <Badge variant={variant} data-testid="billing-status">
      {labels[status]}
    </Badge>
  );
}

export default function BillingCard() {
  const { t, i18n } = useTranslation();
  const [choosing, setChoosing] = useState(false);
  const [notice, setNotice] = useState('');
  const { data, isLoading, isError } = useQuery<BillingSummary>({
    queryKey: ['billing'],
    queryFn: async () => (await apiRequest('GET', '/api/billing')).json(),
  });
  const plans = useQuery<{ items: BillingPlan[] }>({
    queryKey: ['billingPlans'],
    queryFn: async () => (await apiRequest('GET', '/api/billing/plans')).json(),
    enabled: choosing,
  });
  const go = async (path: string, body?: unknown) => {
    const { url } = (await (await apiRequest('POST', path, body)).json()) as { url: string };
    window.location.assign(url);
  };
  const checkout = useMutation({
    mutationFn: ({ planCode, interval }: { planCode: string; interval: BillingInterval }) =>
      go('/api/billing/checkout', { planCode, interval }),
    onError: () =>
      setNotice(
        t('billing.redirectError', 'The billing provider could not be reached. Try again.'),
      ),
  });
  const portal = useMutation({
    mutationFn: () => go('/api/billing/portal'),
    onError: () =>
      setNotice(
        t('billing.redirectError', 'The billing provider could not be reached. Try again.'),
      ),
  });

  if (isLoading)
    return <p className="text-sm text-muted-foreground">{t('billing.loading', 'Loading…')}</p>;
  if (isError || !data)
    return (
      <p className="text-sm text-destructive">
        {t('billing.error', 'Billing information could not be loaded.')}
      </p>
    );

  const { plan, subscription, entitlement, quotas, usage } = data;
  const date = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');
  const row = (
    label: string,
    used: number,
    limit: number,
    testId: string,
    format: (value: number) => string = String,
  ) => (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span
          className={
            limit > 0 && used >= limit
              ? 'text-amber-700 dark:text-amber-400 font-semibold'
              : 'text-muted-foreground'
          }
        >
          {format(used)} / {limit > 0 ? format(limit) : t('quota.unlimited', 'Unlimited')}
        </span>
      </div>
      <Progress value={limit > 0 ? Math.min(100, (used / limit) * 100) : 0} />
    </div>
  );
  const enforced = quotas.mode === 'enforce';
  const priceLine =
    plan.priceMonthMinor === 0 && plan.priceYearMinor === 0
      ? t('billing.free', 'Free')
      : [
          plan.priceMonthMinor > 0 &&
            t('billing.perMonth', '{{amount}} / month', {
              amount: formatPrice(plan.priceMonthMinor, plan.currency, i18n.language),
            }),
          plan.priceYearMinor > 0 &&
            t('billing.perYear', '{{amount}} / year', {
              amount: formatPrice(plan.priceYearMinor, plan.currency, i18n.language),
            }),
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm text-muted-foreground">{t('billing.plan', 'Plan')}</p>
            <p className="text-lg font-semibold" data-testid="billing-plan">
              {plan.name}
            </p>
            <p className="text-sm text-muted-foreground" data-testid="billing-price">
              {priceLine}
            </p>
          </div>
          <StatusBadge status={subscription.status} />
        </div>

        {entitlement.runsBlocked && (
          <p className="text-sm text-destructive" data-testid="billing-blocked">
            {t(
              'billing.blocked',
              'New runs and recordings are refused until the subscription is restored. Reports, exports and settings stay available.',
            )}
          </p>
        )}
        {subscription.status === 'past_due' &&
          !entitlement.runsBlocked &&
          entitlement.graceEndsAt && (
            <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="billing-grace">
              {t(
                'billing.graceEnds',
                'Payment is overdue. Runs stop on {{date}} unless it is settled.',
                {
                  date: date(entitlement.graceEndsAt),
                },
              )}
            </p>
          )}
        {subscription.suspendedReason && (
          <p className="text-sm text-muted-foreground" data-testid="billing-reason">
            {subscription.suspendedReason}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('billing.period', 'Current period')}</dt>
          <dd data-testid="billing-period">
            {subscription.currentPeriodStart || subscription.currentPeriodEnd
              ? `${date(subscription.currentPeriodStart)} – ${date(subscription.currentPeriodEnd)}`
              : '—'}
          </dd>
          {subscription.status === 'trialing' && (
            <>
              <dt className="text-muted-foreground">{t('billing.trialEnds', 'Trial ends')}</dt>
              <dd data-testid="billing-trial">{date(subscription.trialEndsAt)}</dd>
            </>
          )}
        </dl>

        <div className="space-y-3">
          <p className="text-sm font-medium">
            {t('billing.usageTitle', 'Usage against what the plan includes')}
          </p>
          {row(
            t('runUsage.running', 'Running now'),
            usage.running,
            enforced ? quotas.maxConcurrentRuns : 0,
            'billing-usage-running',
          )}
          {row(
            t('runUsage.queued', 'Waiting in the queue'),
            usage.queued,
            enforced ? quotas.maxQueuedRuns : 0,
            'billing-usage-queued',
          )}
          {row(
            t('quota.tests', 'Saved tests'),
            usage.tests,
            enforced ? quotas.maxTests : 0,
            'billing-usage-tests',
          )}
          {row(
            t('quota.artifacts', 'Retained artifact storage'),
            usage.artifactBytes + usage.reservedArtifactBytes,
            enforced ? quotas.maxArtifactBytes : 0,
            'billing-usage-artifacts',
            (value) => `${(value / 1_048_576).toFixed(2)} MiB`,
          )}
          {row(
            t('quota.resources', 'Monthly execution minutes'),
            Math.round(usage.executionMs / 6000) / 10,
            enforced ? quotas.maxMonthlyExecutionMinutes : 0,
            'billing-usage-minutes',
          )}
          <p className="text-xs text-muted-foreground">
            {t(
              'billing.quotaPrecedence',
              'A limit set by the installation administrator wins over the plan’s; the plan’s wins over the installation default.',
            )}
          </p>
        </div>

        {data.provider === 'none' ? (
          <p className="text-xs text-muted-foreground" data-testid="billing-manual">
            {t(
              'billing.managedByAdmin',
              'Billing is managed by the administrator of this installation: there is no payment provider to pay through.',
            )}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => setChoosing((value) => !value)}
                data-testid="billing-change-plan"
              >
                {t('billing.changePlan', 'Change plan')}
              </Button>
              <Button
                variant="outline"
                onClick={() => portal.mutate()}
                disabled={portal.isPending || !subscription.providerCustomerId}
                data-testid="billing-manage"
              >
                {t('billing.manageBilling', 'Manage billing')}
              </Button>
            </div>
            {choosing && (
              <ul className="space-y-2" data-testid="billing-plan-list">
                {(plans.data?.items ?? [])
                  .filter((item) => item.code !== plan.code)
                  .map((item) => (
                    <li
                      key={item.code}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                    >
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.priceMonthMinor > 0 &&
                            t('billing.perMonth', '{{amount}} / month', {
                              amount: formatPrice(
                                item.priceMonthMinor,
                                item.currency,
                                i18n.language,
                              ),
                            })}
                          {item.priceMonthMinor > 0 && item.priceYearMinor > 0 && ' · '}
                          {item.priceYearMinor > 0 &&
                            t('billing.perYear', '{{amount}} / year', {
                              amount: formatPrice(
                                item.priceYearMinor,
                                item.currency,
                                i18n.language,
                              ),
                            })}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {item.providerPriceIds.month && (
                          <Button
                            size="sm"
                            disabled={checkout.isPending}
                            onClick={() =>
                              checkout.mutate({ planCode: item.code, interval: 'month' })
                            }
                          >
                            {t('billing.interval.month', 'Monthly')}
                          </Button>
                        )}
                        {item.providerPriceIds.year && (
                          <Button
                            size="sm"
                            disabled={checkout.isPending}
                            onClick={() =>
                              checkout.mutate({ planCode: item.code, interval: 'year' })
                            }
                          >
                            {t('billing.interval.year', 'Yearly')}
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            )}
            {notice && (
              <p className="text-sm text-destructive" role="alert">
                {notice}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  SUBSCRIPTION_STATUSES,
  type BillingPlan,
  type OrganizationBillingSummary,
  type SubscriptionStatus,
} from '@shared/billing';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPrice, StatusBadge } from './BillingCard';

/**
 * The installation administrator's billing: the plan catalogue, and each organization's plan
 * and status. The whole of billing without a provider, the override with one.
 */

interface PlanDraft {
  code: string;
  name: string;
  priceMonthMinor: string;
  priceYearMinor: string;
  currency: string;
  trialDays: string;
  maxTests: string;
  maxMonthlyExecutionMinutes: string;
  priceIdMonth: string;
  priceIdYear: string;
}

const emptyPlan: PlanDraft = {
  code: '',
  name: '',
  priceMonthMinor: '0',
  priceYearMinor: '0',
  currency: 'eur',
  trialDays: '0',
  maxTests: '',
  maxMonthlyExecutionMinutes: '',
  priceIdMonth: '',
  priceIdYear: '',
};

const optionalInteger = (value: string) => (value.trim() === '' ? null : Number(value));

export default function BillingAdministrationCard() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<OrganizationBillingSummary>();
  const [planCode, setPlanCode] = useState('');
  const [status, setStatus] = useState<SubscriptionStatus>('active');
  const [reason, setReason] = useState('');
  const [trialEndsAt, setTrialEndsAt] = useState('');
  const [plan, setPlan] = useState<PlanDraft>(emptyPlan);
  const [notice, setNotice] = useState('');

  const plans = useQuery<{ items: BillingPlan[] }>({
    queryKey: ['billingAdminPlans'],
    queryFn: async () => (await apiRequest('GET', '/api/installation/billing/plans')).json(),
  });
  const organizations = useQuery<{ items: OrganizationBillingSummary[]; total: number }>({
    queryKey: ['billingAdminOrganizations', search],
    queryFn: async () =>
      (
        await apiRequest(
          'GET',
          `/api/installation/billing/organizations?search=${encodeURIComponent(search)}&limit=50`,
        )
      ).json(),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['billingAdminOrganizations'] });
    void client.invalidateQueries({ queryKey: ['billingAdminPlans'] });
    void client.invalidateQueries({ queryKey: ['billing'] });
    void client.invalidateQueries({ queryKey: ['organizationUsage'] });
  };
  const failed = () =>
    setNotice(t('billing.admin.saveError', 'The change could not be saved. Check the values.'));

  const saveSubscription = useMutation({
    mutationFn: async () =>
      (
        await apiRequest(
          'PATCH',
          `/api/installation/billing/organizations/${selected!.organizationId}`,
          {
            planCode,
            status,
            suspendedReason: reason.trim() === '' ? null : reason.trim(),
            ...(status === 'trialing' && trialEndsAt
              ? { trialEndsAt: new Date(`${trialEndsAt}T00:00:00Z`).toISOString() }
              : {}),
          },
        )
      ).json(),
    onSuccess: () => {
      setNotice(t('billing.admin.saved', 'Saved.'));
      refresh();
    },
    onError: failed,
  });
  const createPlan = useMutation({
    mutationFn: async () =>
      (
        await apiRequest('POST', '/api/installation/billing/plans', {
          code: plan.code.trim(),
          name: plan.name.trim(),
          priceMonthMinor: Number(plan.priceMonthMinor || 0),
          priceYearMinor: Number(plan.priceYearMinor || 0),
          currency: plan.currency.trim().toLowerCase(),
          trialDays: Number(plan.trialDays || 0),
          quotas: {
            maxTests: optionalInteger(plan.maxTests),
            maxMonthlyExecutionMinutes: optionalInteger(plan.maxMonthlyExecutionMinutes),
          },
          providerPriceIds: {
            ...(plan.priceIdMonth.trim() ? { month: plan.priceIdMonth.trim() } : {}),
            ...(plan.priceIdYear.trim() ? { year: plan.priceIdYear.trim() } : {}),
          },
        })
      ).json(),
    onSuccess: () => {
      setPlan(emptyPlan);
      setNotice(t('billing.admin.saved', 'Saved.'));
      refresh();
    },
    onError: failed,
  });
  const togglePlan = useMutation({
    mutationFn: async (item: BillingPlan) =>
      (
        await apiRequest('PATCH', `/api/installation/billing/plans/${item.code}`, {
          active: !item.active,
        })
      ).json(),
    onSuccess: refresh,
    onError: failed,
  });

  const choose = (item: OrganizationBillingSummary) => {
    setSelected(item);
    setPlanCode(item.subscription.planCode);
    setStatus(item.subscription.status);
    setReason(item.subscription.suspendedReason ?? '');
    setTrialEndsAt(item.subscription.trialEndsAt?.slice(0, 10) ?? '');
    setNotice('');
  };
  const busy = saveSubscription.isPending || createPlan.isPending || togglePlan.isPending;
  const field = (id: keyof PlanDraft, label: string, type = 'text') => (
    <div className="space-y-1">
      <Label htmlFor={`billing-plan-${id}`}>{label}</Label>
      <Input
        id={`billing-plan-${id}`}
        type={type}
        value={plan[id]}
        disabled={busy}
        onChange={(event) => setPlan({ ...plan, [id]: event.target.value })}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('billing.admin.title', 'Billing administration')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <h3 className="font-semibold">{t('billing.admin.plans', 'Plans')}</h3>
          {plans.isError && (
            <p role="alert">{t('billing.admin.loadError', 'Billing data could not be loaded.')}</p>
          )}
          <table className="w-full text-sm" data-testid="billing-plans-table">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2">{t('billing.admin.code', 'Code')}</th>
                <th className="py-1 pr-2">{t('billing.admin.name', 'Name')}</th>
                <th className="py-1 pr-2">{t('billing.admin.price', 'Price')}</th>
                <th className="py-1 pr-2">{t('quota.tests', 'Saved tests')}</th>
                <th className="py-1 pr-2">{t('quota.resources', 'Monthly execution minutes')}</th>
                <th className="py-1 pr-2">{t('billing.admin.active', 'Offered')}</th>
              </tr>
            </thead>
            <tbody>
              {(plans.data?.items ?? []).map((item) => (
                <tr key={item.code} className="border-t">
                  <td className="py-1 pr-2 font-mono">{item.code}</td>
                  <td className="py-1 pr-2">{item.name}</td>
                  <td className="py-1 pr-2">
                    {item.priceMonthMinor === 0 && item.priceYearMinor === 0
                      ? t('billing.free', 'Free')
                      : `${formatPrice(item.priceMonthMinor, item.currency, i18n.language)} / ${formatPrice(item.priceYearMinor, item.currency, i18n.language)}`}
                  </td>
                  <td className="py-1 pr-2">
                    {item.quotas.maxTests ?? t('billing.admin.inherit', 'Inherit')}
                  </td>
                  <td className="py-1 pr-2">
                    {item.quotas.maxMonthlyExecutionMinutes ??
                      t('billing.admin.inherit', 'Inherit')}
                  </td>
                  <td className="py-1 pr-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => togglePlan.mutate(item)}
                    >
                      {item.active ? t('billing.admin.yes', 'Yes') : t('billing.admin.no', 'No')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            className="grid grid-cols-2 gap-3 md:grid-cols-4"
            data-testid="billing-new-plan"
            onSubmit={(event) => {
              event.preventDefault();
              createPlan.mutate();
            }}
          >
            {field('code', t('billing.admin.code', 'Code'))}
            {field('name', t('billing.admin.name', 'Name'))}
            {field(
              'priceMonthMinor',
              t('billing.admin.priceMonth', 'Monthly price (cents)'),
              'number',
            )}
            {field(
              'priceYearMinor',
              t('billing.admin.priceYear', 'Yearly price (cents)'),
              'number',
            )}
            {field('currency', t('billing.admin.currency', 'Currency'))}
            {field('trialDays', t('billing.admin.trialDays', 'Trial days'), 'number')}
            {field('maxTests', t('quota.tests', 'Saved tests'), 'number')}
            {field(
              'maxMonthlyExecutionMinutes',
              t('quota.resources', 'Monthly execution minutes'),
              'number',
            )}
            {field('priceIdMonth', t('billing.admin.priceIdMonth', 'Provider price id (monthly)'))}
            {field('priceIdYear', t('billing.admin.priceIdYear', 'Provider price id (yearly)'))}
            <div className="col-span-2 flex items-end md:col-span-4">
              <Button type="submit" disabled={busy || !plan.code.trim() || !plan.name.trim()}>
                {t('billing.admin.create', 'Add plan')}
              </Button>
            </div>
          </form>
        </section>

        <section className="space-y-3">
          <h3 className="font-semibold">{t('billing.admin.organizations', 'Organizations')}</h3>
          <Label htmlFor="billing-search">{t('quota.search', 'Find an organization')}</Label>
          <Input
            id="billing-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {organizations.data?.items.map((item) => (
              <Button
                key={item.organizationId}
                variant={selected?.organizationId === item.organizationId ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => choose(item)}
              >
                {item.name}
              </Button>
            ))}
          </div>
          {selected && (
            <form
              className="space-y-3"
              data-testid="billing-subscription-form"
              onSubmit={(event) => {
                event.preventDefault();
                saveSubscription.mutate();
              }}
            >
              <div className="flex items-center gap-2">
                <h4 className="font-semibold">{selected.name}</h4>
                <StatusBadge status={selected.subscription.status} />
                {selected.entitlement.runsBlocked && (
                  <span className="text-xs text-destructive">
                    {t('billing.admin.blocked', 'Runs blocked')}
                  </span>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="billing-plan-select">{t('billing.plan', 'Plan')}</Label>
                  <select
                    id="billing-plan-select"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={planCode}
                    disabled={busy}
                    onChange={(event) => setPlanCode(event.target.value)}
                  >
                    {(plans.data?.items ?? []).map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.name} ({item.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="billing-status-select">
                    {t('billing.admin.status', 'Status')}
                  </Label>
                  <select
                    id="billing-status-select"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={status}
                    disabled={busy}
                    onChange={(event) => setStatus(event.target.value as SubscriptionStatus)}
                  >
                    {SUBSCRIPTION_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {t(`billing.status.${value}`, value)}
                      </option>
                    ))}
                  </select>
                </div>
                {status === 'trialing' && (
                  <div className="space-y-1">
                    <Label htmlFor="billing-trial-ends">
                      {t('billing.trialEnds', 'Trial ends')}
                    </Label>
                    <Input
                      id="billing-trial-ends"
                      type="date"
                      value={trialEndsAt}
                      disabled={busy}
                      onChange={(event) => setTrialEndsAt(event.target.value)}
                    />
                  </div>
                )}
                {(status === 'suspended' || status === 'cancelled') && (
                  <div className="space-y-1">
                    <Label htmlFor="billing-reason">{t('billing.admin.reason', 'Reason')}</Label>
                    <Input
                      id="billing-reason"
                      value={reason}
                      disabled={busy}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </div>
                )}
              </div>
              <Button type="submit" disabled={busy}>
                {t('billing.admin.save', 'Save')}
              </Button>
            </form>
          )}
          {notice && <p className="text-sm">{notice}</p>}
          <p className="text-xs text-muted-foreground">
            {t(
              'billing.admin.help',
              'Suspended and cancelled organizations, and overdue ones past the grace period, cannot start runs; their reports and settings stay reachable. Every change is written to the billing ledger and the organization’s audit log.',
            )}
          </p>
        </section>
      </CardContent>
    </Card>
  );
}

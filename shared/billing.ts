import type { TenantQuotas, QuotaOverrides, QuotaUsage } from './tenant-quotas';

/**
 * Billing: plans, subscriptions and what they entitle an organization to.
 *
 * The model is provider-agnostic. A plan is the installation's (every organization sees the same
 * catalogue); a subscription is an organization's (one row each, RLS-scoped like the rest). The
 * provider — Stripe, or nobody in the self-hosted default — moves the subscription between the
 * statuses below; the application decides what each status allows. See docs/en/admin/administration.md
 * ("Billing").
 */

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const BILLING_PROVIDERS = ['none', 'stripe'] as const;
export type BillingProviderName = (typeof BILLING_PROVIDERS)[number];

/** The plan every organization starts on, seeded by migration 0087 with the installation defaults. */
export const FREE_PLAN_CODE = 'free';

/** Quotas a plan includes: null defers to the installation default, like an unset override. */
export type PlanQuotas = Omit<QuotaOverrides, 'mode'>;

export interface BillingPlan {
  code: string;
  name: string;
  /** Minor units (cents) for one period of each interval; 0 is free. */
  priceMonthMinor: number;
  priceYearMinor: number;
  /** ISO 4217, lowercase as Stripe writes it. */
  currency: string;
  trialDays: number;
  active: boolean;
  quotas: PlanQuotas;
  /** The provider's price identifiers for each interval, when a provider sells this plan. */
  providerPriceIds: Partial<Record<BillingInterval, string>>;
}

export interface OrganizationSubscription {
  organizationId: number;
  planCode: string;
  status: SubscriptionStatus;
  interval: BillingInterval | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  /** When the status became past_due: the grace period counts from here. */
  pastDueSince: string | null;
  provider: BillingProviderName | 'manual';
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  suspendedReason: string | null;
  updatedAt: string;
}

/** What the subscription allows right now, as the enforcement point and the banner both read it. */
export interface Entitlement {
  /** Starting runs and recordings is refused. Reading, exporting and settings never are. */
  runsBlocked: boolean;
  /** Why, when blocked: the status that blocks, or past_due past its grace. */
  reason: 'suspended' | 'cancelled' | 'past_due_grace_expired' | null;
  /** For a past_due subscription: when the grace period ends and runs stop. */
  graceEndsAt: string | null;
}

/** GET /api/billing: the owner's view, and the banner's. */
export interface BillingSummary {
  provider: BillingProviderName;
  plan: BillingPlan;
  subscription: OrganizationSubscription;
  entitlement: Entitlement;
  /** The limits in force: an installation administrator's override wins over the plan's. */
  quotas: TenantQuotas;
  usage: QuotaUsage & { running: number; queued: number };
  pastDueGraceDays: number;
}

/** What an installation administrator sees per organization. */
export interface OrganizationBillingSummary {
  organizationId: number;
  name: string;
  subscription: OrganizationSubscription;
  entitlement: Entitlement;
}

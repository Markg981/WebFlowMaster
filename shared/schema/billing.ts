/** Plans, subscriptions and the billing ledger (migration 0087). See shared/billing.ts. */
import {
  pgTable,
  text,
  integer,
  bigint,
  serial,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations } from './identity';
import type { BillingInterval, BillingProviderName, SubscriptionStatus } from '../billing';

/**
 * The installation's plan catalogue: not tenant-scoped, every organization sees the same plans.
 * The quota columns name the same limits an organization's row can override (organizations.*):
 * null means the installation default. app_user may read the catalogue and change nothing; plans
 * are the installation administrator's (server/tenancy/billing/service.ts).
 */
export const billingPlans = pgTable('billing_plans', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  priceMonthMinor: bigint('price_month_minor', { mode: 'number' }).notNull().default(0),
  priceYearMinor: bigint('price_year_minor', { mode: 'number' }).notNull().default(0),
  currency: text('currency').notNull().default('eur'),
  trialDays: integer('trial_days').notNull().default(0),
  active: boolean('active').notNull().default(true),
  maxConcurrentRuns: integer('max_concurrent_runs'),
  maxQueuedRuns: integer('max_queued_runs'),
  maxTests: bigint('max_tests', { mode: 'number' }),
  maxArtifactBytes: bigint('max_artifact_bytes', { mode: 'number' }),
  maxMonthlyExecutionMinutes: bigint('max_monthly_execution_minutes', { mode: 'number' }),
  /** `{ "month": "price_…", "year": "price_…" }` at the provider, when one sells this plan. */
  providerPriceIds: jsonb('provider_price_ids')
    .$type<Partial<Record<BillingInterval, string>>>()
    .notNull()
    .default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * One organization's subscription: which plan, in which state, with which provider. Exactly one
 * row per organization — a trigger on organizations gives a new one the free plan. RLS-scoped
 * like the rest; app_user may read its own and change nothing: statuses move through the
 * provider's webhooks, the installation administrator and the daily sweep, all privileged.
 */
export const organizationSubscriptions = pgTable(
  'organization_subscriptions',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    planCode: text('plan_code')
      .notNull()
      .references(() => billingPlans.code),
    status: text('status').$type<SubscriptionStatus>().notNull().default('active'),
    interval: text('interval').$type<BillingInterval>(),
    currentPeriodStart: timestamp('current_period_start'),
    currentPeriodEnd: timestamp('current_period_end'),
    trialEndsAt: timestamp('trial_ends_at'),
    pastDueSince: timestamp('past_due_since'),
    provider: text('provider').$type<BillingProviderName | 'manual'>().notNull().default('manual'),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    suspendedReason: text('suspended_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('organization_subscriptions_organization_unique').on(table.organizationId),
    index('organization_subscriptions_provider_subscription_idx').on(table.providerSubscriptionId),
  ],
);

/**
 * Append-only: every provider webhook accepted and every manual or scheduled change, each under
 * an idempotency key (the provider's event id, or one made of the action and the moment). A key
 * seen twice is a replay and changes nothing. Privileged only: app_user has no grant at all.
 */
export const billingEvents = pgTable(
  'billing_events',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    /** `webhook`, `manual` or `sweep`. */
    source: text('source').notNull(),
    provider: text('provider').notNull(),
    /** The provider's event type, or the action: `admin.subscription_updated`, `sweep.suspended`… */
    type: text('type').notNull(),
    actor: text('actor'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('billing_events_organization_idx').on(table.organizationId, table.createdAt)],
);

export type BillingPlanRow = typeof billingPlans.$inferSelect;
export type OrganizationSubscriptionRow = typeof organizationSubscriptions.$inferSelect;
export type BillingEventRow = typeof billingEvents.$inferSelect;

import { and, asc, eq, ilike, inArray, lte, sql } from 'drizzle-orm';
import {
  auditLog,
  billingEvents,
  billingPlans,
  organizationMemberships,
  organizationSubscriptions,
  organizations,
  users,
  type BillingPlanRow,
  type OrganizationSubscriptionRow,
} from '@shared/schema';
import {
  FREE_PLAN_CODE,
  type BillingInterval,
  type BillingPlan,
  type BillingSummary,
  type Entitlement,
  type OrganizationBillingSummary,
  type OrganizationSubscription,
  type PlanQuotas,
  type SubscriptionStatus,
} from '@shared/billing';
import type { AuditActor } from '../audit';
import { privilegedDb } from '../../platform/db';
import type { TenantTx } from '../../platform/middleware/tenancy';
import {
  runDetachedForOrganization,
  withTenantTransaction,
} from '../../platform/middleware/tenancy';
import { liveRunCounts, quotaUsage, quotasFor } from '../tenant-quotas';
import { billingConfig } from './config';
import { BillingError, type BillingProvider, type BillingWebhookEvent } from './provider';
import { billingProvider } from './providers';

/**
 * Plans, subscriptions and the ledger (migration 0087).
 *
 * Privileged on purpose, like server/tenancy/tenant-quota-admin.ts: a subscription is moved by the
 * provider's webhook (no request, no tenant), by the installation administrator (acting on an
 * organization that is not theirs) and by the daily sweep. What an organization's own members
 * do here — read their plan, start a checkout — runs inside their tenant context as usual.
 *
 * Every change writes two rows in the same transaction: a billing_events row under an
 * idempotency key, which is what makes a replayed webhook harmless, and the organization's
 * audit entry, which is what its owners can see.
 */

const DAY_MS = 24 * 60 * 60_000;

export type BillingSource = 'webhook' | 'manual' | 'sweep';

export interface PlanInput {
  code: string;
  name: string;
  priceMonthMinor?: number;
  priceYearMinor?: number;
  currency?: string;
  trialDays?: number;
  active?: boolean;
  quotas?: Partial<PlanQuotas>;
  providerPriceIds?: Partial<Record<BillingInterval, string>>;
}

export interface SubscriptionPatch {
  planCode?: string;
  status?: SubscriptionStatus;
  suspendedReason?: string | null;
  trialEndsAt?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  interval?: BillingInterval | null;
  provider?: 'manual' | 'stripe';
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
}

export function publicPlan(row: BillingPlanRow): BillingPlan {
  return {
    code: row.code,
    name: row.name,
    priceMonthMinor: row.priceMonthMinor,
    priceYearMinor: row.priceYearMinor,
    currency: row.currency,
    trialDays: row.trialDays,
    active: row.active,
    quotas: {
      maxConcurrentRuns: row.maxConcurrentRuns,
      maxQueuedRuns: row.maxQueuedRuns,
      maxTests: row.maxTests,
      maxArtifactBytes: row.maxArtifactBytes,
      maxMonthlyExecutionMinutes: row.maxMonthlyExecutionMinutes,
    },
    providerPriceIds: row.providerPriceIds ?? {},
  };
}

export function publicSubscription(row: OrganizationSubscriptionRow): OrganizationSubscription {
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  return {
    organizationId: row.organizationId,
    planCode: row.planCode,
    status: row.status,
    interval: row.interval,
    currentPeriodStart: iso(row.currentPeriodStart),
    currentPeriodEnd: iso(row.currentPeriodEnd),
    trialEndsAt: iso(row.trialEndsAt),
    pastDueSince: iso(row.pastDueSince),
    provider: row.provider,
    providerCustomerId: row.providerCustomerId,
    providerSubscriptionId: row.providerSubscriptionId,
    suspendedReason: row.suspendedReason,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * What a subscription allows now. Computed, not stored: a past_due subscription stops starting
 * runs the moment its grace runs out, whether or not the sweep has come round to mark it
 * suspended. No row at all — an organization older than the trigger, in a test — is the free
 * plan, allowed.
 */
export function entitlementOf(
  subscription: Pick<OrganizationSubscriptionRow, 'status' | 'pastDueSince' | 'updatedAt'> | null,
  graceDays: number,
  now = new Date(),
): Entitlement {
  if (!subscription) return { runsBlocked: false, reason: null, graceEndsAt: null };
  if (subscription.status === 'suspended')
    return { runsBlocked: true, reason: 'suspended', graceEndsAt: null };
  if (subscription.status === 'cancelled')
    return { runsBlocked: true, reason: 'cancelled', graceEndsAt: null };
  if (subscription.status === 'past_due') {
    const since = subscription.pastDueSince ?? subscription.updatedAt;
    const graceEndsAt = new Date(since.getTime() + graceDays * DAY_MS);
    return {
      runsBlocked: now.getTime() >= graceEndsAt.getTime(),
      reason: now.getTime() >= graceEndsAt.getTime() ? 'past_due_grace_expired' : null,
      graceEndsAt: graceEndsAt.toISOString(),
    };
  }
  return { runsBlocked: false, reason: null, graceEndsAt: null };
}

// ─── Plans ───

export async function listPlans(activeOnly: boolean): Promise<BillingPlan[]> {
  const rows = await privilegedDb
    .select()
    .from(billingPlans)
    .where(activeOnly ? eq(billingPlans.active, true) : undefined)
    .orderBy(asc(billingPlans.priceMonthMinor), asc(billingPlans.code));
  return rows.map(publicPlan);
}

async function planRow(code: string): Promise<BillingPlanRow | undefined> {
  const [row] = await privilegedDb.select().from(billingPlans).where(eq(billingPlans.code, code));
  return row;
}

export async function createPlan(input: PlanInput): Promise<BillingPlan> {
  if (await planRow(input.code))
    throw new BillingError(409, 'plan_exists', `A plan with code "${input.code}" exists.`);
  const [row] = await privilegedDb
    .insert(billingPlans)
    .values({
      code: input.code,
      name: input.name,
      priceMonthMinor: input.priceMonthMinor ?? 0,
      priceYearMinor: input.priceYearMinor ?? 0,
      currency: input.currency ?? 'eur',
      trialDays: input.trialDays ?? 0,
      active: input.active ?? true,
      maxConcurrentRuns: input.quotas?.maxConcurrentRuns ?? null,
      maxQueuedRuns: input.quotas?.maxQueuedRuns ?? null,
      maxTests: input.quotas?.maxTests ?? null,
      maxArtifactBytes: input.quotas?.maxArtifactBytes ?? null,
      maxMonthlyExecutionMinutes: input.quotas?.maxMonthlyExecutionMinutes ?? null,
      providerPriceIds: input.providerPriceIds ?? {},
    })
    .returning();
  return publicPlan(row);
}

export async function updatePlan(
  code: string,
  patch: Partial<Omit<PlanInput, 'code'>>,
): Promise<BillingPlan> {
  const current = await planRow(code);
  if (!current) throw new BillingError(404, 'plan_not_found', 'Plan not found.');
  const quotas = patch.quotas ?? {};
  const [row] = await privilegedDb
    .update(billingPlans)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.priceMonthMinor !== undefined ? { priceMonthMinor: patch.priceMonthMinor } : {}),
      ...(patch.priceYearMinor !== undefined ? { priceYearMinor: patch.priceYearMinor } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.trialDays !== undefined ? { trialDays: patch.trialDays } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...('maxConcurrentRuns' in quotas ? { maxConcurrentRuns: quotas.maxConcurrentRuns } : {}),
      ...('maxQueuedRuns' in quotas ? { maxQueuedRuns: quotas.maxQueuedRuns } : {}),
      ...('maxTests' in quotas ? { maxTests: quotas.maxTests } : {}),
      ...('maxArtifactBytes' in quotas ? { maxArtifactBytes: quotas.maxArtifactBytes } : {}),
      ...('maxMonthlyExecutionMinutes' in quotas
        ? { maxMonthlyExecutionMinutes: quotas.maxMonthlyExecutionMinutes }
        : {}),
      ...(patch.providerPriceIds !== undefined ? { providerPriceIds: patch.providerPriceIds } : {}),
      updatedAt: new Date(),
    })
    .where(eq(billingPlans.code, code))
    .returning();
  return publicPlan(row);
}

/** The plan a provider price belongs to, by the catalogue's provider_price_ids. */
async function planForPrice(priceId: string): Promise<BillingPlanRow | undefined> {
  const rows = await privilegedDb.select().from(billingPlans);
  return rows.find((row) => Object.values(row.providerPriceIds ?? {}).includes(priceId));
}

// ─── Subscriptions ───

/** The organization's own subscription, inside its tenant transaction. */
export async function subscriptionFor(
  tx: TenantTx,
  organizationId: number,
): Promise<OrganizationSubscriptionRow | null> {
  const [row] = await tx
    .select()
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

async function privilegedSubscription(
  organizationId: number,
): Promise<OrganizationSubscriptionRow | undefined> {
  const [row] = await privilegedDb
    .select()
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, organizationId));
  return row;
}

/** GET /api/billing: the plan, the status, the limits in force and what is used of them. */
export async function billingSummary(
  organizationId: number,
  now = new Date(),
): Promise<BillingSummary> {
  const config = billingConfig();
  return runDetachedForOrganization(organizationId, () =>
    withTenantTransaction(async (tx) => {
      const subscription = await subscriptionFor(tx, organizationId);
      if (!subscription)
        throw new BillingError(
          404,
          'subscription_not_found',
          'This organization has no subscription.',
        );
      const [plan] = await tx
        .select()
        .from(billingPlans)
        .where(eq(billingPlans.code, subscription.planCode));
      const [quotas, usage, runs] = await Promise.all([
        quotasFor(tx, organizationId),
        quotaUsage(tx, organizationId, now),
        liveRunCounts(tx, organizationId),
      ]);
      return {
        provider: config.provider,
        plan: publicPlan(plan),
        subscription: publicSubscription(subscription),
        entitlement: entitlementOf(subscription, config.pastDueGraceDays, now),
        quotas,
        usage: { ...usage, ...runs },
        pastDueGraceDays: config.pastDueGraceDays,
      };
    }),
  );
}

/** The installation administrator's overview. */
export async function listOrganizationBilling(
  search: string,
  limit: number,
  offset: number,
  now = new Date(),
): Promise<{ items: OrganizationBillingSummary[]; total: number; limit: number; offset: number }> {
  const config = billingConfig();
  const filter = search
    ? ilike(organizations.name, `%${search.replace(/[\\%_]/g, '\\$&')}%`)
    : undefined;
  const rows = await privilegedDb
    .select({ organization: organizations, subscription: organizationSubscriptions })
    .from(organizations)
    .innerJoin(
      organizationSubscriptions,
      eq(organizationSubscriptions.organizationId, organizations.id),
    )
    .where(filter)
    .orderBy(asc(organizations.id))
    .limit(limit)
    .offset(offset);
  const [total] = await privilegedDb
    .select({ count: sql<number>`count(*)::int` })
    .from(organizations)
    .where(filter);
  return {
    items: rows.map(({ organization, subscription }) => ({
      organizationId: organization.id,
      name: organization.name,
      subscription: publicSubscription(subscription),
      entitlement: entitlementOf(subscription, config.pastDueGraceDays, now),
    })),
    total: total?.count ?? 0,
    limit,
    offset,
  };
}

interface ChangeOptions {
  source: BillingSource;
  /** The provider's event id, or a key made of the action and the moment. */
  idempotencyKey: string;
  type: string;
  actor: AuditActor | null;
  provider: string;
  payload?: Record<string, unknown>;
  now?: Date;
}

/**
 * Moves one organization's subscription, writing the ledger and the audit entry with it. The
 * idempotency key is checked first: a key already in the ledger changes nothing and says so.
 */
export async function changeSubscription(
  organizationId: number,
  patch: SubscriptionPatch,
  options: ChangeOptions,
): Promise<{ subscription: OrganizationSubscription; duplicate: boolean }> {
  const now = options.now ?? new Date();
  return privilegedDb.transaction(async (tx) => {
    const recorded = await tx
      .insert(billingEvents)
      .values({
        organizationId,
        idempotencyKey: options.idempotencyKey,
        source: options.source,
        provider: options.provider,
        type: options.type,
        actor: options.actor?.username ?? null,
        payload: options.payload ?? { patch: serializable(patch) },
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();
    const [current] = await tx
      .select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, organizationId))
      .for('update');
    if (!current)
      throw new BillingError(
        404,
        'subscription_not_found',
        'This organization has no subscription.',
      );
    if (recorded.length === 0)
      return { subscription: publicSubscription(current), duplicate: true };

    if (patch.planCode !== undefined && patch.planCode !== current.planCode) {
      // Through the transaction, not beside it: under PGlite a second query waits for ever.
      const [plan] = await tx
        .select({ code: billingPlans.code })
        .from(billingPlans)
        .where(eq(billingPlans.code, patch.planCode));
      if (!plan) throw new BillingError(404, 'plan_not_found', 'Plan not found.');
    }
    const status = patch.status ?? current.status;
    const next = {
      planCode: patch.planCode ?? current.planCode,
      status,
      interval: patch.interval !== undefined ? patch.interval : current.interval,
      currentPeriodStart:
        patch.currentPeriodStart !== undefined
          ? patch.currentPeriodStart
          : current.currentPeriodStart,
      currentPeriodEnd:
        patch.currentPeriodEnd !== undefined ? patch.currentPeriodEnd : current.currentPeriodEnd,
      trialEndsAt: patch.trialEndsAt !== undefined ? patch.trialEndsAt : current.trialEndsAt,
      // The grace period counts from the first moment the subscription was past due, and is
      // forgotten as soon as it no longer is.
      pastDueSince:
        status === 'past_due' ? (current.status === 'past_due' ? current.pastDueSince : now) : null,
      provider: patch.provider ?? current.provider,
      providerCustomerId:
        patch.providerCustomerId !== undefined
          ? patch.providerCustomerId
          : current.providerCustomerId,
      providerSubscriptionId:
        patch.providerSubscriptionId !== undefined
          ? patch.providerSubscriptionId
          : current.providerSubscriptionId,
      suspendedReason:
        status === 'suspended' || status === 'cancelled'
          ? patch.suspendedReason !== undefined
            ? patch.suspendedReason
            : current.suspendedReason
          : null,
      updatedAt: now,
    };
    const [updated] = await tx
      .update(organizationSubscriptions)
      .set(next)
      .where(eq(organizationSubscriptions.organizationId, organizationId))
      .returning();
    await tx.insert(auditLog).values({
      organizationId,
      actorUserId: options.actor?.id ?? null,
      actorUsername: options.actor?.username ?? null,
      apiKeyId: options.actor?.apiKeyId ?? null,
      ipAddress: options.actor?.ipAddress ?? null,
      action: 'organization.billing_updated',
      targetType: 'organization',
      targetId: String(organizationId),
      metadata: {
        source: options.source,
        type: options.type,
        before: { planCode: current.planCode, status: current.status },
        after: { planCode: updated.planCode, status: updated.status },
      },
    });
    return { subscription: publicSubscription(updated), duplicate: false };
  });
}

function serializable(patch: SubscriptionPatch): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}

/**
 * The installation administrator's change: a plan, a status, a reason. A subscription the
 * provider holds and the administrator cancels is cancelled there too, so the provider stops
 * charging; the provider's own message about it then finds the ledger already knows.
 */
export async function administerSubscription(
  organizationId: number,
  patch: Pick<
    SubscriptionPatch,
    'planCode' | 'status' | 'suspendedReason' | 'trialEndsAt' | 'currentPeriodEnd'
  >,
  actor: AuditActor,
  provider: BillingProvider = billingProvider(),
  now = new Date(),
): Promise<OrganizationSubscription> {
  const current = await privilegedSubscription(organizationId);
  if (!current) throw new BillingError(404, 'organization_not_found', 'Organization not found.');
  if (
    patch.status === 'cancelled' &&
    current.providerSubscriptionId &&
    current.provider === 'stripe'
  )
    await provider.cancel(current.providerSubscriptionId);
  const { subscription } = await changeSubscription(organizationId, patch, {
    source: 'manual',
    provider: current.provider,
    type: 'admin.subscription_updated',
    idempotencyKey: `manual:${organizationId}:${now.toISOString()}:${actor.username}`,
    actor,
    now,
  });
  return subscription;
}

// ─── The provider's messages ───

export interface WebhookOutcome {
  organizationId: number | null;
  applied: boolean;
  duplicate: boolean;
  /** Why nothing was applied: the organization or plan could not be told, or the type says nothing. */
  ignored?: string;
}

async function organizationOfEvent(event: BillingWebhookEvent): Promise<number | null> {
  if (event.organizationId) return event.organizationId;
  if (event.subscriptionId) {
    const [bySubscription] = await privilegedDb
      .select({ organizationId: organizationSubscriptions.organizationId })
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.providerSubscriptionId, event.subscriptionId));
    if (bySubscription) return bySubscription.organizationId;
  }
  if (event.customerId) {
    const [byCustomer] = await privilegedDb
      .select({ organizationId: organizationSubscriptions.organizationId })
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.providerCustomerId, event.customerId));
    if (byCustomer) return byCustomer.organizationId;
  }
  return null;
}

/** Records the message and moves the subscription as it says; a replay records nothing twice. */
export async function applyWebhookEvent(
  event: BillingWebhookEvent,
  providerName: string,
  now = new Date(),
): Promise<WebhookOutcome> {
  const organizationId = await organizationOfEvent(event);
  const ledger = {
    source: 'webhook' as const,
    provider: providerName,
    type: event.type,
    idempotencyKey: `${providerName}:${event.id}`,
    actor: null,
    payload: event.payload,
    now,
  };
  if (!organizationId) {
    // Nothing of ours: remembered, so a replay is still a replay, and nothing moves.
    const recorded = await privilegedDb
      .insert(billingEvents)
      .values({ organizationId: null, ...ledger, createdAt: now })
      .onConflictDoNothing()
      .returning();
    return {
      organizationId: null,
      applied: false,
      duplicate: recorded.length === 0,
      ignored: 'unknown_organization',
    };
  }
  const patch: SubscriptionPatch = {
    provider: 'stripe',
    ...(event.customerId ? { providerCustomerId: event.customerId } : {}),
    ...(event.subscriptionId ? { providerSubscriptionId: event.subscriptionId } : {}),
    ...(event.interval ? { interval: event.interval } : {}),
    ...(event.currentPeriodStart ? { currentPeriodStart: event.currentPeriodStart } : {}),
    ...(event.currentPeriodEnd ? { currentPeriodEnd: event.currentPeriodEnd } : {}),
    ...(event.trialEndsAt ? { trialEndsAt: event.trialEndsAt } : {}),
  };
  if (event.priceId) {
    const plan = await planForPrice(event.priceId);
    if (plan) patch.planCode = plan.code;
  } else {
    const metadata = (event.payload.data as { object?: { metadata?: { planCode?: unknown } } })
      ?.object?.metadata;
    if (typeof metadata?.planCode === 'string' && (await planRow(metadata.planCode)))
      patch.planCode = metadata.planCode;
  }
  if (event.status === 'cancelled') {
    // A paid subscription that ended returns the organization to the free plan, when the
    // catalogue still offers one; otherwise it is cancelled, which stops runs until somebody acts.
    const free = await planRow(FREE_PLAN_CODE);
    if (free?.active) {
      patch.planCode = FREE_PLAN_CODE;
      patch.status = 'active';
      patch.providerSubscriptionId = null;
      patch.interval = null;
      patch.currentPeriodStart = null;
      patch.currentPeriodEnd = null;
      patch.trialEndsAt = null;
    } else {
      patch.status = 'cancelled';
      patch.suspendedReason = 'The subscription was cancelled at the provider.';
    }
  } else if (event.status) {
    patch.status = event.status;
    if (event.status === 'suspended')
      patch.suspendedReason = 'The provider reported the subscription unpaid.';
  }
  const { duplicate } = await changeSubscription(organizationId, patch, ledger);
  return { organizationId, applied: !duplicate, duplicate };
}

// ─── Checkout and portal ───

export interface CheckoutRequest {
  organizationId: number;
  planCode: string;
  interval: BillingInterval;
  userId: number;
  baseUrl: string;
}

export async function startCheckout(
  input: CheckoutRequest,
  provider: BillingProvider = billingProvider(),
): Promise<{ url: string }> {
  const plan = await planRow(input.planCode);
  if (!plan || !plan.active)
    throw new BillingError(404, 'plan_not_found', 'This plan is not offered.');
  const subscription = await privilegedSubscription(input.organizationId);
  if (!subscription)
    throw new BillingError(404, 'subscription_not_found', 'This organization has no subscription.');
  const [owner] = await privilegedDb
    .select({ username: users.username })
    .from(users)
    .innerJoin(organizationMemberships, eq(organizationMemberships.userId, users.id))
    .where(
      and(
        eq(users.id, input.userId),
        eq(organizationMemberships.organizationId, input.organizationId),
      ),
    );
  const email = owner?.username.includes('@') ? owner.username : null;
  return provider.createCheckoutSession({
    organizationId: input.organizationId,
    plan: publicPlan(plan),
    interval: input.interval,
    customerId: subscription.providerCustomerId,
    customerEmail: email,
    successUrl: `${input.baseUrl}/settings?billing=success`,
    cancelUrl: `${input.baseUrl}/settings?billing=cancelled`,
  });
}

export async function openPortal(
  organizationId: number,
  baseUrl: string,
  provider: BillingProvider = billingProvider(),
): Promise<{ url: string }> {
  const subscription = await privilegedSubscription(organizationId);
  if (!subscription?.providerCustomerId)
    throw new BillingError(
      409,
      'no_provider_customer',
      'This organization has not paid through the billing provider yet, so there is nothing to manage there.',
    );
  return provider.createPortalSession({
    customerId: subscription.providerCustomerId,
    returnUrl: `${baseUrl}/settings`,
  });
}

// ─── The daily sweep ───

export interface SweepReport {
  suspended: number[];
  trialsEnded: number[];
}

/**
 * Twice a day, what time alone changes: a past_due subscription past its grace is suspended, and
 * a trial the installation administrator set by hand that has run out becomes past_due — the
 * administrator (or a payment) must act before the grace runs out too. Trials the provider
 * holds are the provider's: its messages end them.
 */
export async function sweepSubscriptions(now = new Date()): Promise<SweepReport> {
  const config = billingConfig();
  const report: SweepReport = { suspended: [], trialsEnded: [] };
  const overdue = await privilegedDb
    .select()
    .from(organizationSubscriptions)
    .where(
      and(
        eq(organizationSubscriptions.status, 'past_due'),
        lte(
          organizationSubscriptions.pastDueSince,
          new Date(now.getTime() - config.pastDueGraceDays * DAY_MS),
        ),
      ),
    );
  for (const row of overdue) {
    const { duplicate } = await changeSubscription(
      row.organizationId,
      { status: 'suspended', suspendedReason: 'Payment overdue beyond the grace period.' },
      {
        source: 'sweep',
        provider: row.provider,
        type: 'sweep.suspended',
        idempotencyKey: `sweep:suspend:${row.organizationId}:${row.pastDueSince?.toISOString()}`,
        actor: null,
        now,
      },
    );
    if (!duplicate) report.suspended.push(row.organizationId);
  }
  const expiredTrials = await privilegedDb
    .select()
    .from(organizationSubscriptions)
    .where(
      and(
        eq(organizationSubscriptions.status, 'trialing'),
        inArray(organizationSubscriptions.provider, ['manual']),
        lte(organizationSubscriptions.trialEndsAt, now),
      ),
    );
  for (const row of expiredTrials) {
    const { duplicate } = await changeSubscription(
      row.organizationId,
      { status: 'past_due', trialEndsAt: row.trialEndsAt },
      {
        source: 'sweep',
        provider: row.provider,
        type: 'sweep.trial_ended',
        idempotencyKey: `sweep:trial:${row.organizationId}:${row.trialEndsAt?.toISOString()}`,
        actor: null,
        now,
      },
    );
    if (!duplicate) report.trialsEnded.push(row.organizationId);
  }
  return report;
}

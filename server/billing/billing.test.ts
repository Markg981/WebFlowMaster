import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { billingEvents, organizationSubscriptions, organizations, auditLog } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { runWithTenant, withTenantTransaction } from '../middleware/tenancy';
import { quotasFor } from '../tenant-quotas';
import {
  administerSubscription,
  applyWebhookEvent,
  changeSubscription,
  createPlan,
  entitlementOf,
  startCheckout,
  sweepSubscriptions,
} from './service';
import { parseStripeEvent } from './stripe';
import { stripeFixture as fixture } from './stripe-fixtures';
import type { BillingProvider } from './provider';

/**
 * The billing model under the migration: every organization on the free plan, a plan's limits
 * between the administrator's override and the installation default, statuses that mean what
 * the documentation says, and a ledger that forgets nothing and repeats nothing.
 */

const actor = { id: 0, username: 'operator' };

beforeAll(async () => {
  // audit_log names the actor by foreign key: a real account, in an organization of its own.
  actor.id = await createTestUser(
    await createTestOrganization('Operators'),
    `operator-${Date.now()}`,
  );
});
afterEach(() => vi.unstubAllEnvs());

describe('migration 0087', () => {
  it('gives every organization an active subscription to the free plan, old and new alike', async () => {
    const before = await createTestOrganization('Backfilled');
    const rows = await privilegedDb.execute(sql`
      SELECT o.id, s.plan_code, s.status FROM organizations o
      LEFT JOIN organization_subscriptions s ON s.organization_id = o.id`);
    for (const row of rows.rows as Array<{ id: number; plan_code: string; status: string }>) {
      expect(row.plan_code, `organization ${row.id}`).toBe('free');
      expect(row.status, `organization ${row.id}`).toBe('active');
    }
    expect(rows.rows.map((row) => Number((row as { id: number }).id))).toContain(before);
  });

  it('keeps the ledger and the catalogue out of the application role’s hands', async () => {
    const grants = await privilegedDb.execute(sql`
      SELECT table_name, privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'app_user' AND table_name IN ('billing_plans','organization_subscriptions','billing_events')`);
    const have = new Set(
      (grants.rows as Array<{ table_name: string; privilege_type: string }>).map(
        (row) => `${row.table_name}:${row.privilege_type}`,
      ),
    );
    expect(have).toEqual(new Set(['billing_plans:SELECT', 'organization_subscriptions:SELECT']));
  });
});

describe('quota precedence', () => {
  let organizationId: number;
  beforeEach(async () => {
    organizationId = await createTestOrganization('Precedence');
    await createPlan({
      code: `plan-${organizationId}`,
      name: 'Plan',
      quotas: { maxTests: 50, maxQueuedRuns: 7 },
    }).catch(() => undefined);
  });

  it('applies the plan’s limits over the installation default, and the administrator’s override over both', async () => {
    vi.stubEnv('ORG_MAX_TESTS', '0');
    vi.stubEnv('ORG_MAX_QUEUED_RUNS', '100');
    const read = () =>
      runWithTenant(organizationId, () =>
        withTenantTransaction((tx) => quotasFor(tx, organizationId)),
      );
    const onFree = await read();
    expect(onFree.maxTests).toBe(0);
    expect(onFree.maxQueuedRuns).toBe(100);

    await changeSubscription(
      organizationId,
      { planCode: `plan-${organizationId}` },
      {
        source: 'manual',
        provider: 'manual',
        type: 'test',
        idempotencyKey: `t-${organizationId}-plan`,
        actor,
      },
    );
    const onPlan = await read();
    expect(onPlan.maxTests).toBe(50);
    expect(onPlan.maxQueuedRuns).toBe(7);
    expect(onPlan.maxConcurrentRuns).toBe(2);

    await privilegedDb
      .update(organizations)
      .set({ maxTests: 3 })
      .where(eq(organizations.id, organizationId));
    const overridden = await read();
    expect(overridden.maxTests).toBe(3);
    expect(overridden.maxQueuedRuns).toBe(7);
  });

  it('is the same precedence inside the database trigger that caps saved tests', async () => {
    const userId = await createTestUser(organizationId);
    await changeSubscription(
      organizationId,
      { planCode: `plan-${organizationId}` },
      {
        source: 'manual',
        provider: 'manual',
        type: 'test',
        idempotencyKey: `t-${organizationId}-trigger`,
        actor,
      },
    );
    await privilegedDb
      .update(organizations)
      .set({ maxTests: 1 })
      .where(eq(organizations.id, organizationId));
    const insert = (name: string) =>
      privilegedDb.execute(
        sql`INSERT INTO tests (name, url, sequence, elements, user_id, organization_id)
            VALUES (${name}, 'https://example.test', '[]', '[]', ${userId}, ${organizationId})`,
      );
    await insert('first');
    await expect(insert('second')).rejects.toThrow(/test_quota_exceeded/);
    // Without the override, the plan's 50 applies.
    await privilegedDb
      .update(organizations)
      .set({ maxTests: null })
      .where(eq(organizations.id, organizationId));
    await expect(insert('second')).resolves.toBeDefined();
  });
});

describe('what a status allows', () => {
  const at = (iso: string) => new Date(iso);
  const row = (
    status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled',
    pastDueSince: string | null = null,
  ) => ({
    status,
    pastDueSince: pastDueSince ? at(pastDueSince) : null,
    updatedAt: at('2026-10-01T00:00:00Z'),
  });

  it('blocks runs when suspended or cancelled, never when active or trialing, and no row means free', () => {
    expect(entitlementOf(row('active'), 7).runsBlocked).toBe(false);
    expect(entitlementOf(row('trialing'), 7).runsBlocked).toBe(false);
    expect(entitlementOf(row('suspended'), 7)).toMatchObject({
      runsBlocked: true,
      reason: 'suspended',
    });
    expect(entitlementOf(row('cancelled'), 7)).toMatchObject({
      runsBlocked: true,
      reason: 'cancelled',
    });
    expect(entitlementOf(null, 7).runsBlocked).toBe(false);
  });

  it('gives a past_due subscription its grace, then blocks', () => {
    const since = '2026-10-01T00:00:00Z';
    expect(entitlementOf(row('past_due', since), 7, at('2026-10-05T00:00:00Z'))).toMatchObject({
      runsBlocked: false,
      reason: null,
      graceEndsAt: '2026-10-08T00:00:00.000Z',
    });
    expect(entitlementOf(row('past_due', since), 7, at('2026-10-08T00:00:00Z'))).toMatchObject({
      runsBlocked: true,
      reason: 'past_due_grace_expired',
    });
    expect(entitlementOf(row('past_due', since), 0, at('2026-10-01T00:00:01Z')).runsBlocked).toBe(
      true,
    );
  });
});

describe('the ledger', () => {
  it('records an administrator’s change once, in the ledger and the audit log, and moves the status', async () => {
    const organizationId = await createTestOrganization('Ledger');
    const now = new Date('2026-10-12T09:00:00Z');
    const result = await administerSubscription(
      organizationId,
      { status: 'suspended', suspendedReason: 'Contract ended' },
      actor,
      undefined,
      now,
    );
    expect(result).toMatchObject({
      status: 'suspended',
      suspendedReason: 'Contract ended',
      planCode: 'free',
    });
    const events = await privilegedDb
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.organizationId, organizationId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'manual',
      type: 'admin.subscription_updated',
      actor: 'operator',
    });
    const audit = await privilegedDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.organizationId, organizationId));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'organization.billing_updated',
      actorUsername: 'operator',
      metadata: { before: { status: 'active' }, after: { status: 'suspended' } },
    });
    // Back to active: the reason goes with the suspension.
    const restored = await administerSubscription(
      organizationId,
      { status: 'active' },
      actor,
      undefined,
      new Date(now.getTime() + 1000),
    );
    expect(restored.suspendedReason).toBeNull();
  });

  it('changes nothing under an idempotency key it has already seen', async () => {
    const organizationId = await createTestOrganization('Replay');
    const options = {
      source: 'manual' as const,
      provider: 'manual',
      type: 'test',
      idempotencyKey: `once-${organizationId}`,
      actor,
    };
    const first = await changeSubscription(organizationId, { status: 'suspended' }, options);
    const second = await changeSubscription(organizationId, { status: 'active' }, options);
    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({ duplicate: true, subscription: { status: 'suspended' } });
  });

  it('refuses a plan that does not exist', async () => {
    const organizationId = await createTestOrganization('No plan');
    await expect(
      administerSubscription(organizationId, { planCode: 'nope' }, actor),
    ).rejects.toMatchObject({
      code: 'plan_not_found',
    });
  });
});

describe('the provider’s messages', () => {
  it('walks a subscription through checkout, renewal, failed payment, recovery and cancellation', async () => {
    const organizationId = await createTestOrganization('Stripe customer');
    await createPlan({
      code: 'team',
      name: 'Team',
      providerPriceIds: { month: 'price_team_month' },
    }).catch(() => undefined);
    const apply = (name: string) =>
      applyWebhookEvent(parseStripeEvent(JSON.parse(fixture(name, organizationId))), 'stripe');
    const current = async () =>
      (
        await privilegedDb
          .select()
          .from(organizationSubscriptions)
          .where(eq(organizationSubscriptions.organizationId, organizationId))
      )[0];

    expect(await apply('checkout.session.completed')).toMatchObject({
      organizationId,
      applied: true,
    });
    expect(await current()).toMatchObject({
      planCode: 'team',
      status: 'active',
      provider: 'stripe',
      providerCustomerId: 'cus_Team001',
      providerSubscriptionId: 'sub_Team001',
    });
    await apply('customer.subscription.updated');
    expect((await current()).currentPeriodEnd?.toISOString()).toBe('2026-11-19T08:53:20.000Z');

    await apply('invoice.payment_failed');
    expect(await current()).toMatchObject({ status: 'past_due' });
    expect((await current()).pastDueSince).not.toBeNull();
    // The same event again: a replay, recorded as such and changing nothing.
    expect(await apply('invoice.payment_failed')).toMatchObject({
      applied: false,
      duplicate: true,
    });

    await apply('invoice.paid');
    expect(await current()).toMatchObject({ status: 'active', pastDueSince: null });
    expect((await current()).currentPeriodEnd?.toISOString()).toBe('2026-12-20T08:53:20.000Z');

    await apply('customer.subscription.updated.unpaid');
    expect(await current()).toMatchObject({ status: 'suspended' });

    // Cancelled at Stripe: back to the free plan, which the catalogue still offers.
    await apply('customer.subscription.deleted');
    expect(await current()).toMatchObject({
      planCode: 'free',
      status: 'active',
      providerSubscriptionId: null,
    });

    const events = await privilegedDb
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.organizationId, organizationId));
    expect(events.map((event) => event.type)).toEqual([
      'checkout.session.completed',
      'customer.subscription.updated',
      'invoice.payment_failed',
      'invoice.paid',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ]);
  });

  it('finds the organization by the provider’s subscription id when the message carries no metadata', async () => {
    const organizationId = await createTestOrganization('By subscription');
    await changeSubscription(
      organizationId,
      { provider: 'stripe', providerSubscriptionId: 'sub_lookup' },
      {
        source: 'manual',
        provider: 'stripe',
        type: 'test',
        idempotencyKey: `lookup-${organizationId}`,
        actor,
      },
    );
    const event = parseStripeEvent({
      id: `evt_lookup_${organizationId}`,
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_lookup' } },
    });
    expect(await applyWebhookEvent(event, 'stripe')).toMatchObject({
      organizationId,
      applied: true,
    });
  });

  it('records but ignores a message about nobody it knows', async () => {
    const event = parseStripeEvent({
      id: 'evt_stranger',
      type: 'invoice.paid',
      data: { object: { customer: 'cus_nobody' } },
    });
    expect(await applyWebhookEvent(event, 'stripe')).toMatchObject({
      applied: false,
      ignored: 'unknown_organization',
    });
    expect(await applyWebhookEvent(event, 'stripe')).toMatchObject({
      applied: false,
      duplicate: true,
    });
  });
});

describe('checkout', () => {
  it('asks the provider for a session for the plan, the interval and the owner, with return URLs', async () => {
    const organizationId = await createTestOrganization('Checkout');
    const userId = await createTestUser(organizationId, `owner-${organizationId}@example.test`);
    await createPlan({
      code: 'team',
      name: 'Team',
      providerPriceIds: { month: 'price_team_month' },
    }).catch(() => undefined);
    const createCheckoutSession = vi.fn(async () => ({ url: 'https://checkout.stripe.test/s' }));
    const provider: BillingProvider = {
      name: 'stripe',
      createCheckoutSession,
      createPortalSession: vi.fn(),
      parseWebhook: vi.fn(),
      cancel: vi.fn(),
    };
    const result = await startCheckout(
      {
        organizationId,
        planCode: 'team',
        interval: 'month',
        userId,
        baseUrl: 'https://wfm.example.test',
      },
      provider,
    );
    expect(result.url).toBe('https://checkout.stripe.test/s');
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        interval: 'month',
        customerId: null,
        customerEmail: `owner-${organizationId}@example.test`,
        successUrl: 'https://wfm.example.test/settings?billing=success',
        cancelUrl: 'https://wfm.example.test/settings?billing=cancelled',
        plan: expect.objectContaining({ code: 'team' }),
      }),
    );
    await expect(
      startCheckout(
        { organizationId, planCode: 'nope', interval: 'month', userId, baseUrl: 'https://x' },
        provider,
      ),
    ).rejects.toMatchObject({ code: 'plan_not_found' });
  });
});

describe('the sweep', () => {
  it('suspends what is past due beyond the grace, ends hand-set trials, and leaves the rest', async () => {
    vi.stubEnv('BILLING_PAST_DUE_GRACE_DAYS', '7');
    const overdue = await createTestOrganization('Overdue');
    const withinGrace = await createTestOrganization('Within grace');
    const expiredTrial = await createTestOrganization('Expired trial');
    const runningTrial = await createTestOrganization('Running trial');
    const stripeTrial = await createTestOrganization('Stripe trial');
    const now = new Date('2026-10-12T12:00:00Z');
    const change = (
      organizationId: number,
      patch: Parameters<typeof changeSubscription>[1],
      at: Date,
    ) =>
      changeSubscription(organizationId, patch, {
        source: 'manual',
        provider: 'manual',
        type: 'test',
        idempotencyKey: `sweep-setup-${organizationId}`,
        actor,
        now: at,
      });
    await change(overdue, { status: 'past_due' }, new Date('2026-10-01T00:00:00Z'));
    await change(withinGrace, { status: 'past_due' }, new Date('2026-10-10T00:00:00Z'));
    await change(
      expiredTrial,
      { status: 'trialing', trialEndsAt: new Date('2026-10-11T00:00:00Z') },
      now,
    );
    await change(
      runningTrial,
      { status: 'trialing', trialEndsAt: new Date('2026-10-20T00:00:00Z') },
      now,
    );
    await change(
      stripeTrial,
      { status: 'trialing', trialEndsAt: new Date('2026-10-11T00:00:00Z'), provider: 'stripe' },
      now,
    );

    const report = await sweepSubscriptions(now);
    expect(report.suspended).toEqual([overdue]);
    expect(report.trialsEnded).toEqual([expiredTrial]);
    const status = async (organizationId: number) =>
      (
        await privilegedDb
          .select()
          .from(organizationSubscriptions)
          .where(eq(organizationSubscriptions.organizationId, organizationId))
      )[0];
    expect(await status(overdue)).toMatchObject({
      status: 'suspended',
      suspendedReason: expect.stringContaining('grace'),
    });
    expect((await status(withinGrace)).status).toBe('past_due');
    expect(await status(expiredTrial)).toMatchObject({ status: 'past_due' });
    expect((await status(runningTrial)).status).toBe('trialing');
    expect((await status(stripeTrial)).status).toBe('trialing');
    // Sweeping again changes nothing and reports nothing.
    expect(await sweepSubscriptions(now)).toEqual({ suspended: [], trialsEnded: [] });
    const events = await privilegedDb
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.organizationId, overdue));
    expect(events.map((event) => event.type)).toEqual(['test', 'sweep.suspended']);
  });
});

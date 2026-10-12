import type { SubscriptionStatus } from '@shared/billing';
import type { TenantTx } from '../../middleware/tenancy';
import { billingConfig } from './config';
import { entitlementOf, subscriptionFor } from './service';

/**
 * Where a subscription says no.
 *
 * Three places ask, and only three, because they are the three ways work starts: the run
 * orchestrator (every plan run — web, API, schedule, webhook, CLI), the load-test start, and
 * beginExecutionUsage, which every direct execution passes through (a browser task or a
 * recording, an API or mobile test run from its page, and the worker picking up a run). Reading
 * reports, exporting, the settings and signing in never ask: a suspended organization keeps its
 * data and its way out.
 */
export class SubscriptionSuspendedError extends Error {
  readonly status = 402;
  readonly code = 'subscription_suspended';
  constructor(readonly subscriptionStatus: SubscriptionStatus) {
    super(
      subscriptionStatus === 'past_due'
        ? 'Payment for this organization is overdue and its grace period has ended: new runs cannot start until it is settled.'
        : subscriptionStatus === 'cancelled'
          ? 'This organization has no active subscription: new runs cannot start until a plan is chosen.'
          : 'This organization is suspended: new runs cannot start until the subscription is restored.',
    );
  }
}

export async function assertSubscriptionAllowsRuns(
  tx: TenantTx,
  organizationId: number,
  now = new Date(),
): Promise<void> {
  const subscription = await subscriptionFor(tx, organizationId);
  const entitlement = entitlementOf(subscription, billingConfig().pastDueGraceDays, now);
  if (entitlement.runsBlocked && subscription)
    throw new SubscriptionSuspendedError(subscription.status);
}

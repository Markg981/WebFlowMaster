import type { BillingInterval, BillingPlan, SubscriptionStatus } from '@shared/billing';

/**
 * What a billing provider does for this application, and nothing more.
 *
 * Four operations: send a customer to pay (checkout), send them to manage what they pay
 * (portal), believe a message from the provider (webhook), and end a subscription. Everything
 * else — what a status allows, which quotas a plan carries, when grace runs out — is the
 * application's, the same whichever provider is behind it, and tested without one.
 */

export class BillingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CheckoutInput {
  organizationId: number;
  plan: BillingPlan;
  interval: BillingInterval;
  /** The provider's customer, when this organization already has one. */
  customerId: string | null;
  /** What the provider shows and e-mails: the owner who started the checkout. */
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface PortalInput {
  customerId: string;
  returnUrl: string;
}

/**
 * A provider's message, reduced to what the application acts on. `organizationId` comes from
 * what the application itself wrote on the provider's objects at checkout; a message that names
 * neither an organization nor a subscription the application knows is logged and ignored.
 */
export interface BillingWebhookEvent {
  /** The provider's event id: the idempotency key of the ledger. */
  id: string;
  type: string;
  organizationId: number | null;
  customerId: string | null;
  subscriptionId: string | null;
  /** The provider's price, mapped to a plan by the catalogue's provider_price_ids. */
  priceId: string | null;
  interval: BillingInterval | null;
  /** The status the message implies, in the application's vocabulary, or null when it implies none. */
  status: SubscriptionStatus | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  /** Kept in the ledger, never interpreted twice. */
  payload: Record<string, unknown>;
}

export interface BillingProvider {
  readonly name: 'none' | 'stripe';
  createCheckoutSession(input: CheckoutInput): Promise<{ url: string }>;
  createPortalSession(input: PortalInput): Promise<{ url: string }>;
  /** Verifies the signature and parses the body; throws BillingError(400|401) otherwise. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): BillingWebhookEvent;
  cancel(providerSubscriptionId: string): Promise<void>;
}

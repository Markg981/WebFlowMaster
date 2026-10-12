import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingInterval, SubscriptionStatus } from '@shared/billing';
import { fetchTarget } from '../../outbound-http';
import {
  BillingError,
  type BillingProvider,
  type BillingWebhookEvent,
  type CheckoutInput,
  type PortalInput,
} from './provider';

/**
 * Stripe over its REST API, with nothing but fetch.
 *
 * The `stripe` package is not a dependency of this application and four calls do not earn one:
 * a form-encoded POST to create a Checkout Session, another for a Billing Portal session, a
 * DELETE to cancel a subscription, and the webhook's signature, which is an HMAC-SHA256 of
 * `${timestamp}.${body}` under the endpoint secret — written out here, so what the application
 * believes and why is in this file and in its tests, not in a library's.
 *
 * The organization travels on Stripe's objects as `client_reference_id` and as metadata on the
 * session and the subscription it creates, so every later message about that subscription says
 * whose it is without a lookup table of our own.
 */

export const STRIPE_API_BASE = 'https://api.stripe.com/v1';
/** How old a signed webhook may be: Stripe's own libraries use five minutes. */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;
export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
] as const;

export interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  apiBase?: string;
}

type Json = Record<string, unknown>;

/** Stripe's subscription statuses, in the application's five words. */
export function mapStripeStatus(status: unknown): SubscriptionStatus | null {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'incomplete':
      return 'past_due';
    case 'unpaid':
    case 'paused':
      return 'suspended';
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled';
    default:
      return null;
  }
}

/** Nested form fields the way Stripe reads them: `a[b][c]=v`. */
export function encodeForm(value: Json, prefix = ''): URLSearchParams {
  const params = new URLSearchParams();
  const walk = (node: unknown, key: string) => {
    if (node === undefined || node === null) return;
    if (Array.isArray(node)) node.forEach((item, index) => walk(item, `${key}[${index}]`));
    else if (typeof node === 'object')
      for (const [name, item] of Object.entries(node as Json))
        walk(item, key ? `${key}[${name}]` : name);
    else params.append(key, String(node));
  };
  walk(value, prefix);
  return params;
}

/**
 * Checks `Stripe-Signature` against the body. The header carries the timestamp and one or more
 * `v1` signatures (several during a secret rotation); any one that matches is enough, and a
 * timestamp outside the tolerance is a replay however good its signature.
 */
export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  now: Date = new Date(),
  toleranceSeconds = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
): void {
  if (!header) throw new BillingError(401, 'invalid_signature', 'Missing Stripe-Signature header.');
  const parts = new Map<string, string[]>();
  for (const item of header.split(',')) {
    const [key, ...rest] = item.trim().split('=');
    if (!key || rest.length === 0) continue;
    parts.set(key, [...(parts.get(key) ?? []), rest.join('=')]);
  }
  const timestamp = Number(parts.get('t')?.[0]);
  const signatures = parts.get('v1') ?? [];
  if (!Number.isFinite(timestamp) || signatures.length === 0)
    throw new BillingError(401, 'invalid_signature', 'Malformed Stripe-Signature header.');
  if (Math.abs(now.getTime() / 1000 - timestamp) > toleranceSeconds)
    throw new BillingError(401, 'invalid_signature', 'Stripe-Signature timestamp is too old.');
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  const matches = signatures.some((signature) => {
    const given = Buffer.from(signature, 'hex');
    const wanted = Buffer.from(expected, 'hex');
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  });
  if (!matches)
    throw new BillingError(401, 'invalid_signature', 'Stripe-Signature does not match the body.');
}

/** For tests and fixtures: a header Stripe would have sent for this body at this moment. */
export function signStripePayload(rawBody: Buffer | string, secret: string, at = new Date()) {
  const timestamp = Math.floor(at.getTime() / 1000);
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const object = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
/** Stripe expands some references into objects; either way, the id. */
const reference = (value: unknown): string | null => text(value) ?? text(object(value)?.id);
const unixDate = (value: unknown): Date | null =>
  typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000) : null;
const integerText = (value: unknown): number | null => {
  const id = Number(text(value));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const intervalOf = (value: unknown): BillingInterval | null =>
  value === 'month' || value === 'year' ? value : null;
/** The first element of a Stripe list object's `data`, or nothing. */
const firstOf = (list: unknown): Json | null => {
  const data = object(list)?.data;
  return Array.isArray(data) ? object(data[0]) : null;
};

/** The organization, from what checkout wrote on the object (or on its parent's metadata). */
function organizationOf(...candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const id = integerText(candidate);
    if (id) return id;
  }
  return null;
}

/**
 * One Stripe event, reduced to a BillingWebhookEvent. Pure, so the fixtures under
 * server/billing/fixtures/stripe/ pin exactly how each type is read.
 */
export function parseStripeEvent(event: Json): BillingWebhookEvent {
  const id = text(event.id);
  const type = text(event.type);
  if (!id || !type) throw new BillingError(400, 'invalid_webhook', 'The event has no id or type.');
  const data = object(event.data);
  const obj = object(data?.object) ?? {};
  const metadata = object(obj.metadata) ?? {};
  const base: BillingWebhookEvent = {
    id,
    type,
    organizationId: null,
    customerId: reference(obj.customer),
    subscriptionId: null,
    priceId: null,
    interval: null,
    status: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    trialEndsAt: null,
    payload: event,
  };
  switch (type) {
    case 'checkout.session.completed': {
      const paymentStatus = text(obj.payment_status);
      return {
        ...base,
        organizationId: organizationOf(obj.client_reference_id, metadata.organizationId),
        subscriptionId: reference(obj.subscription),
        interval: intervalOf(metadata.interval),
        // The subscription's own events carry its periods and price; the session says only
        // whether anything was paid. No payment because a trial started: trialing.
        status:
          paymentStatus === 'paid'
            ? 'active'
            : paymentStatus === 'no_payment_required'
              ? 'trialing'
              : null,
      };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const first = firstOf(obj.items);
      const price = object(first?.price);
      const recurring = object(price?.recurring);
      return {
        ...base,
        organizationId: organizationOf(metadata.organizationId),
        subscriptionId: reference(obj.id),
        priceId: text(price?.id),
        interval: intervalOf(recurring?.interval),
        status:
          type === 'customer.subscription.deleted' ? 'cancelled' : mapStripeStatus(obj.status),
        // Current API versions keep the period on the item, older ones on the subscription.
        currentPeriodStart:
          unixDate(obj.current_period_start) ?? unixDate(first?.current_period_start),
        currentPeriodEnd: unixDate(obj.current_period_end) ?? unixDate(first?.current_period_end),
        trialEndsAt: unixDate(obj.trial_end),
      };
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const parent = object(obj.parent);
      const details = object(parent?.subscription_details);
      const detailsMetadata = object(details?.metadata) ?? {};
      const firstLine = firstOf(obj.lines);
      const period = object(firstLine?.period);
      return {
        ...base,
        organizationId: organizationOf(
          detailsMetadata.organizationId,
          object(obj.subscription_details)?.metadata &&
            object(object(obj.subscription_details)?.metadata)?.organizationId,
        ),
        subscriptionId: reference(obj.subscription) ?? reference(details?.subscription),
        status: type === 'invoice.paid' ? 'active' : 'past_due',
        currentPeriodStart: type === 'invoice.paid' ? unixDate(period?.start) : null,
        currentPeriodEnd: type === 'invoice.paid' ? unixDate(period?.end) : null,
      };
    }
    default:
      return base;
  }
}

export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly apiBase: string;

  constructor(private readonly options: StripeProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetchTarget;
    this.now = options.now ?? (() => new Date());
    this.apiBase = options.apiBase ?? STRIPE_API_BASE;
  }

  private async call(method: 'POST' | 'DELETE', path: string, body?: Json): Promise<Json> {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.options.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body ? encodeForm(body).toString() : undefined,
      redirect: 'error',
    });
    const json = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok) {
      const error = object(json.error);
      throw new BillingError(
        502,
        'billing_provider_error',
        `Stripe answered ${response.status}${error?.message ? `: ${String(error.message)}` : ''}.`,
      );
    }
    return json;
  }

  async createCheckoutSession(input: CheckoutInput): Promise<{ url: string }> {
    const price = input.plan.providerPriceIds[input.interval];
    if (!price)
      throw new BillingError(
        409,
        'plan_not_sold',
        `The plan "${input.plan.code}" has no Stripe price for the ${input.interval}ly interval.`,
      );
    const metadata = {
      organizationId: String(input.organizationId),
      planCode: input.plan.code,
      interval: input.interval,
    };
    const session = await this.call('POST', '/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: String(input.organizationId),
      ...(input.customerId
        ? { customer: input.customerId }
        : input.customerEmail
          ? { customer_email: input.customerEmail }
          : {}),
      metadata,
      subscription_data: {
        metadata,
        ...(input.plan.trialDays > 0 ? { trial_period_days: input.plan.trialDays } : {}),
      },
    });
    const url = text(session.url);
    if (!url) throw new BillingError(502, 'billing_provider_error', 'Stripe returned no URL.');
    return { url };
  }

  async createPortalSession(input: PortalInput): Promise<{ url: string }> {
    const session = await this.call('POST', '/billing_portal/sessions', {
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    const url = text(session.url);
    if (!url) throw new BillingError(502, 'billing_provider_error', 'Stripe returned no URL.');
    return { url };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): BillingWebhookEvent {
    verifyStripeSignature(
      rawBody,
      headers['stripe-signature'] ?? headers['Stripe-Signature'],
      this.options.webhookSecret,
      this.now(),
    );
    let event: unknown;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BillingError(400, 'invalid_webhook', 'The body is not JSON.');
    }
    const json = object(event);
    if (!json) throw new BillingError(400, 'invalid_webhook', 'The body is not an event.');
    return parseStripeEvent(json);
  }

  async cancel(providerSubscriptionId: string): Promise<void> {
    await this.call('DELETE', `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`);
  }
}

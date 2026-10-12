import { describe, expect, it, vi } from 'vitest';
import {
  encodeForm,
  mapStripeStatus,
  parseStripeEvent,
  signStripePayload,
  StripeBillingProvider,
  verifyStripeSignature,
} from './stripe';
import { BillingError } from './provider';

/**
 * What the application believes from Stripe and why: the signature scheme written out, and
 * each event type read the way the fixtures under ./fixtures/stripe record it.
 */

import { stripeFixture as fixture } from './stripe-fixtures';

const SECRET = 'whsec_test_secret';

describe('the Stripe-Signature scheme', () => {
  const body = Buffer.from('{"id":"evt_1","type":"ping"}');
  const now = new Date('2026-10-12T10:00:00Z');

  it('accepts a body signed under the secret within the tolerance', () => {
    const header = signStripePayload(body, SECRET, new Date(now.getTime() - 60_000));
    expect(() => verifyStripeSignature(body, header, SECRET, now)).not.toThrow();
  });

  it('accepts any one of several v1 signatures, as during a secret rotation', () => {
    const header = `${signStripePayload(body, SECRET, now)},v1=${'0'.repeat(64)}`;
    expect(() => verifyStripeSignature(body, header, SECRET, now)).not.toThrow();
  });

  it('refuses a missing, malformed, foreign or stale signature, and a changed body', () => {
    const good = signStripePayload(body, SECRET, now);
    expect(() => verifyStripeSignature(body, undefined, SECRET, now)).toThrow(BillingError);
    expect(() => verifyStripeSignature(body, 't=abc', SECRET, now)).toThrow(/Malformed/);
    expect(() =>
      verifyStripeSignature(body, signStripePayload(body, 'other', now), SECRET, now),
    ).toThrow(/does not match/);
    expect(() =>
      verifyStripeSignature(
        body,
        signStripePayload(body, SECRET, new Date(now.getTime() - 10 * 60_000)),
        SECRET,
        now,
      ),
    ).toThrow(/too old/);
    expect(() => verifyStripeSignature(Buffer.from('{"id":"evt_2"}'), good, SECRET, now)).toThrow(
      /does not match/,
    );
  });
});

describe('reading Stripe events', () => {
  it('maps every subscription status Stripe has to the five the application knows', () => {
    expect(mapStripeStatus('trialing')).toBe('trialing');
    expect(mapStripeStatus('active')).toBe('active');
    expect(mapStripeStatus('past_due')).toBe('past_due');
    expect(mapStripeStatus('incomplete')).toBe('past_due');
    expect(mapStripeStatus('unpaid')).toBe('suspended');
    expect(mapStripeStatus('paused')).toBe('suspended');
    expect(mapStripeStatus('canceled')).toBe('cancelled');
    expect(mapStripeStatus('incomplete_expired')).toBe('cancelled');
    expect(mapStripeStatus('something_new')).toBeNull();
  });

  it('reads the organization, customer, subscription and payment from a completed checkout', () => {
    const event = parseStripeEvent(JSON.parse(fixture('checkout.session.completed')));
    expect(event).toMatchObject({
      id: 'evt_1CheckoutCompleted',
      type: 'checkout.session.completed',
      organizationId: 42,
      customerId: 'cus_Team001',
      subscriptionId: 'sub_Team001',
      interval: 'month',
      status: 'active',
    });
  });

  it('reads the price, interval, period and status from a subscription update', () => {
    const event = parseStripeEvent(JSON.parse(fixture('customer.subscription.updated')));
    expect(event).toMatchObject({
      organizationId: 42,
      subscriptionId: 'sub_Team001',
      priceId: 'price_team_month',
      interval: 'month',
      status: 'active',
    });
    expect(event.currentPeriodStart?.toISOString()).toBe('2026-10-19T08:53:20.000Z');
    expect(event.currentPeriodEnd?.toISOString()).toBe('2026-11-19T08:53:20.000Z');
    expect(
      parseStripeEvent(JSON.parse(fixture('customer.subscription.updated.unpaid'))).status,
    ).toBe('suspended');
    expect(parseStripeEvent(JSON.parse(fixture('customer.subscription.deleted'))).status).toBe(
      'cancelled',
    );
  });

  it('reads a failed payment as past_due and a paid invoice as active with its period', () => {
    const failed = parseStripeEvent(JSON.parse(fixture('invoice.payment_failed')));
    expect(failed).toMatchObject({
      organizationId: 42,
      subscriptionId: 'sub_Team001',
      status: 'past_due',
    });
    const paid = parseStripeEvent(JSON.parse(fixture('invoice.paid')));
    expect(paid).toMatchObject({ organizationId: 42, status: 'active' });
    expect(paid.currentPeriodEnd?.toISOString()).toBe('2026-12-20T08:53:20.000Z');
  });

  it('keeps an event of a type it does not act on, without a status', () => {
    const event = parseStripeEvent({
      id: 'evt_x',
      type: 'customer.created',
      data: { object: { id: 'cus_1' } },
    });
    expect(event.status).toBeNull();
    expect(event.organizationId).toBeNull();
    expect(() => parseStripeEvent({ type: 'x' })).toThrow(BillingError);
  });
});

describe('the Stripe REST calls', () => {
  it('encodes nested form fields the way Stripe reads them', () => {
    const params = encodeForm({
      mode: 'subscription',
      line_items: [{ price: 'price_1', quantity: 1 }],
      metadata: { organizationId: '42' },
    });
    expect(params.get('line_items[0][price]')).toBe('price_1');
    expect(params.get('line_items[0][quantity]')).toBe('1');
    expect(params.get('metadata[organizationId]')).toBe('42');
  });

  it('creates a checkout session for the plan’s price with the organization on it, and returns its URL', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      return new Response(
        JSON.stringify({ url: `https://checkout.stripe.test/${body.get('client_reference_id')}` }),
        {
          status: 200,
        },
      );
    });
    const provider = new StripeBillingProvider({
      secretKey: 'sk_test',
      webhookSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const plan = {
      code: 'team',
      name: 'Team',
      priceMonthMinor: 4900,
      priceYearMinor: 49000,
      currency: 'eur',
      trialDays: 14,
      active: true,
      quotas: {
        maxConcurrentRuns: null,
        maxQueuedRuns: null,
        maxTests: null,
        maxArtifactBytes: null,
        maxMonthlyExecutionMinutes: null,
      },
      providerPriceIds: { month: 'price_team_month' },
    };
    const { url } = await provider.createCheckoutSession({
      organizationId: 42,
      plan,
      interval: 'month',
      customerId: null,
      customerEmail: 'owner@example.test',
      successUrl: 'https://wfm.example.test/settings?billing=success',
      cancelUrl: 'https://wfm.example.test/settings?billing=cancelled',
    });
    expect(url).toBe('https://checkout.stripe.test/42');
    const [target, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(target).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('line_items[0][price]')).toBe('price_team_month');
    expect(body.get('customer_email')).toBe('owner@example.test');
    expect(body.get('subscription_data[metadata][planCode]')).toBe('team');
    expect(body.get('subscription_data[trial_period_days]')).toBe('14');
    await expect(
      provider.createCheckoutSession({
        organizationId: 42,
        plan,
        interval: 'year',
        customerId: null,
        customerEmail: null,
        successUrl: '',
        cancelUrl: '',
      }),
    ).rejects.toMatchObject({ code: 'plan_not_sold' });
  });

  it('turns a refusal from Stripe into a provider error without its secret', async () => {
    const provider = new StripeBillingProvider({
      secretKey: 'sk_test',
      webhookSecret: SECRET,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { message: 'No such customer' } }), {
          status: 404,
        })) as typeof fetch,
    });
    await expect(
      provider.createPortalSession({ customerId: 'cus_x', returnUrl: 'https://x' }),
    ).rejects.toMatchObject({
      code: 'billing_provider_error',
      message: 'Stripe answered 404: No such customer.',
    });
  });
});

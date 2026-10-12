import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import { billingEvents, organizationSubscriptions } from '@shared/schema';
import { createTestOrganization } from '../tests/factories';
import { createPlan } from '../tenancy/billing/service';
import { signStripePayload } from '../tenancy/billing/stripe';
import { stripeFixture } from '../tenancy/billing/stripe-fixtures';
import { billingWebhookBodyParser, billingWebhookRouter } from './billing-webhooks.routes';

/**
 * The provider's endpoint: raw body, signature checked before anything is believed, every
 * event remembered once, and no endpoint at all when there is no provider.
 */
const SECRET = 'whsec_route_test';
const app = express();
app.use(billingWebhookBodyParser);
app.use(express.json());
app.use(billingWebhookRouter);

let organizationId: number;
beforeEach(async () => {
  vi.stubEnv('BILLING_PROVIDER', 'stripe');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
  organizationId = await createTestOrganization('Webhook customer');
  await createPlan({
    code: 'team',
    name: 'Team',
    providerPriceIds: { month: 'price_team_month' },
  }).catch(() => undefined);
});
afterEach(() => vi.unstubAllEnvs());

const post = (body: string, header?: string) =>
  request(app)
    .post('/api/billing/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', header ?? signStripePayload(body, SECRET))
    .send(body);

describe('POST /api/billing/webhooks/stripe', () => {
  it('refuses a body whose signature does not verify, and records nothing', async () => {
    const body = stripeFixture('invoice.payment_failed', organizationId);
    expect((await post(body, signStripePayload(body, 'whsec_other'))).status).toBe(401);
    expect((await post(body, 't=1,v1=00')).status).toBe(401);
    expect((await request(app).post('/api/billing/webhooks/stripe').send(body)).status).toBe(401);
    expect(
      await privilegedDb
        .select()
        .from(billingEvents)
        .where(eq(billingEvents.organizationId, organizationId)),
    ).toHaveLength(0);
  });

  it('applies a signed event once, and answers a replay as a duplicate', async () => {
    const body = stripeFixture('invoice.payment_failed', organizationId);
    const first = await post(body);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received: true, applied: true, duplicate: false });
    const again = await post(body);
    expect(again.body).toEqual({ received: true, applied: false, duplicate: true });
    const [subscription] = await privilegedDb
      .select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, organizationId));
    expect(subscription.status).toBe('past_due');
    expect(
      await privilegedDb
        .select()
        .from(billingEvents)
        .where(eq(billingEvents.organizationId, organizationId)),
    ).toHaveLength(1);
  });

  it('maps a checkout, then a cancellation, onto the subscription', async () => {
    await post(stripeFixture('checkout.session.completed', organizationId)).expect(200);
    const read = async () =>
      (
        await privilegedDb
          .select()
          .from(organizationSubscriptions)
          .where(eq(organizationSubscriptions.organizationId, organizationId))
      )[0];
    expect(await read()).toMatchObject({ planCode: 'team', status: 'active', provider: 'stripe' });
    await post(stripeFixture('customer.subscription.deleted', organizationId)).expect(200);
    expect(await read()).toMatchObject({ planCode: 'free', status: 'active' });
  });

  it('is not an endpoint at all without a provider', async () => {
    vi.stubEnv('BILLING_PROVIDER', 'none');
    expect((await post(stripeFixture('invoice.paid', organizationId))).status).toBe(404);
  });
});

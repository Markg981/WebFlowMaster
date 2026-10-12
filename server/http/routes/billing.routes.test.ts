import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTestOrganization, createTestUser } from '../../tests/factories';
import { tenancyMiddleware } from '../../platform/middleware/tenancy';
import { administerSubscription, createPlan } from '../../tenancy/billing/service';
import { setBillingProviderForTest } from '../../tenancy/billing/providers';
import type { BillingProvider } from '../../tenancy/billing/provider';
import routes from './billing.routes';

/**
 * The organization's own billing endpoints: reading is every member's, even — especially —
 * while suspended; paying is an owner's, and only where there is somebody to pay.
 */
let org: number;
let user: { id: number; username: string; role: string; kind: string; organizationId: number };
let app: express.Express;
const actor = { id: 0, username: 'operator' };

beforeEach(async () => {
  org = await createTestOrganization('Tenant');
  actor.id = await createTestUser(org, `operator-${org}`);
  user = {
    id: await createTestUser(org, `owner-${org}@example.test`),
    username: `owner-${org}@example.test`,
    role: 'owner',
    kind: 'person',
    organizationId: org,
  };
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user as Express.User;
    req.isAuthenticated = (() => true) as never;
    next();
  });
  app.use(tenancyMiddleware);
  app.use(routes);
  await createPlan({
    code: 'team',
    name: 'Team',
    providerPriceIds: { month: 'price_team_month' },
  }).catch(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setBillingProviderForTest(undefined);
});

describe('GET /api/billing', () => {
  it('shows a viewer the plan, the status, the limits in force and usage, even while suspended', async () => {
    user.role = 'viewer';
    await administerSubscription(org, { status: 'suspended', suspendedReason: 'Unpaid' }, actor);
    const result = await request(app).get('/api/billing');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      provider: 'none',
      plan: { code: 'free' },
      subscription: { status: 'suspended', suspendedReason: 'Unpaid' },
      entitlement: { runsBlocked: true, reason: 'suspended' },
      quotas: { mode: 'enforce' },
      usage: { tests: 0, running: 0, queued: 0 },
      pastDueGraceDays: 7,
    });
  });

  it('lists the plans on offer, and says which provider sells them', async () => {
    const result = await request(app).get('/api/billing/plans');
    expect(result.status).toBe(200);
    expect(result.body.provider).toBe('none');
    expect(result.body.items.map((plan: { code: string }) => plan.code)).toEqual(
      expect.arrayContaining(['free', 'team']),
    );
  });
});

describe('POST /api/billing/checkout and /portal', () => {
  it('are refused to anyone but an owner', async () => {
    user.role = 'editor';
    expect(
      (
        await request(app)
          .post('/api/billing/checkout')
          .send({ planCode: 'team', interval: 'month' })
      ).status,
    ).toBe(403);
    expect((await request(app).post('/api/billing/portal')).status).toBe(403);
  });

  it('say so when there is no provider to pay through', async () => {
    const result = await request(app)
      .post('/api/billing/checkout')
      .send({ planCode: 'team', interval: 'month' });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('billing_provider_unavailable');
  });

  it('with a provider, answer the checkout URL built for this organization', async () => {
    vi.stubEnv('BILLING_PUBLIC_BASE_URL', 'https://wfm.example.test/');
    const createCheckoutSession = vi.fn(async () => ({ url: 'https://checkout.stripe.test/s' }));
    const provider: BillingProvider = {
      name: 'stripe',
      createCheckoutSession,
      createPortalSession: vi.fn(async () => ({ url: 'https://portal.stripe.test/p' })),
      parseWebhook: vi.fn(),
      cancel: vi.fn(),
    };
    setBillingProviderForTest(provider);
    const result = await request(app)
      .post('/api/billing/checkout')
      .send({ planCode: 'team', interval: 'month' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ url: 'https://checkout.stripe.test/s' });
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: org,
        interval: 'month',
        customerEmail: user.username,
        successUrl: 'https://wfm.example.test/settings?billing=success',
      }),
    );
    expect(
      (
        await request(app)
          .post('/api/billing/checkout')
          .send({ planCode: 'Team!', interval: 'week' })
      ).status,
    ).toBe(400);
    // Nothing paid through the provider yet: nothing to manage there.
    const portal = await request(app).post('/api/billing/portal');
    expect(portal.status).toBe(409);
    expect(portal.body.code).toBe('no_provider_customer');
  });
});

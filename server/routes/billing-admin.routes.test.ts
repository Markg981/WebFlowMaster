import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import { billingEvents } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { tenancyMiddleware } from '../platform/middleware/tenancy';
import routes from './billing-admin.routes';

/**
 * The installation administrator's billing: nobody else's, every change on the ledger and in
 * the organization's audit log.
 */
let org: number;
let target: number;
let user: { id: number; username: string; role: string; kind: string; organizationId: number };
let app: express.Express;

beforeEach(async () => {
  org = await createTestOrganization('Operator');
  target = await createTestOrganization('Customer');
  user = {
    id: await createTestUser(org),
    username: 'billing-admin',
    role: 'owner',
    kind: 'person',
    organizationId: org,
  };
  vi.stubEnv('INSTALLATION_ADMINS', 'billing-admin');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user as Express.User;
    req.isAuthenticated = (() => true) as never;
    next();
  });
  app.use(tenancyMiddleware);
  app.use(routes);
});
afterEach(() => vi.unstubAllEnvs());

describe('installation billing administration', () => {
  it('refuses ordinary tenant owners and service accounts', async () => {
    user.username = 'tenant-owner';
    expect((await request(app).get('/api/installation/billing/plans')).status).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/api/installation/billing/organizations/${target}`)
          .send({ status: 'suspended' })
      ).status,
    ).toBe(403);
    user.username = 'billing-admin';
    user.kind = 'service';
    expect((await request(app).get('/api/installation/billing/organizations')).status).toBe(403);
  });

  it('creates and changes plans in the catalogue', async () => {
    const code = `pro-${target}`;
    const created = await request(app)
      .post('/api/installation/billing/plans')
      .send({
        code,
        name: 'Pro',
        priceMonthMinor: 9900,
        quotas: { maxTests: 1000 },
        providerPriceIds: { month: 'price_pro' },
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      code,
      name: 'Pro',
      priceMonthMinor: 9900,
      currency: 'eur',
      active: true,
      quotas: { maxTests: 1000, maxArtifactBytes: null },
    });
    expect(
      (await request(app).post('/api/installation/billing/plans').send({ code, name: 'Again' }))
        .status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post('/api/installation/billing/plans')
          .send({ code: 'Bad Code', name: 'x' })
      ).status,
    ).toBe(400);
    const patched = await request(app)
      .patch(`/api/installation/billing/plans/${code}`)
      .send({ active: false, quotas: { maxTests: null } });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ active: false, quotas: { maxTests: null } });
    const listed = await request(app).get('/api/installation/billing/plans');
    expect(listed.body.items.map((plan: { code: string }) => plan.code)).toContain(code);
    expect(
      (await request(app).patch('/api/installation/billing/plans/nope').send({ name: 'x' })).status,
    ).toBe(404);
  });

  it('moves an organization between plans and statuses, writing the ledger and the audit log', async () => {
    const code = `team-${target}`;
    await request(app)
      .post('/api/installation/billing/plans')
      .send({ code, name: 'Team' })
      .expect(201);
    const result = await request(app)
      .patch(`/api/installation/billing/organizations/${target}`)
      .send({ planCode: code, status: 'suspended', suspendedReason: 'Contract ended' });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      organizationId: target,
      planCode: code,
      status: 'suspended',
      suspendedReason: 'Contract ended',
    });
    const events = await privilegedDb
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.organizationId, target));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'manual',
      type: 'admin.subscription_updated',
      actor: 'billing-admin',
    });
    const logs = await privilegedDb.execute(
      sql`SELECT actor_username, metadata FROM audit_log WHERE organization_id=${target} AND action='organization.billing_updated'`,
    );
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0]).toMatchObject({
      actor_username: 'billing-admin',
      metadata: { after: { planCode: code, status: 'suspended' } },
    });
    const listed = await request(app).get('/api/installation/billing/organizations?search=Cust');
    expect(listed.body.items).toContainEqual(
      expect.objectContaining({
        organizationId: target,
        name: 'Customer',
        subscription: expect.objectContaining({ planCode: code, status: 'suspended' }),
        entitlement: expect.objectContaining({ runsBlocked: true }),
      }),
    );
    expect(
      (await request(app).patch(`/api/installation/billing/organizations/${target}`).send({}))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch(`/api/installation/billing/organizations/${target}`)
          .send({ status: 'paid' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch('/api/installation/billing/organizations/999999')
          .send({ status: 'active' })
      ).status,
    ).toBe(404);
  });
});

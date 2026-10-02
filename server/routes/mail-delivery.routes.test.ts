import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { mailDeliveries, mailDeliveryEvents } from '@shared/mail-delivery';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { runWithTenant } from '../middleware/tenancy';
import { mailerDeps, sendMail } from '../mailer';
import { deliverySignature, receiveDeliveryEvent, type DeliveryEvent } from '../mail-delivery';
import ownerRouter, { mailDeliveryWebhookRouter } from './mail-delivery.routes';

let app: express.Express;
let owner: any;
let other: any;
let current: any;
const secret = 'mail-webhook-signing-secret-at-least-32-characters';
const transport = { sendMail: vi.fn(async (message: any) => ({ accepted: [message.to], rejected: [] })) };
beforeAll(async () => {
  const org = await createTestOrganization();
  const foreign = await createTestOrganization();
  owner = { id: await createTestUser(org), organizationId: org, role: 'owner' };
  other = { id: await createTestUser(foreign), organizationId: foreign, role: 'owner' };
  app = express(); app.use(express.json()); app.use(mailDeliveryWebhookRouter);
  app.use((req, _res, next) => {
    req.user = current; req.isAuthenticated = (() => !!current) as any;
    if (!current) return next();
    runWithTenant(current.organizationId, () => next(), { userId: current.id, role: current.role });
  });
  app.use(ownerRouter);
});
beforeEach(async () => {
  await privilegedDb.delete(mailDeliveryEvents); await privilegedDb.delete(mailDeliveries);
  current = owner; process.env.MAIL_DELIVERY_WEBHOOK_SECRET = secret;
  mailerDeps.transport = transport as any;
  transport.sendMail.mockClear();
});
afterEach(() => { mailerDeps.transport = undefined; delete process.env.MAIL_DELIVERY_WEBHOOK_SECRET; });
const mail = (organizationId: number | null = owner.organizationId) => sendMail({ organizationId, to: 'ann@shop.test', purpose: 'password_reset', subject: 'Private subject', text: 'reset-secret-token', html: '<p>reset-secret-token</p>' });
function callback(event: DeliveryEvent, timestamp = String(Math.floor(Date.now() / 1000))) {
  return request(app).post('/api/mail-deliveries/events').set('X-Wfm-Mail-Timestamp', timestamp).set('X-Wfm-Mail-Signature', deliverySignature(timestamp, event, secret)).send(event);
}
describe('mail delivery tracking', () => {
  it('records SMTP acceptance with opaque correlation and no content or credentials', async () => {
    const result = await mail();
    expect(result).toMatchObject({ sent: true, state: 'accepted', deliveryId: expect.any(String) });
    const [row] = await privilegedDb.select().from(mailDeliveries);
    expect(row).toMatchObject({ id: result.deliveryId, recipient: 'ann@shop.test', state: 'accepted', purpose: 'password_reset' });
    expect(JSON.stringify(row)).not.toMatch(/Private subject|reset-secret-token/);
    expect(transport.sendMail.mock.calls[0][0]).toMatchObject({ messageId: `<${row.id}@webflowmaster.local>`, text: 'reset-secret-token', html: '<p>reset-secret-token</p>' });
  });
  it('requires a configured secret, valid signature and fresh timestamp before lookup', async () => {
    const sent = await mail();
    const event: DeliveryEvent = { eventId: 'provider-1', messageId: sent.deliveryId!, status: 'delivered' };
    expect((await request(app).post('/api/mail-deliveries/events').send(event)).status).toBe(401);
    expect((await callback(event, String(Math.floor(Date.now() / 1000) - 301))).status).toBe(401);
    expect((await callback({ ...event, messageId: randomUUID() })).status).toBe(404);
    expect((await request(app).post('/api/mail-deliveries/events').send({ ...event, recipient: 'attacker@shop.test' })).status).toBe(400);
    process.env.MAIL_DELIVERY_WEBHOOK_SECRET = 'short';
    expect((await callback(event)).status).toBe(503);
    expect(await privilegedDb.select().from(mailDeliveryEvents)).toHaveLength(0);
  });
  it('deduplicates persistently, protects permanent bounces and suppresses only their tenant', async () => {
    const sent = await mail();
    const event: DeliveryEvent = { eventId: 'provider-bounce', messageId: sent.deliveryId!, status: 'hard_bounce' };
    expect((await callback(event)).body).toEqual({ received: true, duplicate: false });
    expect((await callback(event)).body).toEqual({ received: true, duplicate: true });
    await callback({ ...event, eventId: 'late-delivery', status: 'delivered' });
    expect((await privilegedDb.select().from(mailDeliveries).where(eq(mailDeliveries.id, sent.deliveryId!)))[0].state).toBe('hard_bounce');
    expect(await mail()).toMatchObject({ sent: false, state: 'suppressed', error: expect.stringMatching(/hard-bounced/) });
    expect(await mail(other.organizationId)).toMatchObject({ sent: true, state: 'accepted' });
    expect(transport.sendMail).toHaveBeenCalledTimes(2);
  });
  it('lets transient bounces recover and does not downgrade delivery with a delayed transient event', async () => {
    const sent = await mail();
    for (const [eventId, status] of [['soft', 'soft_bounce'], ['delivery', 'delivered'], ['late-soft', 'soft_bounce']] as const) {
      expect((await callback({ eventId, status, messageId: sent.deliveryId! })).status).toBe(200);
    }
    expect((await privilegedDb.select().from(mailDeliveries))[0].state).toBe('delivered');
  });
  it('does not overwrite a bounce callback when SMTP acceptance resolves later', async () => {
    mailerDeps.transport = { sendMail: async (message: any) => {
      await receiveDeliveryEvent({ eventId: 'fast-bounce', messageId: message.headers['X-Wfm-Delivery-Id'], status: 'hard_bounce' });
      return { accepted: [message.to], rejected: [] };
    } } as any;
    await mail();
    expect((await privilegedDb.select().from(mailDeliveries))[0].state).toBe('hard_bounce');
  });
  it('lets an authenticated hard bounce supersede an ambiguous SMTP timeout', async () => {
    mailerDeps.transport = { sendMail: async () => { throw new Error('SMTP acknowledgement timeout'); } } as any;
    const failed = await mail();
    expect(failed.state).toBe('failed');
    await callback({ eventId: 'late-permanent-bounce', messageId: failed.deliveryId!, status: 'hard_bounce' }).expect(200);
    expect((await privilegedDb.select().from(mailDeliveries))[0].state).toBe('hard_bounce');
    expect((await mail()).state).toBe('suppressed');
  });
  it('shows only tenant-owned history to owners and hides pre-auth system records', async () => {
    await mail(); await mail(other.organizationId); await mail(null);
    const response = await request(app).get('/api/mail-deliveries');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ configured: true, trackingConfigured: true, nextBefore: null });
    expect(response.body.deliveries).toHaveLength(1);
    current = { ...owner, role: 'editor' };
    expect((await request(app).get('/api/mail-deliveries')).status).toBe(403);
    current = null;
    expect((await request(app).get('/api/mail-deliveries')).status).toBe(401);
  });
  it('pages tied timestamps without skipping records and validates bounds/cursor', async () => {
    await mail(); await mail(); await mail();
    await privilegedDb.update(mailDeliveries).set({ createdAt: new Date('2026-10-02T10:00:00Z') });
    const first = await request(app).get('/api/mail-deliveries?limit=2');
    expect(first.body.deliveries).toHaveLength(2);
    const next = await request(app).get('/api/mail-deliveries').query({ limit: 2, before: first.body.nextBefore });
    expect(next.body.deliveries).toHaveLength(1);
    expect(new Set([...first.body.deliveries, ...next.body.deliveries].map((r: any) => r.id)).size).toBe(3);
    expect((await request(app).get('/api/mail-deliveries?limit=1000')).status).toBe(400);
    expect((await request(app).get('/api/mail-deliveries?before=invalid')).status).toBe(400);
  });
});

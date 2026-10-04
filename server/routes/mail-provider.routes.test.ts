import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHmac, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { mailSettings } from '@shared/mail-settings';
import { mailDeliveries, mailDeliveryEvents } from '@shared/mail-delivery';
import { createTestOrganization } from '../tests/factories';
import { encryptSecret } from '../crypto';
import * as delivery from '../mail-delivery';
import { mailProviderBodyParser, mailProviderWebhookRouter } from './mail-provider.routes';

const app = express();
app.use(mailProviderBodyParser); app.use(express.json()); app.use(mailProviderWebhookRouter);
app.post('/unrelated', (req, res) => res.json(req.body));
const secret = 'fixture-organization-native-webhook-secret';
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = ec.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const callbackId = randomUUID();
let organizationId: number, foreignOrganizationId: number;
let messageId: string;
beforeAll(async () => { organizationId = await createTestOrganization(); foreignOrganizationId = await createTestOrganization(); });
beforeEach(async () => {
  await privilegedDb.delete(mailDeliveryEvents); await privilegedDb.delete(mailDeliveries); await privilegedDb.delete(mailSettings);
  messageId = (await delivery.queueMail(organizationId, 'ann@shop.test', 'invitation')).id;
  await delivery.finishMail(messageId, 'accepted');
  await privilegedDb.insert(mailSettings).values({ organizationId, callbackId, provider: 'sendgrid', sendgridPublicKey: publicKey });
});
afterEach(() => vi.restoreAllMocks());
function sendgrid(events: unknown[], rawOverride?: string, signatureOverride?: string) {
  const raw = rawOverride ?? JSON.stringify(events, null, 2);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signatureOverride ?? sign('sha256', Buffer.from(timestamp + raw), ec.privateKey).toString('base64');
  return request(app).post(`/api/mail-deliveries/providers/${callbackId}`).set('Content-Type', 'application/json')
    .set('X-Twilio-Email-Event-Webhook-Timestamp', timestamp).set('X-Twilio-Email-Event-Webhook-Signature', signature).send(raw);
}
const event = (id = messageId, email = 'ann@shop.test', outcome = 'delivered', nativeId = 'fixture/native.event') => ({ event: outcome, sg_event_id: nativeId, email, wfm_delivery_id: id });
describe('public organization provider callbacks', () => {
  it('ingests raw signed native events and persistently deduplicates punctuation IDs', async () => {
    expect((await sendgrid([event()])).body).toEqual({ received: true, recorded: 1, duplicates: 0 });
    expect((await sendgrid([event()])).body).toEqual({ received: true, recorded: 1, duplicates: 1 });
    expect((await privilegedDb.select().from(mailDeliveryEvents))).toHaveLength(1);
    expect((await privilegedDb.select().from(mailDeliveries))[0].state).toBe('delivered');
  });
  it('rejects forged public requests before recording an event', async () => {
    await sendgrid([event()], undefined, 'Zm9yZ2Vk').expect(401);
    expect((await privilegedDb.select().from(mailDeliveries))[0].state).toBe('accepted');
    expect((await privilegedDb.select().from(mailDeliveryEvents))).toHaveLength(0);
  });
  it('ignores validly signed foreign-organization IDs and wrong recipient correlation', async () => {
    const foreignId = (await delivery.queueMail(foreignOrganizationId, 'ann@shop.test', 'invitation')).id;
    await delivery.finishMail(foreignId, 'accepted');
    expect((await sendgrid([event(foreignId), event(messageId, 'foreign@shop.test')])).body).toEqual({ received: true, recorded: 0, duplicates: 0 });
    expect((await privilegedDb.select().from(mailDeliveryEvents))).toHaveLength(0);
    expect((await privilegedDb.select().from(mailDeliveries)).every(row => row.state === 'accepted')).toBe(true);
  });
  it('keeps hard bounce precedence and acknowledges unrelated authentic events', async () => {
    await sendgrid([event(messageId, 'ann@shop.test', 'bounce', 'permanent')]).expect(200);
    await sendgrid([event(messageId, 'ann@shop.test', 'delivered', 'late-delivery')]).expect(200);
    expect((await privilegedDb.select().from(mailDeliveries))[0].state).toBe('hard_bounce');
    expect((await sendgrid([{ event: 'open' }])).body).toEqual({ received: true, recorded: 0, duplicates: 0 });
  });
  it('validates the whole batch before writing and reports persistence failure for retry', async () => {
    await sendgrid([event(), { event: 'bounce', wfm_delivery_id: messageId, email: 'ann@shop.test' }]).expect(400);
    expect((await privilegedDb.select().from(mailDeliveryEvents))).toHaveLength(0);
    vi.spyOn(delivery, 'receiveDeliveryEvent').mockRejectedValueOnce(new Error('private SQL and recipient data'));
    const response = await sendgrid([event()]);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toMatch(/private SQL|ann@shop/);
  });
  it('keeps generic HMAC compatibility with an organization secret', async () => {
    await privilegedDb.update(mailSettings).set({ provider: 'generic', signingSecret: encryptSecret(secret) }).where(eq(mailSettings.organizationId, organizationId));
    const body = { eventId: 'generic-event', messageId, status: 'delivered' as const };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await request(app).post(`/api/mail-deliveries/providers/${callbackId}`).set('X-Wfm-Mail-Timestamp', timestamp)
      .set('X-Wfm-Mail-Signature', delivery.deliverySignature(timestamp, body, secret)).send(body);
    expect(response.body).toEqual({ received: true, recorded: 1, duplicates: 0 });
  });
  it('bounds bodies, rejects unsupported shapes and does not consume unrelated JSON', async () => {
    await request(app).post(`/api/mail-deliveries/providers/${callbackId}`).set('Content-Type', 'application/json').send('x'.repeat(256 * 1024 + 1)).expect(413);
    await request(app).post(`/api/mail-deliveries/providers/${callbackId}`).set('Content-Type', 'application/octet-stream').send(Buffer.from('{}')).expect(400);
    await sendgrid([], '{broken-json').expect(400);
    expect((await request(app).post('/unrelated').send({ unchanged: true })).body).toEqual({ unchanged: true });
    await request(app).post('/api/mail-deliveries/providers/invalid').send({}).expect(404);
    await request(app).post(`/api/mail-deliveries/providers/${randomUUID()}`).send({}).expect(404);
  });
  it('invalidates rotated and disabled provider callbacks', async () => {
    await privilegedDb.update(mailSettings).set({ callbackId: randomUUID() }).where(eq(mailSettings.organizationId, organizationId));
    await sendgrid([event()]).expect(404);
    await privilegedDb.update(mailSettings).set({ callbackId, provider: 'none' }).where(eq(mailSettings.organizationId, organizationId));
    await sendgrid([event()]).expect(404);
    expect((await privilegedDb.select().from(mailDeliveryEvents))).toHaveLength(0);
  });
  it('durably binds Mailgun tokens to the authenticated body while allowing identical retries', async () => {
    await privilegedDb.update(mailSettings).set({ provider: 'mailgun', signingSecret: encryptSecret(secret) }).where(eq(mailSettings.organizationId, organizationId));
    const timestamp = String(Math.floor(Date.now() / 1000)), token = randomUUID();
    const payload = { signature: { timestamp, token, signature: createHmac('sha256', secret).update(timestamp + token).digest('hex') },
      'event-data': { event: 'delivered', id: 'mg-native-event', recipient: 'ann@shop.test', 'user-variables': { wfm_delivery_id: messageId } } };
    const post = (body: unknown) => request(app).post(`/api/mail-deliveries/providers/${callbackId}`).send(body);
    const forged = { ...payload, signature: { ...payload.signature, signature: '0'.repeat(64) } };
    await post(forged).expect(401); // failed native verification must not reserve a token
    expect((await post(payload)).body).toEqual({ received: true, recorded: 1, duplicates: 0 });
    expect((await post(payload)).body).toEqual({ received: true, recorded: 1, duplicates: 1 });
    // The native HMAC doesn't cover event-data; durable body binding rejects this valid-HMAC replay.
    await post({ ...payload, 'event-data': { ...payload['event-data'], event: 'failed', severity: 'permanent' } }).expect(401);
    expect((await privilegedDb.select().from(mailDeliveryEvents))).toHaveLength(1);
    expect((await privilegedDb.select().from(mailDeliveries))[0].state).toBe('delivered');
  });
});

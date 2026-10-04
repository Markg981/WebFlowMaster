import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { privilegedDb } from './db';
import { mailDeliveries, mailDeliveryEvents, type MailPurpose, type MailState } from '@shared/mail-delivery';
import { withTenantTransaction } from './middleware/tenancy';

/** System mail and signed provider callbacks run before a browser tenant exists. Every row
 * names its organization explicitly; owner reads use ordinary tenant RLS. Content, tokens,
 * SMTP responses and provider payloads are deliberately never retained. */
export async function queueMail(organizationId: number | null, recipient: string, purpose: MailPurpose) {
  const id = randomUUID();
  const normalized = recipient.trim().toLowerCase();
  const scope = organizationId === null ? isNull(mailDeliveries.organizationId) : eq(mailDeliveries.organizationId, organizationId);
  // Anonymous/system mail has no tenant suppression list: a bounce must not become a
  // installation-wide address blacklist. Known-account resets carry their actual org.
  const bounced = organizationId === null ? [] : await privilegedDb.select({ id: mailDeliveries.id }).from(mailDeliveries)
    .where(and(scope, eq(mailDeliveries.recipient, normalized), eq(mailDeliveries.state, 'hard_bounce'))).limit(1);
  const state = bounced.length ? 'suppressed' : 'queued';
  await privilegedDb.insert(mailDeliveries).values({ id, organizationId, recipient: normalized, purpose, state });
  return { id, suppressed: state === 'suppressed' };
}
export async function finishMail(id: string, state: 'accepted' | 'rejected' | 'failed') {
  await privilegedDb.update(mailDeliveries).set({ state, updatedAt: sql`now()` })
    .where(and(eq(mailDeliveries.id, id), eq(mailDeliveries.state, 'queued')));
}
export function trackingConfigured(env: NodeJS.ProcessEnv = process.env) {
  return (env.MAIL_DELIVERY_WEBHOOK_SECRET?.length ?? 0) >= 32;
}
export const deliveryEventSchema = z.object({
  eventId: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_:-]+$/),
  messageId: z.string().uuid(),
  status: z.enum(['delivered', 'soft_bounce', 'hard_bounce']),
}).strict();
export type DeliveryEvent = z.infer<typeof deliveryEventSchema>;
export function deliverySignature(timestamp: string, event: DeliveryEvent, secret: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${event.eventId}.${event.messageId}.${event.status}`).digest('hex');
}
export function verifyDeliverySignature(timestamp: string | undefined, signature: string | undefined, event: DeliveryEvent, env: NodeJS.ProcessEnv = process.env) {
  if (!trackingConfigured(env) || !timestamp || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(deliverySignature(timestamp, event, env.MAIL_DELIVERY_WEBHOOK_SECRET!), 'hex'));
}
export async function receiveDeliveryEvent(event: DeliveryEvent, expectedOrganizationId?: number, recipient?: string) {
  return privilegedDb.transaction(async tx => {
    const [delivery] = await tx.select().from(mailDeliveries).where(eq(mailDeliveries.id, event.messageId)).for('update').limit(1);
    if (!delivery) return null;
    if (expectedOrganizationId !== undefined && delivery.organizationId !== expectedOrganizationId) return null;
    if (recipient !== undefined && delivery.recipient !== recipient.trim().toLowerCase()) return null;
    const eventKey = createHash('sha256').update(`${event.messageId}:${event.eventId}`).digest('hex');
    const inserted = await tx.insert(mailDeliveryEvents).values({ id: eventKey, deliveryId: delivery.id, organizationId: delivery.organizationId, state: event.status })
      .onConflictDoNothing().returning();
    if (!inserted.length) return { received: true, duplicate: true };
    // Permanent bounces never become deliverable from a delayed/duplicate delivery event;
    // transient bounces may subsequently recover. Local refusal/suppression is terminal.
    const terminal: MailState[] = ['hard_bounce', 'rejected', 'suppressed'];
    if (!terminal.includes(delivery.state) && !(delivery.state === 'delivered' && event.status === 'soft_bounce')) {
      await tx.update(mailDeliveries).set({ state: event.status, updatedAt: sql`now()` }).where(eq(mailDeliveries.id, delivery.id));
    }
    return { received: true, duplicate: false };
  });
}
export async function listMailDeliveries(limit: number, before?: { date: Date; id: string }) {
  return withTenantTransaction(tx => tx.select({ id: mailDeliveries.id, recipient: mailDeliveries.recipient, purpose: mailDeliveries.purpose,
    state: mailDeliveries.state, createdAt: mailDeliveries.createdAt, updatedAt: mailDeliveries.updatedAt }).from(mailDeliveries)
    .where(before ? or(lt(mailDeliveries.createdAt, before.date), and(eq(mailDeliveries.createdAt, before.date), lt(mailDeliveries.id, before.id))) : undefined)
    .orderBy(desc(mailDeliveries.createdAt), desc(mailDeliveries.id)).limit(limit + 1));
}

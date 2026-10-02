import { check, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './schema';

export const MAIL_STATES = ['queued', 'accepted', 'delivered', 'soft_bounce', 'hard_bounce', 'rejected', 'failed', 'suppressed'] as const;
export type MailState = typeof MAIL_STATES[number];
export type MailPurpose = 'invitation' | 'password_reset' | 'run_finished' | 'other';
export const mailDeliveries = pgTable('mail_deliveries', {
  id: text('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  recipient: text('recipient').notNull(),
  purpose: text('purpose').$type<MailPurpose>().notNull(),
  state: text('state').$type<MailState>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, table => [
  unique('mail_deliveries_id_organization_unique').on(table.id, table.organizationId),
  check('mail_deliveries_state_check', sql`${table.state} IN ('queued','accepted','delivered','soft_bounce','hard_bounce','rejected','failed','suppressed')`),
  index('mail_deliveries_org_recipient_idx').on(table.organizationId, table.recipient),
  index('mail_deliveries_org_created_idx').on(table.organizationId, table.createdAt),
]);
export const mailDeliveryEvents = pgTable('mail_delivery_events', {
  id: text('id').primaryKey(),
  deliveryId: text('delivery_id').notNull().references(() => mailDeliveries.id, { onDelete: 'cascade' }),
  organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  state: text('state').$type<'delivered' | 'soft_bounce' | 'hard_bounce'>().notNull(),
  receivedAt: timestamp('received_at').notNull().defaultNow(),
}, table => [index('mail_delivery_events_delivery_idx').on(table.deliveryId)]);

import { boolean, check, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './schema';

export const TEMPLATE_PURPOSES = ['invitation', 'password_reset', 'run_finished'] as const;
export type TemplatePurpose = typeof TEMPLATE_PURPOSES[number];
export interface MailTemplateContent { subject: string; html: string; text: string }
export const TEMPLATE_VARIABLES: Record<TemplatePurpose, string[]> = {
  invitation: ['username', 'organizationName', 'invitedBy', 'role', 'expiresAt', 'actionUrl'],
  password_reset: ['username', 'expiresAt', 'actionUrl'],
  run_finished: ['planName', 'status', 'summary', 'actionUrl'],
};
export const mailTemplates = pgTable('organization_mail_templates', {
  organizationId: integer('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  purpose: text('purpose').$type<TemplatePurpose>().notNull(),
  subject: text('subject').notNull(), html: text('html').notNull(), text: text('text').notNull(),
  custom: boolean('custom').notNull().default(true),
  version: integer('version').notNull().default(1), updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.organizationId, table.purpose] }),
  check('organization_mail_templates_purpose_check', sql`${table.purpose} IN ('invitation','password_reset','run_finished')`),
  check('organization_mail_templates_version_check', sql`${table.version} > 0`)]);

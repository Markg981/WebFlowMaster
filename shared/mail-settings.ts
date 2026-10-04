import { z } from 'zod';
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './schema';

export const MAIL_PROVIDERS = ['none', 'generic', 'ses', 'sendgrid', 'mailgun'] as const;
export type MailProvider = typeof MAIL_PROVIDERS[number];
export interface EncryptedMailSecret { encryptedValue: string; iv: string; authTag: string }
export interface ProviderMailConfig {
  organizationId: number;
  callbackId: string;
  provider: MailProvider;
  signingSecret?: string;
  sendgridPublicKey?: string;
  sesTopicArn?: string;
}
const headerText = z.string().trim().max(254).refine(value => !/[\r\n]/.test(value) && !value.includes(String.fromCharCode(0)), 'Invalid mail header');
export const mailSettingsInputSchema = z.object({
  version: z.number().int().min(0),
  smtpMode: z.enum(['inherit', 'custom', 'disabled']),
  provider: z.enum(MAIL_PROVIDERS),
  smtpHost: z.string().trim().max(253).regex(/^[a-zA-Z0-9.-]+$/).optional().nullable(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUsername: z.string().max(254).optional().nullable(),
  smtpPassword: z.string().min(1).max(4000).optional(),
  clearSmtpPassword: z.boolean().optional(),
  smtpSecure: z.boolean().optional(),
  fromAddress: headerText.optional().nullable(),
  signingSecret: z.string().min(32).max(4000).optional(),
  clearSigningSecret: z.boolean().optional(),
  sendgridPublicKey: z.string().trim().max(4000).optional().nullable(),
  sesTopicArn: z.string().trim().max(256).optional().nullable(),
  rotateCallback: z.boolean().optional(),
}).strict();
export type MailSettingsInput = z.infer<typeof mailSettingsInputSchema>;
export const mailSettings = pgTable('organization_mail_settings', {
  organizationId: integer('organization_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  smtpMode: text('smtp_mode').$type<MailSettingsInput['smtpMode']>().notNull().default('inherit'),
  provider: text('provider').$type<MailProvider>().notNull().default('none'),
  callbackId: uuid('callback_id').notNull().defaultRandom().unique(),
  smtpHost: text('smtp_host'), smtpPort: integer('smtp_port').notNull().default(587),
  smtpUsername: text('smtp_username'), smtpPassword: jsonb('smtp_password').$type<EncryptedMailSecret>(),
  smtpSecure: integer('smtp_secure').notNull().default(0), fromAddress: text('from_address'),
  signingSecret: jsonb('signing_secret').$type<EncryptedMailSecret>(),
  sendgridPublicKey: text('sendgrid_public_key'), sesTopicArn: text('ses_topic_arn'),
  version: integer('version').notNull().default(1), updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export type MailSettingsRow = typeof mailSettings.$inferSelect;
export const mailProviderRequests = pgTable('mail_provider_requests', {
  id: text('id').primaryKey(),
  organizationId: integer('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  bodyHash: text('body_hash').notNull(), expiresAt: timestamp('expires_at').notNull(),
});

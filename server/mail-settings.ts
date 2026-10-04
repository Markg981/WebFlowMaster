import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { mailProviderRequests, mailSettings, type MailSettingsRow, type MailSettingsInput, type ProviderMailConfig, type EncryptedMailSecret } from '@shared/mail-settings';
import { privilegedDb } from './db';
import { decryptSecret, encryptSecret } from './crypto';

const decrypt = (secret: EncryptedMailSecret | null | undefined) => secret ? decryptSecret(secret.encryptedValue, secret.iv, secret.authTag) : undefined;
export class MailSettingsError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function providerConfigFor(row: MailSettingsRow): ProviderMailConfig {
  return { organizationId: row.organizationId, callbackId: row.callbackId, provider: row.provider,
    signingSecret: decrypt(row.signingSecret), sendgridPublicKey: row.sendgridPublicKey ?? undefined, sesTopicArn: row.sesTopicArn ?? undefined };
}
function validPublicKey(value: string | null) {
  if (!value) return false;
  try {
    const key = createPublicKey(value.includes('BEGIN PUBLIC KEY') ? value : { key: Buffer.from(value, 'base64'), type: 'spki', format: 'der' });
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch { return false; }
}
export function trackingReady(row: MailSettingsRow | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (!row) return (env.MAIL_DELIVERY_WEBHOOK_SECRET?.length ?? 0) >= 32;
  if (row.provider === 'generic' || row.provider === 'mailgun') return !!row.signingSecret;
  if (row.provider === 'sendgrid') return validPublicKey(row.sendgridPublicKey);
  return row.provider === 'ses' && !!row.sesTopicArn;
}
export function publicMailSettings(row?: MailSettingsRow, env: NodeJS.ProcessEnv = process.env) {
  return {
    smtpMode: row?.smtpMode ?? 'inherit', provider: row?.provider ?? 'none', smtpHost: row?.smtpHost ?? '',
    smtpPort: row?.smtpPort ?? 587, smtpUsername: row?.smtpUsername ?? '', smtpSecure: row?.smtpSecure === 1,
    fromAddress: row?.fromAddress ?? '', hasSmtpPassword: !!row?.smtpPassword, hasSigningSecret: !!row?.signingSecret,
    sendgridPublicKey: row?.sendgridPublicKey ?? '', sesTopicArn: row?.sesTopicArn ?? '',
    version: row?.version ?? 0, callbackId: row?.callbackId ?? null,
    configured: row?.smtpMode === 'disabled' ? false : row?.smtpMode === 'custom' ? !!(row.smtpHost && row.fromAddress) : !!(env.SMTP_URL?.trim() && env.SMTP_FROM?.trim()),
    trackingConfigured: trackingReady(row, env),
  };
}
export function buildMailSettings(input: MailSettingsInput, organizationId: number, current?: MailSettingsRow) {
  const changedProvider = !!current && input.provider !== current.provider;
  const row: typeof mailSettings.$inferInsert = {
    organizationId, smtpMode: input.smtpMode, provider: input.provider,
    callbackId: input.rotateCallback || changedProvider ? randomUUID() : current?.callbackId ?? randomUUID(),
    smtpHost: input.smtpHost !== undefined ? input.smtpHost : current?.smtpHost ?? null,
    smtpPort: input.smtpPort ?? current?.smtpPort ?? 587,
    smtpUsername: input.smtpUsername !== undefined ? input.smtpUsername : current?.smtpUsername ?? null,
    smtpSecure: input.smtpSecure !== undefined ? Number(input.smtpSecure) : current?.smtpSecure ?? 0,
    fromAddress: input.fromAddress !== undefined ? input.fromAddress : current?.fromAddress ?? null,
    smtpPassword: input.smtpPassword ? encryptSecret(input.smtpPassword) : input.clearSmtpPassword ? null : current?.smtpPassword ?? null,
    signingSecret: input.signingSecret ? encryptSecret(input.signingSecret) : input.clearSigningSecret || changedProvider ? null : current?.signingSecret ?? null,
    sendgridPublicKey: input.sendgridPublicKey !== undefined ? input.sendgridPublicKey : changedProvider ? null : current?.sendgridPublicKey ?? null,
    sesTopicArn: input.sesTopicArn !== undefined ? input.sesTopicArn : changedProvider ? null : current?.sesTopicArn ?? null,
    version: (current?.version ?? 0) + 1, updatedAt: new Date(),
  };
  if (input.smtpPassword && input.clearSmtpPassword || input.signingSecret && input.clearSigningSecret) throw new MailSettingsError(400, 'Choose either replacement or clearing of a credential.');
  if (row.smtpMode === 'custom') {
    const address = row.fromAddress?.match(/<([^<>]+)>$/)?.[1] ?? row.fromAddress;
    if (!row.smtpHost || !address || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) throw new MailSettingsError(400, 'Custom SMTP requires a server and a valid sender address.');
    if (row.smtpUsername && !row.smtpPassword) throw new MailSettingsError(400, 'An SMTP password is required for this username.');
    if (current?.smtpPassword && !input.smtpPassword && !input.clearSmtpPassword &&
      (row.smtpHost !== current.smtpHost || row.smtpPort !== current.smtpPort || row.smtpUsername !== current.smtpUsername)) {
      throw new MailSettingsError(400, 'Re-enter the SMTP password when changing its server or username.');
    }
  }
  if (['generic', 'mailgun'].includes(row.provider!) && !row.signingSecret) throw new MailSettingsError(400, 'This provider requires a webhook signing secret.');
  if (row.provider === 'sendgrid' && !validPublicKey(row.sendgridPublicKey ?? null)) throw new MailSettingsError(400, 'SendGrid requires its P-256 public webhook verification key.');
  if (row.provider === 'ses' && !/^arn:aws(?:-cn|-us-gov)?:sns:[a-z]{2}(?:-gov)?-[a-z]+-\d:\d{12}:[A-Za-z0-9_-]{1,256}$/.test(row.sesTopicArn ?? '')) throw new MailSettingsError(400, 'SES requires an exact SNS topic ARN.');
  // Unused provider credentials are discarded, not retained for accidental future reuse.
  if (!['generic', 'mailgun'].includes(row.provider!)) row.signingSecret = null;
  if (row.provider !== 'sendgrid') row.sendgridPublicKey = null;
  if (row.provider !== 'ses') row.sesTopicArn = null;
  return row;
}
export interface ResolvedMailConfiguration {
  configured: boolean;
  smtp?: SMTPTransport.Options;
  smtpUrl?: string;
  from?: string;
  provider?: ProviderMailConfig;
  inherited: boolean;
}
export async function resolveMailConfiguration(organizationId: number | null | undefined, env: NodeJS.ProcessEnv = process.env): Promise<ResolvedMailConfiguration> {
  const [row] = organizationId == null ? [] : await privilegedDb.select().from(mailSettings).where(eq(mailSettings.organizationId, organizationId)).limit(1);
  const provider = row ? providerConfigFor(row) : undefined;
  if (row?.smtpMode === 'disabled') return { configured: false, inherited: false, provider };
  if (!row || row.smtpMode === 'inherit') return { configured: !!(env.SMTP_URL?.trim() && env.SMTP_FROM?.trim()), inherited: true, smtpUrl: env.SMTP_URL?.trim(), from: env.SMTP_FROM?.trim(), provider };
  return { configured: !!(row.smtpHost && row.fromAddress), inherited: false, from: row.fromAddress ?? undefined, provider,
    smtp: { host: row.smtpHost!, port: row.smtpPort, secure: row.smtpSecure === 1, requireTLS: row.smtpSecure === 0,
      ...(row.smtpUsername ? { auth: { user: row.smtpUsername, pass: decrypt(row.smtpPassword) } } : {}), tls: { rejectUnauthorized: true } } };
}
export async function getProviderMailConfiguration(callbackId: string): Promise<ProviderMailConfig | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(callbackId)) return null;
  const [row] = await privilegedDb.select().from(mailSettings).where(eq(mailSettings.callbackId, callbackId)).limit(1);
  return row && trackingReady(row) ? providerConfigFor(row) : null;
}
export async function getOrganizationTrackingStatus(organizationId: number, env: NodeJS.ProcessEnv = process.env) {
  const [row] = await privilegedDb.select().from(mailSettings).where(eq(mailSettings.organizationId, organizationId)).limit(1);
  return trackingReady(row, env);
}
/** Mailgun authenticates timestamp+token, not body bytes. Bind a verified token to its
 * original body durably so replicas reject altered retries without storing provider data. */
export async function registerMailgunRequest(config: ProviderMailConfig, raw: Buffer): Promise<boolean> {
  const { signature } = JSON.parse(raw.toString('utf8')) as { signature: { timestamp: string; token: string } };
  const id = createHash('sha256').update(`${config.callbackId}:${signature.timestamp}:${signature.token}`).digest('hex');
  const bodyHash = createHash('sha256').update(raw).digest('hex');
  return privilegedDb.transaction(async tx => {
    await tx.delete(mailProviderRequests).where(and(eq(mailProviderRequests.organizationId, config.organizationId), lt(mailProviderRequests.expiresAt, new Date())));
    const inserted = await tx.insert(mailProviderRequests).values({ id, organizationId: config.organizationId, bodyHash,
      expiresAt: new Date((Number(signature.timestamp) + 600) * 1000) }).onConflictDoNothing().returning();
    if (inserted.length) return true;
    const [existing] = await tx.select().from(mailProviderRequests).where(eq(mailProviderRequests.id, id)).limit(1);
    return existing?.organizationId === config.organizationId && existing.bodyHash === bodyHash;
  });
}

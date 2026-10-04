import nodemailer, { type Transporter } from 'nodemailer';
import type { MailPurpose, MailState } from '@shared/mail-delivery';
import { queueMail, finishMail } from './mail-delivery';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { parseConnectionUrl } from 'nodemailer/lib/shared/index.js';
import { eq } from 'drizzle-orm';
import { mailSettings } from '@shared/mail-settings';
import { privilegedDb } from './db';
import { resolveMailConfiguration, type ResolvedMailConfiguration } from './mail-settings';
import { providerHeaders } from './mail-providers';
import { applyMailTemplate } from './mail-templates';
import { egressProxy } from './egress-proxy';

/**
 * Sending e-mail: invitations, password reset links, run notifications.
 *
 * Off until the operator sets SMTP_URL (smtp://user:pass@host:587, or smtps:// for implicit TLS)
 * and SMTP_FROM ("WebFlowMaster <qa@example.com>"). Off, every caller still works: the owner gets
 * the link to hand over, as before, and notifications go to the webhook only.
 *
 * Never throws: a message that cannot be delivered is reported to the caller, who says so — an
 * invitation still exists when the mail server is down.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  organizationId?: number | null;
  purpose?: MailPurpose;
  templateVariables?: Record<string, string>;
}

export interface MailResult {
  sent: boolean;
  /** Why not, when not: not configured, not an address, or what the mail server said. */
  error?: string;
  /** SMTP accepted this recipient; delivery is known only from a signed callback. */
  state?: MailState;
  deliveryId?: string;
}

/** Shaped like an address: the only usernames a link can be mailed to. */
const ADDRESS = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

export function isEmailAddress(value: string | null | undefined): value is string {
  return !!value && value.length <= 254 && ADDRESS.test(value);
}

/** For the tests: a transport in place of the SMTP one. */
export const mailerDeps: { transport?: Pick<Transporter, 'sendMail'> | null } = {};

let cached: { url: string; transport: Transporter } | null = null;

export function mailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return mailerDeps.transport !== undefined ? mailerDeps.transport !== null : !!(env.SMTP_URL?.trim() && env.SMTP_FROM?.trim());
}

export async function organizationMailConfigured(organizationId: number | null | undefined, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const config = await resolveMailConfiguration(organizationId, env);
  return config.inherited ? mailConfigured(env) : config.configured;
}
/** Public sign-in capability, independent of a supplied username; account availability is never disclosed. */
export async function mailAvailableOnInstallation(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (mailConfigured(env)) return true;
  return !!(await privilegedDb.select({ id: mailSettings.organizationId }).from(mailSettings).where(eq(mailSettings.smtpMode, 'custom')).limit(1)).length;
}
export function smtpTransportOptions(config: ResolvedMailConfiguration, env: NodeJS.ProcessEnv = process.env): SMTPTransport.Options & { proxy?: string } {
  let smtp = config.smtp;
  if (!smtp && config.smtpUrl) {
    const url = new URL(config.smtpUrl);
    if (!['smtp:', 'smtps:'].includes(url.protocol)) throw new Error('Invalid SMTP URL');
    smtp = parseConnectionUrl(config.smtpUrl) as SMTPTransport.Options;
    smtp.tls = { ...smtp.tls, ...(env.SMTP_TLS_REJECT_UNAUTHORIZED !== undefined ? { rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' } : {}) };
  }
  const proxy = egressProxy();
  return { ...smtp, logger: false, debug: false, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    ...(proxy ? { proxy: proxy.origin } : {}) };
}
function transportFor(env: NodeJS.ProcessEnv, config: ResolvedMailConfiguration): Pick<Transporter, 'sendMail'> {
  if (mailerDeps.transport) return mailerDeps.transport;
  const options = smtpTransportOptions(config, env);
  if (!config.inherited) return nodemailer.createTransport(options);
  const url = `${config.smtpUrl}:${env.SMTP_TLS_REJECT_UNAUTHORIZED}:${egressProxy()?.origin ?? ''}`;
  if (!cached || cached.url !== url) {
    // A self-signed relay inside a company network is common; SMTP_TLS_REJECT_UNAUTHORIZED=false allows it.
    cached = {
      url,
      transport: nodemailer.createTransport(options),
    };
  }
  return cached.transport;
}

/** The mail server's answer without the credentials in SMTP_URL. */
function refusalMessage(error: unknown): string {
  // Provider/transport errors can quote credentials, message content or reset URLs. Keep
  // only the SMTP numeric class: no raw error ever reaches logs through callers.
  const code = /\b([45]\d\d)\b/.exec((error as Error)?.message ?? '')?.[1];
  return `The mail server refused the message${code ? ` (${code})` : ''}.`;
}

export async function sendMail(message: MailMessage, env: NodeJS.ProcessEnv = process.env): Promise<MailResult> {
  if (!isEmailAddress(message.to)) return { sent: false, error: `"${message.to}" is not an e-mail address.` };
  let deliveryId: string | undefined;
  try {
    const config = await resolveMailConfiguration(message.organizationId, env);
    if (!(config.inherited ? mailConfigured(env) : config.configured)) return { sent: false, error: 'E-mail is not configured for this organization.' };
    const rendered = await applyMailTemplate(message);
    const queued = await queueMail(message.organizationId ?? null, message.to, message.purpose ?? 'other');
    deliveryId = queued.id;
    if (queued.suppressed) return { sent: false, state: 'suppressed', deliveryId, error: 'This recipient previously hard-bounced in this organization. Mail was not sent.' };
    const info = await transportFor(env, config).sendMail({ from: config.from || 'WebFlowMaster <no-reply@localhost>', to: message.to, subject: rendered.subject, text: rendered.text, html: rendered.html,
      messageId: `<${deliveryId}@webflowmaster.local>`, headers: { 'X-Wfm-Delivery-Id': deliveryId, ...(config.provider ? providerHeaders(config.provider, deliveryId) : {}) }, disableFileAccess: true, disableUrlAccess: true });
    const address = (value: any) => String(typeof value === 'string' ? value : value?.address ?? '').toLowerCase();
    const recipient = message.to.toLowerCase();
    const rejected = Array.isArray(info.rejected) && info.rejected.some((value: unknown) => address(value) === recipient);
    const accepted = Array.isArray(info.accepted) && info.accepted.some((value: unknown) => address(value) === recipient);
    if (rejected || !accepted) {
      await finishMail(deliveryId, 'rejected');
      return { sent: false, state: 'rejected', deliveryId, error: 'The mail server rejected or did not confirm this recipient.' };
    }
    await finishMail(deliveryId, 'accepted');
    return { sent: true, state: 'accepted', deliveryId };
  } catch (error) {
    if (deliveryId) { try { await finishMail(deliveryId, 'failed'); } catch { /* Never claim acceptance when tracking persistence fails. */ } }
    return { sent: false, ...(deliveryId ? { state: 'failed' as const, deliveryId } : {}), error: refusalMessage(error) };
  }
}

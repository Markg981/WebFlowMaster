import nodemailer, { type Transporter } from 'nodemailer';

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
}

export interface MailResult {
  sent: boolean;
  /** Why not, when not: not configured, not an address, or what the mail server said. */
  error?: string;
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

function transportFor(env: NodeJS.ProcessEnv): Pick<Transporter, 'sendMail'> {
  if (mailerDeps.transport) return mailerDeps.transport;
  const url = env.SMTP_URL!.trim();
  if (!cached || cached.url !== url) {
    // A self-signed relay inside a company network is common; SMTP_TLS_REJECT_UNAUTHORIZED=false allows it.
    cached = {
      url,
      transport: nodemailer.createTransport(url, {
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        tls: { rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' },
      }),
    };
  }
  return cached.transport;
}

/** The mail server's answer without the credentials in SMTP_URL. */
function redact(message: string, env: NodeJS.ProcessEnv): string {
  const url = env.SMTP_URL ?? '';
  const secret = /\/\/([^@/]+)@/.exec(url)?.[1];
  return secret ? message.split(secret).join('***') : message;
}

export async function sendMail(message: MailMessage, env: NodeJS.ProcessEnv = process.env): Promise<MailResult> {
  if (!mailConfigured(env)) return { sent: false, error: 'E-mail is not configured on this installation (SMTP_URL and SMTP_FROM).' };
  if (!isEmailAddress(message.to)) return { sent: false, error: `"${message.to}" is not an e-mail address.` };
  try {
    await transportFor(env).sendMail({ from: env.SMTP_FROM?.trim() || 'WebFlowMaster <no-reply@localhost>', to: message.to, subject: message.subject, text: message.text });
    return { sent: true };
  } catch (error) {
    return { sent: false, error: redact(`The mail server refused the message: ${(error as Error)?.message ?? error}`, env) };
  }
}

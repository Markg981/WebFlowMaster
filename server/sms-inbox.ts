import { createHash, randomBytes } from 'crypto';
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import { organizations, smsMessages, type SmsMessage } from '@shared/schema';
import { privilegedDb } from './db';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';

/**
 * The organization's test SMS inbox: codes sent by text message, for tests of a sign-in or a
 * payment that confirms with one.
 *
 * A test phone number at an SMS provider (Twilio, Vonage, MessageBird…) forwards what it receives
 * to /api/sms/inbound/<token> — Twilio's "A message comes in" webhook, Vonage's inbound URL. The
 * token is the organization's, shown once and kept hashed, so a provider can only file messages
 * into the organization that gave it out. A `waitForSms` step then waits for a message to its
 * number that arrived after the test started, and reads the code in it, as `waitForEmail` does.
 *
 * Messages are kept seven days: they are evidence for a run, not a mailbox.
 */

export const SMS_RETENTION_DAYS = 7;
export const SMS_TIMEOUT_MS = 60_000;
const TOKEN_PREFIX = 'wfm_sms_';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** The digits of a number, with its +: "+39 333 123-4567" and "393331234567" match. */
export function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? `+${digits.replace(/^00/, '')}` : '';
}

export interface InboundSms {
  to: string;
  from: string | null;
  body: string;
  provider: string;
}

/** What a provider posted: Twilio (To, From, Body), Vonage (to, msisdn, text), or plain { to, from, text }. */
export function readInbound(payload: Record<string, unknown>): InboundSms | null {
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) return value;
      if (typeof value === 'number') return String(value);
    }
    return null;
  };
  const provider = 'MessageSid' in payload || 'SmsSid' in payload ? 'twilio' : 'msisdn' in payload ? 'vonage' : 'generic';
  const to = get('To', 'to', 'recipient');
  const body = get('Body', 'text', 'body', 'message');
  if (!to || body === null) return null;
  return { to: normalizePhone(to), from: get('From', 'msisdn', 'from', 'sender'), body: body.slice(0, 5000), provider };
}

export interface SmsInboxStatus {
  prefix: string | null;
  createdAt: Date | null;
}

export async function smsInboxStatus(organizationId: number): Promise<SmsInboxStatus> {
  const [row] = await privilegedDb
    .select({ prefix: organizations.smsInboundTokenPrefix, createdAt: organizations.smsInboundTokenCreatedAt })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return { prefix: row?.prefix ?? null, createdAt: row?.createdAt ?? null };
}

/** A new inbound token for the organization; the previous one stops working at once. Shown once. */
export async function issueSmsToken(organizationId: number): Promise<{ token: string; status: SmsInboxStatus }> {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
  const status = { prefix: token.slice(0, TOKEN_PREFIX.length + 4), createdAt: new Date() };
  await privilegedDb
    .update(organizations)
    .set({ smsInboundTokenHash: hashToken(token), smsInboundTokenPrefix: status.prefix, smsInboundTokenCreatedAt: status.createdAt })
    .where(eq(organizations.id, organizationId));
  return { token, status };
}

export async function revokeSmsToken(organizationId: number): Promise<void> {
  await privilegedDb
    .update(organizations)
    .set({ smsInboundTokenHash: null, smsInboundTokenPrefix: null, smsInboundTokenCreatedAt: null })
    .where(eq(organizations.id, organizationId));
}

/**
 * Files a message a provider posted. The token decides the organization — the one lookup made
 * before there is a tenant — and the message is written under that organization's RLS.
 * Returns false for a token nobody holds.
 */
export async function receiveSms(token: string, sms: InboundSms): Promise<boolean> {
  if (!token.startsWith(TOKEN_PREFIX)) return false;
  const [org] = await privilegedDb
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.smsInboundTokenHash, hashToken(token)))
    .limit(1);
  if (!org) return false;
  await runWithTenant(org.id, () =>
    withTenantTransaction(async (tx) => {
      await tx.insert(smsMessages).values({ organizationId: org.id, toNumber: sms.to, fromNumber: sms.from, body: sms.body, provider: sms.provider });
      await tx.delete(smsMessages).where(lt(smsMessages.receivedAt, new Date(Date.now() - SMS_RETENTION_DAYS * 86_400_000)));
    }),
  );
  return true;
}

/** The most recent messages, for the settings page. */
export async function recentSms(limit = 20): Promise<SmsMessage[]> {
  return withTenantTransaction((tx) => tx.select().from(smsMessages).orderBy(desc(smsMessages.receivedAt)).limit(limit));
}

export interface SmsQuery {
  number: string;
  pattern: RegExp | null;
}

/** "+39 333 1234567", or "+39 333 1234567|code (\d{6})". */
export function parseSmsQuery(value: string): SmsQuery | { error: string } {
  const [rawNumber = '', ...rest] = value.split('|');
  const number = normalizePhone(rawNumber);
  if (number.length < 6) return { error: `"${rawNumber.trim()}" is not a phone number. The value is number, or number|pattern.` };
  const source = rest.join('|').trim();
  if (!source) return { number, pattern: null };
  try {
    return { number, pattern: new RegExp(source, 'i') };
  } catch (error) {
    return { error: `The pattern "${source}" is not a valid regular expression: ${(error as Error).message}.` };
  }
}

/** Clocks of the provider, this server and the database disagree a little. */
const CLOCK_SLACK_MS = 5_000;

/** Waits for a message to the number that arrived after `since`. Null when none did in time. */
export async function waitForSms(query: SmsQuery, since: number, timeoutMs: number, pollMs = 1000): Promise<SmsMessage | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [found] = await withTenantTransaction((tx) =>
      tx
        .select()
        .from(smsMessages)
        .where(and(eq(smsMessages.toNumber, query.number), gte(smsMessages.receivedAt, new Date(since - CLOCK_SLACK_MS))))
        .orderBy(asc(smsMessages.receivedAt))
        .limit(1),
    );
    if (found) return found;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
}

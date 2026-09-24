import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { AGENT_POOL_PATTERN, AGENT_TOKEN_PREFIX, type AgentEngine } from '@shared/agents';

/**
 * The two credentials of the agent relay.
 *
 * An agent's token says "I am this agent of this organization". It is long-lived, shown once,
 * and stored only as a hash, like an API key.
 *
 * A ticket says "this runner may borrow a browser from this organization's pool, now". The relay
 * is on the public address the agents dial, so its browser endpoint is reachable by anyone.
 * Without a ticket, anyone could borrow a customer's browser inside the customer's network. A
 * ticket is signed with a secret the server and its runners share, names one organization and
 * pool, and lasts a minute.
 */

export function generateAgentToken(): { token: string; prefix: string; hash: string } {
  const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, prefix: token.slice(0, AGENT_TOKEN_PREFIX.length + 6), hash: hashAgentToken(token) };
}

export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface BrowserTicket {
  organizationId: number;
  pool: string;
  engine: AgentEngine;
  channel?: string;
  headless: boolean;
  /** The runner's Playwright, which the agent's must match to be driven by it. */
  playwrightVersion: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

export const TICKET_LIFETIME_MS = 60_000;

/** The secret tickets are signed with; the server and every runner must have the same one. */
export function relaySecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.AGENT_RELAY_SECRET || env.SESSION_SECRET;
  if (!secret) throw new Error('AGENT_RELAY_SECRET (or SESSION_SECRET) must be set to use local agents.');
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signTicket(ticket: Omit<BrowserTicket, 'expiresAt'>, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...ticket, expiresAt: now + TICKET_LIFETIME_MS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The ticket, or why it is not one. Constant-time on the signature. */
export function verifyTicket(value: string, secret: string, now = Date.now()): BrowserTicket | { error: string } {
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return { error: 'malformed ticket' };
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { error: 'bad signature' };
  let ticket: BrowserTicket;
  try {
    ticket = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { error: 'malformed ticket' };
  }
  if (typeof ticket.expiresAt !== 'number' || ticket.expiresAt < now) return { error: 'expired ticket' };
  if (!Number.isInteger(ticket.organizationId) || !AGENT_POOL_PATTERN.test(ticket.pool)) return { error: 'malformed ticket' };
  if (!['chromium', 'firefox', 'webkit'].includes(ticket.engine)) return { error: 'malformed ticket' };
  return ticket;
}

import type { Options } from 'express-rate-limit';
import { sharedStore, type SharedRateLimitStore } from '../platform/middleware/rate-limit-store';

/**
 * A limit per account and address, on top of the one per address (authLimiter): an attacker only
 * locks their own address out of the account, never its owner. Guesses spread over many addresses
 * are slowed by an exponential backoff on the account alone (see registerAccountAttempt): never a
 * lock, so a stranger cannot keep the owner out for more than the backoff cap.
 *
 * Counted through the same store the address limiter uses: Redis when it answers (so every web
 * process shares one budget), this process's memory otherwise. Each attempt is counted before it
 * is checked and a success clears the count, so what remains is failures in the window. Past the
 * limit the account answers 429 with Retry-After until the window ends — with the right password
 * too, and the same for an account that does not exist, so it tells a stranger nothing.
 *
 * The second-factor count belongs to the account, not to the sign-in: a new password step does not
 * clear it. Only a correct code does.
 */

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const loginThrottleConfig = () => ({
  maxPasswordFailures: intEnv('LOGIN_MAX_FAILURES', 10),
  // Account-wide backoff, for guesses spread over many addresses: free attempts, then a delay that doubles.
  backoffAfter: intEnv('LOGIN_BACKOFF_AFTER', 5),
  backoffBaseMs: intEnv('LOGIN_BACKOFF_BASE_SECONDS', 2) * 1000,
  backoffMaxMs: intEnv('LOGIN_BACKOFF_MAX_SECONDS', 300) * 1000,
  maxMfaFailures: intEnv('MFA_MAX_FAILURES', 5),
  windowMs: intEnv('LOGIN_LOCK_WINDOW_MINUTES', 15) * 60_000,
});

export interface ThrottleVerdict {
  /** True when this attempt must be refused with 429. */
  locked: boolean;
  /** True only for the first refused attempt of a window: when to emit the audit event. */
  justLocked: boolean;
  retryAfterSeconds: number;
}

type Kind = 'password' | 'account' | 'mfa';
const stores = new Map<Kind, SharedRateLimitStore>();

function storeFor(kind: Kind) {
  let store = stores.get(kind);
  if (!store) {
    store = sharedStore(`account-${kind}`);
    store.init({ windowMs: loginThrottleConfig().windowMs } as Options);
    stores.set(kind, store);
  }
  return store;
}

/** Count one attempt on this key and say whether it is over the limit. */
export async function registerAttempt(
  kind: Exclude<Kind, 'account'>,
  key: string,
): Promise<ThrottleVerdict> {
  const cfg = loginThrottleConfig();
  const max = kind === 'password' ? cfg.maxPasswordFailures : cfg.maxMfaFailures;
  const info = await storeFor(kind).increment(key);
  const resetAt = info.resetTime?.getTime() ?? Date.now() + cfg.windowMs;
  return {
    locked: info.totalHits > max,
    justLocked: info.totalHits === max + 1,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}

export async function clearAttempts(kind: Kind, key: string): Promise<void> {
  if (kind === 'account') nextAllowedAt.delete(key);
  await storeFor(kind).resetKey(key);
}

/**
 * Account-wide backoff. The failure count is shared through the store (Redis when it answers); the
 * "not before" instant is kept in this process, so with several web processes each enforces the
 * delay on the attempts it receives itself. Refused attempts are not counted, so hammering the
 * account cannot raise the delay past what real tries earned; the delay never exceeds
 * LOGIN_BACKOFF_MAX_SECONDS and the count expires with the window.
 */
const nextAllowedAt = new Map<string, number>();
const MAX_TRACKED = 10_000;

export function backoffDelayMs(failures: number): number {
  const cfg = loginThrottleConfig();
  const over = failures - cfg.backoffAfter;
  if (over < 0) return 0;
  return Math.min(cfg.backoffMaxMs, cfg.backoffBaseMs * 2 ** Math.min(over, 30));
}

export async function registerAccountAttempt(
  key: string,
  now = Date.now(),
): Promise<ThrottleVerdict> {
  const store = storeFor('account');
  const until = nextAllowedAt.get(key) ?? 0;
  if (until > now) {
    return { locked: true, justLocked: false, retryAfterSeconds: Math.ceil((until - now) / 1000) };
  }
  const info = await store.increment(key);
  const delay = backoffDelayMs(info.totalHits - 1);
  if (delay > 0) {
    if (nextAllowedAt.size >= MAX_TRACKED) {
      for (const [k, t] of nextAllowedAt) if (t <= now) nextAllowedAt.delete(k);
      if (nextAllowedAt.size >= MAX_TRACKED) nextAllowedAt.clear();
    }
    nextAllowedAt.set(key, now + delay);
  } else nextAllowedAt.delete(key);
  return { locked: false, justLocked: false, retryAfterSeconds: 0 };
}

/** The password count belongs to the account seen from one address: a stranger cannot lock you out. */
export function passwordKey(username: unknown, ip: string | undefined): string {
  return `${usernameKey(username)}|${ip ?? ''}`;
}

export function usernameKey(username: unknown): string {
  return typeof username === 'string' ? username.trim().toLowerCase().slice(0, 256) : '';
}

/** Test hook: forget every in-process count (Redis counts are not touched). */
export function resetLoginThrottleForTests() {
  for (const s of stores.values()) s.shutdown();
  stores.clear();
  nextAllowedAt.clear();
}

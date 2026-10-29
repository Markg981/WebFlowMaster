import type { Options } from 'express-rate-limit';
import { sharedStore, type SharedRateLimitStore } from '../platform/middleware/rate-limit-store';

/**
 * A limit per account and address, on top of the one per address (authLimiter): an attacker only
 * locks their own address out of the account, never its owner. Guesses spread over many addresses
 * are caught by a higher limit on the account alone (LOGIN_MAX_FAILURES_ACCOUNT).
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
  // Backstop on the account alone, for guesses spread over many addresses; well above the per-address limit.
  maxAccountFailures: intEnv('LOGIN_MAX_FAILURES_ACCOUNT', 100),
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
export async function registerAttempt(kind: Kind, key: string): Promise<ThrottleVerdict> {
  const cfg = loginThrottleConfig();
  const max =
    kind === 'password'
      ? cfg.maxPasswordFailures
      : kind === 'account'
        ? cfg.maxAccountFailures
        : cfg.maxMfaFailures;
  const info = await storeFor(kind).increment(key);
  const resetAt = info.resetTime?.getTime() ?? Date.now() + cfg.windowMs;
  return {
    locked: info.totalHits > max,
    justLocked: info.totalHits === max + 1,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}

export async function clearAttempts(kind: Kind, key: string): Promise<void> {
  await storeFor(kind).resetKey(key);
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
}

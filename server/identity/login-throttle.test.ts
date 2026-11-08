import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backoffDelayMs,
  clearAttempts,
  registerAccountAttempt,
  resetLoginThrottleForTests,
} from './login-throttle';

describe('account backoff', () => {
  beforeEach(() => {
    process.env.LOGIN_BACKOFF_AFTER = '2';
    process.env.LOGIN_BACKOFF_BASE_SECONDS = '2';
    process.env.LOGIN_BACKOFF_MAX_SECONDS = '10';
    resetLoginThrottleForTests();
  });
  afterEach(() => {
    delete process.env.LOGIN_BACKOFF_AFTER;
    delete process.env.LOGIN_BACKOFF_BASE_SECONDS;
    delete process.env.LOGIN_BACKOFF_MAX_SECONDS;
    resetLoginThrottleForTests();
  });

  it('doubles the delay up to the cap', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(backoffDelayMs)).toEqual([
      0, 0, 2000, 4000, 8000, 10000, 10000,
    ]);
  });

  it('escalates, refuses inside the delay and never counts refused attempts', async () => {
    const t = 1_000_000;
    expect((await registerAccountAttempt('a', t)).locked).toBe(false);
    expect((await registerAccountAttempt('a', t)).locked).toBe(false);
    expect((await registerAccountAttempt('a', t)).locked).toBe(false); // 3rd: sets 2 s delay
    const refused = await registerAccountAttempt('a', t + 500);
    expect(refused.locked).toBe(true);
    expect(refused.retryAfterSeconds).toBe(2);
    expect((await registerAccountAttempt('a', t + 500)).retryAfterSeconds).toBe(2);
    expect((await registerAccountAttempt('a', t + 2000)).locked).toBe(false); // 4th: 4 s delay
    expect((await registerAccountAttempt('a', t + 3000)).retryAfterSeconds).toBe(3);
  });

  it('is per account and expires once the delay has passed', async () => {
    const t = 5_000_000;
    for (let i = 0; i < 3; i++) await registerAccountAttempt('a', t);
    expect((await registerAccountAttempt('b', t)).locked).toBe(false);
    expect((await registerAccountAttempt('a', t + 60_000)).locked).toBe(false);
  });

  it('a success clears the backoff', async () => {
    const t = 9_000_000;
    for (let i = 0; i < 4; i++) await registerAccountAttempt('a', t + i * 20_000);
    await clearAttempts('account', 'a');
    expect((await registerAccountAttempt('a', t + 80_001)).locked).toBe(false);
    expect((await registerAccountAttempt('a', t + 80_001)).locked).toBe(false);
  });
});

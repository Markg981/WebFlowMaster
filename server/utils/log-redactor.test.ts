import { describe, it, expect } from 'vitest';
import { redactObject, redactString } from './log-redactor';

/**
 * The string scrubber exists for free text — an incident's `title` and `error.message` —
 * where key-based redaction cannot reach. Its ordering is subtle enough to be worth
 * pinning: an earlier version consumed the word "Bearer" as the value of the preceding
 * sensitive key and left the actual token in clear text.
 */
describe('redactString', () => {
  it('masks a bearer token that follows a sensitive key', () => {
    const result = redactString('Authorization: Bearer abc.def.ghi');

    expect(result).not.toContain('abc.def.ghi');
    expect(result).toContain('[REDACTED]');
  });

  it('masks a bare bearer token', () => {
    expect(redactString('Bearer abc.def.ghi')).not.toContain('abc.def.ghi');
  });

  it('masks key=value and key: value shapes', () => {
    expect(redactString('password=hunter2')).not.toContain('hunter2');
    expect(redactString('password: hunter2')).not.toContain('hunter2');
    expect(redactString('token="x y z"')).not.toContain('x y z');
  });

  it('leaves diagnostic text intact', () => {
    const message = 'Cannot read properties of undefined (reading selector)';
    expect(redactString(message)).toBe(message);
  });

  it('does not mask a sensitive word used as prose rather than as a key', () => {
    // No separator, so there is no value to hide and the sentence stays readable.
    expect(redactString('authorization header was missing')).toBe('authorization header was missing');
  });

  it('handles an empty string without throwing', () => {
    expect(redactString('')).toBe('');
  });
});

describe('redactObject', () => {
  it('masks sensitive keys at any depth while keeping the rest', () => {
    const redacted = redactObject({
      username: 'marco',
      auth: { password: 'hunter2', nested: { token: 'abc' } },
    }) as Record<string, any>;

    expect(redacted.username).toBe('marco');
    expect(redacted.auth.password).toBe('[REDACTED]');
    expect(redacted.auth.nested.token).toBe('[REDACTED]');
  });

  it('walks arrays', () => {
    const redacted = redactObject([{ password: 'a' }, { safe: 'b' }]) as Record<string, any>[];

    expect(redacted[0].password).toBe('[REDACTED]');
    expect(redacted[1].safe).toBe('b');
  });

  it('survives a circular reference', () => {
    const circular: Record<string, unknown> = { password: 'hunter2' };
    circular.self = circular;

    expect(() => redactObject(circular)).not.toThrow();
  });
});

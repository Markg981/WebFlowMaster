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

  /**
   * redactString derives its vocabulary from the same SENSITIVE_KEYS source as redactObject
   * (see SENSITIVE_KEY_ALTERNATION above it in log-redactor.ts), so broadening that pattern
   * for finding #2 risked making the free-text scrubber over-eager too. These pin that it
   * isn't: the new compounds only fire on an actual `key: value` / `key=value` shape, and
   * ordinary prose containing the same words stays untouched.
   */
  it('masks new compound credential shapes in key:value prose without becoming over-eager', () => {
    expect(redactString('access_token=abc123')).not.toContain('abc123');
    expect(redactString('client_secret: "shh"')).not.toContain('shh');

    const message = 'Cannot read properties of undefined (reading selector)';
    expect(redactString(message)).toBe(message);
    // Note: deliberately avoids the word "bearer" here — that's a separate, pre-existing
    // pattern (BEARER_TOKEN_PATTERN) with its own dedicated tests above, not part of this change.
    expect(redactString('authType is oauth2 for this request')).toBe('authType is oauth2 for this request');
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

  /**
   * SENSITIVE_KEYS originally only matched exact names, so common compounds carrying real
   * credentials (an OAuth access token, an API token, a client secret) slipped through in
   * cleartext. Both the snake_case and camelCase spellings are pinned here because the
   * pattern matches them via an optional-underscore idiom, not two separate literals.
   */
  it('masks compound credential key names in both snake_case and camelCase', () => {
    const redacted = redactObject({
      access_token: 'a',
      accessToken: 'b',
      refresh_token: 'c',
      refreshToken: 'd',
      apiToken: 'e',
      api_token: 'f',
      client_secret: 'g',
      clientSecret: 'h',
      private_key: 'i',
      privateKey: 'j',
      pwd: 'k',
    }) as Record<string, unknown>;

    for (const value of Object.values(redacted)) {
      expect(value).toBe('[REDACTED]');
    }
  });

  /**
   * The broadened pattern above is deliberately an enumerated list of compounds, not a
   * generic "contains 'auth'/'token'/'password'" substring rule — because these four field
   * names, all real shapes that appear in this codebase's payloads, would be false positives
   * under a naive substring match: none of them holds a credential.
   */
  it('does not mask fields that merely contain a sensitive word but are not credentials', () => {
    const redacted = redactObject({
      author: 'Ada Lovelace', // a person's name, not "auth" + suffix
      authType: 'bearer', // names an authorization *scheme*, not a secret value
      tokenCount: 42, // how many tokens, not a token
      passwordConfirmed: true, // a boolean flag, not the password itself
    }) as Record<string, unknown>;

    expect(redacted.author).toBe('Ada Lovelace');
    expect(redacted.authType).toBe('bearer');
    expect(redacted.tokenCount).toBe(42);
    expect(redacted.passwordConfirmed).toBe(true);
  });
});

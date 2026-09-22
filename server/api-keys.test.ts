import { describe, it, expect } from 'vitest';
import {
  API_KEY_PREFIX,
  apiKeyFromRequest,
  generateApiKey,
  hashApiKey,
  hashesMatch,
  rejectionFor,
} from './api-keys';

/**
 * The credential a pipeline carries. Everything here existed only behind a session cookie,
 * so CI could reach the API only by holding somebody's password.
 */

describe('generateApiKey', () => {
  it('mints a marked, high-entropy key and keeps only its hash', () => {
    const generated = generateApiKey();

    expect(generated.key.startsWith(`${API_KEY_PREFIX}_`)).toBe(true);
    // 32 bytes in base64url, plus the marker.
    expect(generated.key.length).toBeGreaterThan(40);
    expect(generated.hashedKey).toBe(hashApiKey(generated.key));
    expect(generated.hashedKey).not.toContain(generated.key);
  });

  it('never mints the same key twice', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().key));

    expect(keys.size).toBe(50);
  });

  it('shows enough of the key to tell two apart, and far too little to use', () => {
    const generated = generateApiKey();

    expect(generated.prefix.length).toBeLessThan(generated.key.length / 2);
    expect(generated.key.startsWith(generated.prefix)).toBe(true);
  });

  it('produces something that survives a shell, a header and a YAML file unescaped', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateApiKey().key).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('hashesMatch', () => {
  it('accepts a match and refuses anything else', () => {
    const { key, hashedKey } = generateApiKey();

    expect(hashesMatch(hashApiKey(key), hashedKey)).toBe(true);
    expect(hashesMatch(hashApiKey('wfm_something-else'), hashedKey)).toBe(false);
    expect(hashesMatch('short', hashedKey)).toBe(false);
  });
});

describe('apiKeyFromRequest', () => {
  it('reads both spellings, because both are what pipelines already write', () => {
    expect(apiKeyFromRequest({ authorization: 'Bearer wfm_abc' })).toBe('wfm_abc');
    expect(apiKeyFromRequest({ authorization: 'bearer wfm_abc' })).toBe('wfm_abc');
    expect(apiKeyFromRequest({ 'x-api-key': 'wfm_abc' })).toBe('wfm_abc');
  });

  it('prefers the explicit header when a request carries both', () => {
    expect(apiKeyFromRequest({ authorization: 'Bearer wfm_from-auth', 'x-api-key': 'wfm_explicit' }))
      .toBe('wfm_explicit');
  });

  it("ignores a Bearer token that is not one of ours, rather than failing somebody else's login", () => {
    expect(apiKeyFromRequest({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.some.jwt' })).toBeNull();
    expect(apiKeyFromRequest({ authorization: 'Basic dXNlcjpwYXNz' })).toBeNull();
    expect(apiKeyFromRequest({})).toBeNull();
  });
});

describe('rejectionFor', () => {
  const now = new Date('2026-09-22T10:00:00Z');

  it('accepts a live key', () => {
    expect(rejectionFor({ revokedAt: null, expiresAt: null }, now)).toBeNull();
    expect(rejectionFor({ expiresAt: new Date('2026-09-23T10:00:00Z') }, now)).toBeNull();
  });

  it('names why it refused the others', () => {
    expect(rejectionFor(undefined, now)).toBe('unknown');
    expect(rejectionFor({ revokedAt: new Date('2026-09-01T00:00:00Z') }, now)).toBe('revoked');
    expect(rejectionFor({ expiresAt: new Date('2026-09-22T09:59:59Z') }, now)).toBe('expired');
  });

  it('treats a key expiring exactly now as expired', () => {
    expect(rejectionFor({ expiresAt: now }, now)).toBe('expired');
  });
});

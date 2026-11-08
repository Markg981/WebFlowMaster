import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveMasterKey, masterKeyForm } from './master-keys';
import { startupConfigErrors, startupConfigWarnings } from '../startup-config';

const prod = {
  SESSION_SECRET: 's'.repeat(32),
  NODE_ENV: 'production',
  WEBFLOW_PUBLIC_URL: 'https://wfm.example.com',
};
const hex = 'ab'.repeat(32);
const b64 = `base64:${Buffer.alloc(32, 7).toString('base64')}`;
const hkdf = `hkdf:${'x'.repeat(40)}`;

describe('master key derivation (B-11)', () => {
  it('keeps hex and legacy passphrases unchanged so old ciphertexts still decrypt', () => {
    expect(deriveMasterKey(hex).equals(Buffer.from(hex, 'hex'))).toBe(true);
    expect(
      deriveMasterKey('old passphrase').equals(
        createHash('sha256').update('old passphrase').digest(),
      ),
    ).toBe(true);
  });
  it('derives the versioned forms', () => {
    expect(deriveMasterKey(b64).equals(Buffer.alloc(32, 7))).toBe(true);
    const k = deriveMasterKey(hkdf);
    expect(k).toHaveLength(32);
    expect(k.equals(deriveMasterKey(hkdf))).toBe(true);
    expect(k.equals(createHash('sha256').update(hkdf).digest())).toBe(false);
  });
  it('classifies forms', () => {
    expect(masterKeyForm(hex)).toBe('hex');
    expect(masterKeyForm(b64)).toBe('base64');
    expect(masterKeyForm(hkdf)).toBe('hkdf');
    expect(masterKeyForm('hkdf:short')).toBe('legacy');
    expect(masterKeyForm('base64:AAAA')).toBe('legacy');
  });
  it('refuses a weak key in production, accepts strong ones', () => {
    expect(
      startupConfigErrors({
        ...prod,
        ENCRYPTION_KEY: 'a-long-passphrase-that-is-hashed-only',
      }).join(),
    ).toMatch(/ENCRYPTION_KEY is too weak/);
    for (const key of [hex, b64, hkdf]) {
      expect(startupConfigErrors({ ...prod, ENCRYPTION_KEY: key }).join()).not.toMatch(
        /ENCRYPTION_KEY/,
      );
    }
  });
  it('only warns about a weak key in development', () => {
    const env = { SESSION_SECRET: 's'.repeat(32), ENCRYPTION_KEY: 'passphrase' };
    expect(startupConfigErrors(env)).toEqual([]);
    expect(startupConfigWarnings(env).join()).toMatch(/ENCRYPTION_KEY/);
  });
});

describe('startup warnings and INSTALLATION_ADMINS (B-16, B-17)', () => {
  it('warns once when REDIS_URL is missing in production', () => {
    expect(startupConfigWarnings(prod).filter((w) => w.startsWith('REDIS_URL'))).toHaveLength(1);
    expect(startupConfigWarnings({ ...prod, REDIS_URL: 'redis://r:6379' }).join()).not.toMatch(
      /REDIS_URL/,
    );
  });
  it('validates INSTALLATION_ADMINS', () => {
    const errs = (v: string) =>
      startupConfigErrors({ SESSION_SECRET: 's'.repeat(32), INSTALLATION_ADMINS: v }).join();
    expect(errs('Ops@x.com, olivia')).toBe('');
    expect(errs('ops,,olivia')).toMatch(/empty entry/);
    expect(errs('Ops,ops')).toMatch(/more than once/);
    expect(errs('a b')).toMatch(/whitespace/);
  });
});

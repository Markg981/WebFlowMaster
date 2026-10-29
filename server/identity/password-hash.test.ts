import { describe, it, expect } from 'vitest';
import { scryptSync } from 'node:crypto';
import { hashPassword, comparePasswords, needsRehash } from './auth';

describe('stored password hashes (audit C-38 ID-12)', () => {
  it('writes a versioned hash that verifies', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored).toMatch(/^scrypt\$\d+\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await comparePasswords('correct horse', stored)).toBe(true);
    expect(await comparePasswords('wrong', stored)).toBe(false);
  });

  it('still verifies the original hash.salt format, and asks for it to be rewritten', async () => {
    const salt = 'cd'.repeat(16);
    const legacy = `${scryptSync('old password', salt, 64).toString('hex')}.${salt}`;
    expect(await comparePasswords('old password', legacy)).toBe(true);
    expect(await comparePasswords('nope', legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(await hashPassword('x'))).toBe(false);
  });

  it('refuses a malformed or unusable stored value instead of throwing', async () => {
    expect(await comparePasswords('x', '!service-account:abc')).toBe(false);
    expect(await comparePasswords('x', 'scrypt$99$8$1$aa$bb')).toBe(false);
  });
});

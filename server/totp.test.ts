import { describe, it, expect, vi, afterEach } from 'vitest';
import { decodeBase32, parseTotpSeed, totpAt } from './totp';
import { substituteVariables } from './outbound-http';
import { findUnresolvedVariables } from './variables';

/** {{$totp(name)}}: the code an authenticator app would show for the seed in {{name}}. */

// RFC 6238, appendix B: the ASCII seed "12345678901234567890", 8 digits, SHA-1.
const RFC_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

afterEach(() => vi.useRealTimers());

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    const params = parseTotpSeed(`otpauth://totp/Test?secret=${RFC_SEED}&digits=8`)!;
    expect(totpAt(params, 59_000)).toBe('94287082');
    expect(totpAt(params, 1_111_111_109_000)).toBe('07081804');
    expect(totpAt(params, 1_234_567_890_000)).toBe('89005924');
    expect(totpAt(params, 20_000_000_000_000)).toBe('65353130');
  });

  it('reads a seed as authenticator apps show it', () => {
    expect(decodeBase32('gezd gnbv-gy3t qojq')).toEqual(Buffer.from('1234567890'));
    expect(parseTotpSeed(RFC_SEED)).toMatchObject({ digits: 6, period: 30, algorithm: 'sha1' });
    expect(parseTotpSeed('otpauth://totp/Shop:ann?secret=JBSWY3DPEHPK3PXP&issuer=Shop&algorithm=SHA256&period=60')).toMatchObject({ digits: 6, period: 60, algorithm: 'sha256' });
    expect(parseTotpSeed('not base32!')).toBeNull();
    expect(parseTotpSeed('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP')).toBeNull();
    expect(parseTotpSeed('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=4')).toBeNull();
  });

  it('is typed as {{$totp(name)}}, and reported by name when it cannot be made', () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000);
    const vars = { secret_mfa: RFC_SEED, broken: 'nope!' };
    // Six digits of the same code: 94287082 → 287082.
    expect(substituteVariables('code {{$totp(secret_mfa)}}', vars)).toBe('code 287082');
    expect(findUnresolvedVariables('{{$totp(secret_mfa)}}', vars)).toEqual([]);
    expect(findUnresolvedVariables('{{$totp(missing)}} {{$totp(broken)}} {{$totp}}', vars)).toEqual(['$totp(missing)', '$totp(broken)', '$totp']);
  });
});

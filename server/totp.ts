import { createHmac } from 'crypto';

/**
 * Time-based one-time codes (RFC 6238), for `{{$totp(name)}}`.
 *
 * A test of an application with two-factor sign-in has to type the code its authenticator app
 * would show. The seed is what the application displayed when the test account enrolled — the
 * base32 key under the QR code, or the otpauth:// address the QR code holds — kept as an
 * environment secret, so it is encrypted and never written into a step.
 */

export interface TotpParams {
  secret: Buffer;
  digits: number;
  period: number;
  algorithm: 'sha1' | 'sha256' | 'sha512';
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 as authenticator seeds are written: any case, spaces and dashes ignored, padding optional. */
export function decodeBase32(text: string): Buffer | null {
  const clean = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (clean === '') return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The seed and settings from a base32 key or an otpauth://totp/… address. Null when it is neither. */
export function parseTotpSeed(seed: string): TotpParams | null {
  const text = seed.trim();
  if (/^otpauth:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.hostname.toLowerCase() !== 'totp') return null;
    const secret = decodeBase32(url.searchParams.get('secret') ?? '');
    const digits = Number(url.searchParams.get('digits') ?? 6);
    const period = Number(url.searchParams.get('period') ?? 30);
    const algorithm = (url.searchParams.get('algorithm') ?? 'SHA1').toLowerCase();
    if (!secret || ![6, 7, 8].includes(digits) || !Number.isInteger(period) || period < 1 || period > 300) return null;
    if (algorithm !== 'sha1' && algorithm !== 'sha256' && algorithm !== 'sha512') return null;
    return { secret, digits, period, algorithm };
  }
  const secret = decodeBase32(text);
  return secret ? { secret, digits: 6, period: 30, algorithm: 'sha1' } : null;
}

/** The code for a moment (epoch ms). */
export function totpAt(params: TotpParams, at: number): string {
  const counter = Math.floor(at / 1000 / params.period);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(params.algorithm, params.secret).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** params.digits).padStart(params.digits, '0');
}

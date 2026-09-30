import crypto from 'crypto';
import type { z } from 'zod';
import type {
  AkamaiEdgeGridAuthParamsSchema,
  AsapAuthParamsSchema,
  AwsSigV4AuthParamsSchema,
  DigestAuthParamsSchema,
  HawkAuthParamsSchema,
  JwtBearerAuthParamsSchema,
  NtlmAuthParamsSchema,
  OAuth1AuthParamsSchema,
} from '@shared/schema';

/**
 * The authentication schemes beyond Basic, Bearer, API key and OAuth 2.0: how each one signs,
 * or answers the server's challenge (server/api-test-runner.ts applies them).
 *
 * Everything here is a pure function of the request and the time, so each scheme is tested
 * against its published vectors rather than against a live service.
 */

export type JwtBearerParams = z.infer<typeof JwtBearerAuthParamsSchema>;
export type DigestParams = z.infer<typeof DigestAuthParamsSchema>;
export type OAuth1Params = z.infer<typeof OAuth1AuthParamsSchema>;
export type HawkParams = z.infer<typeof HawkAuthParamsSchema>;
export type AwsParams = z.infer<typeof AwsSigV4AuthParamsSchema>;
export type NtlmParams = z.infer<typeof NtlmAuthParamsSchema>;
export type AkamaiParams = z.infer<typeof AkamaiEdgeGridAuthParamsSchema>;
export type AsapParams = z.infer<typeof AsapAuthParamsSchema>;

/** What a signature is computed over. */
export interface SignedRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string | Buffer | undefined;
}

export interface Clock {
  now: Date;
  /** A fresh random value, as the scheme needs it. */
  nonce: () => string;
}

export const systemClock = (): Clock => ({ now: new Date(), nonce: () => crypto.randomBytes(16).toString('hex') });

const header = (headers: Record<string, string>, name: string) =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const bodyBytes = (body: string | Buffer | undefined) => (body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body));
const sha256 = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest();
const hmac = (algorithm: string, key: crypto.BinaryLike, data: string | Buffer) => crypto.createHmac(algorithm, key).update(data).digest();
const base64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** RFC 3986 unreserved characters only, as OAuth 1.0 and AWS both require. */
export const rfc3986 = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function parseJsonObject(text: string, what: string): Record<string, unknown> | string {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : `${what} must be a JSON object.`;
  } catch {
    return `${what} is not valid JSON.`;
  }
}

// ─── JWT (JWT Bearer, Atlassian ASAP) ─────────────────────────────────────────

const JWT_HASH: Record<string, string> = { '256': 'sha256', '384': 'sha384', '512': 'sha512' };

/** A signed JWT, or the reason it cannot be made. */
export function signJwt(
  algorithm: string,
  key: string | Buffer,
  headerFields: Record<string, unknown>,
  claims: Record<string, unknown>,
): { token: string } | { error: string } {
  const hash = JWT_HASH[algorithm.slice(2)];
  if (!hash) return { error: `Unsupported JWT algorithm ${algorithm}.` };
  const input = `${base64url(JSON.stringify({ ...headerFields, alg: algorithm, typ: headerFields.typ ?? 'JWT' }))}.${base64url(JSON.stringify(claims))}`;
  try {
    let signature: Buffer;
    if (algorithm.startsWith('HS')) {
      signature = hmac(hash, key, input);
    } else {
      // ES* signatures are the raw r||s pair in a JWT, not the DER Node produces by default.
      signature = crypto.sign(hash, Buffer.from(input), {
        key: typeof key === 'string' ? key : key.toString(),
        ...(algorithm.startsWith('ES') ? { dsaEncoding: 'ieee-p1363' as const } : {}),
      });
    }
    return { token: `${input}.${base64url(signature)}` };
  } catch (error: any) {
    return { error: `The ${algorithm} key could not sign: ${error?.message ?? error}. It must be a PEM private key.` };
  }
}

export function jwtBearer(params: JwtBearerParams, clock: Clock): { token: string } | { error: string } {
  if (!params.secret) return { error: 'JWT Bearer needs a secret or a private key.' };
  const claims = parseJsonObject(params.payload, 'The JWT payload');
  if (typeof claims === 'string') return { error: claims };
  const headerFields = parseJsonObject(params.headers, 'The JWT headers');
  if (typeof headerFields === 'string') return { error: headerFields };
  const key = params.algorithm.startsWith('HS') && params.secretBase64 ? Buffer.from(params.secret, 'base64') : params.secret;
  return signJwt(params.algorithm, key, headerFields, { iat: Math.floor(clock.now.getTime() / 1000), ...claims });
}

/** Atlassian's service-to-service token: a short-lived JWT with its own required claims. */
export function asapToken(params: AsapParams, clock: Clock): { token: string } | { error: string } {
  const missing = (['issuer', 'audience', 'keyId', 'privateKey'] as const).filter((field) => !params[field]);
  if (missing.length) return { error: `Atlassian ASAP needs ${missing.join(', ')}.` };
  const extra = parseJsonObject(params.additionalClaims, 'The additional claims');
  if (typeof extra === 'string') return { error: extra };
  const iat = Math.floor(clock.now.getTime() / 1000);
  const audiences = params.audience.split(',').map((a) => a.trim()).filter(Boolean);
  return signJwt(params.algorithm, params.privateKey, { kid: params.keyId }, {
    ...extra,
    iss: params.issuer,
    sub: params.subject || params.issuer,
    aud: audiences.length === 1 ? audiences[0] : audiences,
    iat,
    exp: iat + params.expirySeconds,
    jti: crypto.randomUUID(),
  });
}

// ─── Digest (RFC 7616, RFC 2617) ──────────────────────────────────────────────

export function parseChallenge(value: string, scheme: string): Record<string, string> | null {
  const match = value.match(new RegExp(`${scheme}\\s+(.*)`, 'i'));
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const [, key, quoted, bare] of match[1].matchAll(/([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]*))/gi)) {
    fields[key.toLowerCase()] = quoted !== undefined ? quoted.replace(/\\(.)/g, '$1') : bare;
  }
  return fields;
}

export function digestAuthorization(
  challenge: Record<string, string>,
  params: DigestParams,
  request: { method: string; uri: string; body?: string | Buffer },
  cnonce: string,
  nc = 1,
): string | { error: string } {
  const algorithm = (challenge.algorithm || 'MD5').toUpperCase();
  const base = algorithm.replace(/-SESS$/, '');
  const hashName = base === 'MD5' ? 'md5' : base === 'SHA-256' ? 'sha256' : base === 'SHA-512-256' ? 'sha512-256' : null;
  if (!hashName) return { error: `The server asked for Digest with ${algorithm}, which is not supported.` };
  const H = (text: string) => crypto.createHash(hashName).update(text).digest('hex');
  const qops = (challenge.qop ?? '').split(',').map((q) => q.trim());
  const qop = qops.includes('auth') ? 'auth' : qops.includes('auth-int') ? 'auth-int' : null;
  const ncHex = nc.toString(16).padStart(8, '0');
  let ha1 = H(`${params.username}:${challenge.realm ?? ''}:${params.password}`);
  if (algorithm.endsWith('-SESS')) ha1 = H(`${ha1}:${challenge.nonce}:${cnonce}`);
  const ha2 =
    qop === 'auth-int'
      ? H(`${request.method}:${request.uri}:${crypto.createHash(hashName).update(bodyBytes(request.body)).digest('hex')}`)
      : H(`${request.method}:${request.uri}`);
  const response = qop ? H(`${ha1}:${challenge.nonce}:${ncHex}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [
    `username="${params.username}"`,
    `realm="${challenge.realm ?? ''}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${request.uri}"`,
    `algorithm=${challenge.algorithm || 'MD5'}`,
    ...(qop ? [`qop=${qop}`, `nc=${ncHex}`, `cnonce="${cnonce}"`] : []),
    `response="${response}"`,
    ...(challenge.opaque !== undefined ? [`opaque="${challenge.opaque}"`] : []),
  ];
  return `Digest ${parts.join(', ')}`;
}

// ─── OAuth 1.0a (RFC 5849) ────────────────────────────────────────────────────

export function oauth1(params: OAuth1Params, request: SignedRequest, clock: Clock): { header?: string; query?: Array<[string, string]> } | { error: string } {
  if (!params.consumerKey) return { error: 'OAuth 1.0 needs a consumer key.' };
  const oauth: Record<string, string> = {
    oauth_consumer_key: params.consumerKey,
    oauth_nonce: clock.nonce(),
    oauth_signature_method: params.signatureMethod,
    oauth_timestamp: String(Math.floor(clock.now.getTime() / 1000)),
    oauth_version: '1.0',
    ...(params.token ? { oauth_token: params.token } : {}),
  };
  const key = `${rfc3986(params.consumerSecret)}&${rfc3986(params.tokenSecret)}`;
  let signature: string;
  if (params.signatureMethod === 'PLAINTEXT') {
    signature = key;
  } else {
    const pairs: Array<[string, string]> = [...request.url.searchParams.entries()];
    // A form body's fields are part of what is signed (§3.4.1.3.1); a JSON body is not.
    if (/application\/x-www-form-urlencoded/i.test(header(request.headers, 'content-type') ?? '') && request.body !== undefined) {
      pairs.push(...new URLSearchParams(bodyBytes(request.body).toString()).entries());
    }
    pairs.push(...Object.entries(oauth));
    const normalized = pairs
      .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
      .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const baseUrl = `${request.url.protocol}//${request.url.host.toLowerCase()}${request.url.pathname}`;
    const base = [request.method.toUpperCase(), rfc3986(baseUrl), rfc3986(normalized)].join('&');
    const hash = { 'HMAC-SHA1': 'sha1', 'HMAC-SHA256': 'sha256', 'HMAC-SHA512': 'sha512' }[params.signatureMethod];
    signature = hmac(hash, key, base).toString('base64');
  }
  const signed = { ...oauth, oauth_signature: signature };
  if (params.addTo === 'query') return { query: Object.entries(signed) };
  const fields = Object.entries(signed).map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`);
  return { header: `OAuth ${params.realm ? `realm="${params.realm}", ` : ''}${fields.join(', ')}` };
}

// ─── Hawk ─────────────────────────────────────────────────────────────────────

export function hawk(params: HawkParams, request: SignedRequest, clock: Clock): { header: string } | { error: string } {
  if (!params.authId || !params.authKey) return { error: 'Hawk needs an ID and a key.' };
  const ts = String(Math.floor(clock.now.getTime() / 1000));
  const nonce = clock.nonce().slice(0, 6);
  const port = request.url.port || (request.url.protocol === 'https:' ? '443' : '80');
  let hash = '';
  if (params.includePayloadHash) {
    const contentType = (header(request.headers, 'content-type') ?? '').split(';')[0].trim().toLowerCase();
    hash = crypto
      .createHash(params.algorithm)
      .update(`hawk.1.payload\n${contentType}\n`)
      .update(bodyBytes(request.body))
      .update('\n')
      .digest('base64');
  }
  const normalized = [
    'hawk.1.header', ts, nonce, request.method.toUpperCase(), `${request.url.pathname}${request.url.search}`,
    request.url.hostname.toLowerCase(), port, hash, params.ext.replace(/\\/g, '\\\\').replace(/\n/g, '\\n'),
  ].join('\n') + '\n';
  const mac = hmac(params.algorithm, params.authKey, normalized).toString('base64');
  const fields = [`id="${params.authId}"`, `ts="${ts}"`, `nonce="${nonce}"`, ...(hash ? [`hash="${hash}"`] : []), ...(params.ext ? [`ext="${params.ext}"`] : []), `mac="${mac}"`];
  return { header: `Hawk ${fields.join(', ')}` };
}

// ─── AWS Signature Version 4 ──────────────────────────────────────────────────

/** The AWS service a host belongs to, when the test leaves it out: s3.eu-west-1.amazonaws.com → s3. */
export function awsServiceOf(host: string): string {
  const match = host.match(/^(?:[^.]+\.)?([a-z0-9-]+)(?:[.-][a-z]{2}-[a-z]+-\d)?\.amazonaws\.com(?:\.cn)?$/);
  return match?.[1] ?? '';
}

export function awsSigV4(params: AwsParams, request: SignedRequest, clock: Clock): { headers: Record<string, string> } | { error: string } {
  if (!params.accessKey || !params.secretKey) return { error: 'AWS Signature needs an access key and a secret key.' };
  const service = params.service || awsServiceOf(request.url.hostname);
  if (!service) return { error: 'AWS Signature needs the service name (s3, execute-api, …): it could not be read from the host.' };
  const region = params.region || 'us-east-1';
  const amzDate = clock.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(bodyBytes(request.body)).toString('hex');

  const added: Record<string, string> = { 'x-amz-date': amzDate };
  if (service === 's3') added['x-amz-content-sha256'] = payloadHash;
  if (params.sessionToken) added['x-amz-security-token'] = params.sessionToken;
  const all: Record<string, string> = { host: request.url.host };
  for (const [key, value] of Object.entries({ ...request.headers, ...added })) all[key.toLowerCase()] = value;
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((name) => `${name}:${String(all[name]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');

  // S3 takes the path as it is; every other service wants each segment encoded twice.
  const segments = request.url.pathname.split('/').map((segment) => {
    const once = rfc3986(decodeURIComponent(segment));
    return service === 's3' ? once : rfc3986(once);
  });
  const canonicalUri = segments.join('/') || '/';
  const canonicalQuery = [...request.url.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : 1) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [request.method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest).toString('hex')].join('\n');
  let key: Buffer = hmac('sha256', `AWS4${params.secretKey}`, dateStamp);
  for (const part of [region, service, 'aws4_request']) key = hmac('sha256', key, part);
  const signature = hmac('sha256', key, stringToSign).toString('hex');
  return {
    headers: {
      ...added,
      Authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

// ─── Akamai EdgeGrid ──────────────────────────────────────────────────────────

export function akamaiEdgeGrid(params: AkamaiParams, request: SignedRequest, clock: Clock): { header: string } | { error: string } {
  const missing = (['clientToken', 'clientSecret', 'accessToken'] as const).filter((field) => !params[field]);
  if (missing.length) return { error: `Akamai EdgeGrid needs ${missing.join(', ')}.` };
  const timestamp = clock.now.toISOString().replace(/[-]|\.\d{3}Z$/g, '').replace(/^(\d{8})T/, '$1T') + '+0000';
  const authHeader = `EG1-HMAC-SHA256 client_token=${params.clientToken};access_token=${params.accessToken};timestamp=${timestamp};nonce=${clock.nonce()};`;
  const wanted = params.headersToSign.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const canonicalHeaders = wanted
    .filter((name) => header(request.headers, name) !== undefined)
    .map((name) => `${name}:${header(request.headers, name)!.trim().replace(/\s+/g, ' ')}`)
    .join('\t');
  const body = bodyBytes(request.body);
  const contentHash = request.method.toUpperCase() === 'POST' && body.length > 0 ? sha256(body.subarray(0, params.maxBody)).toString('base64') : '';
  const dataToSign = [
    request.method.toUpperCase(),
    request.url.protocol.replace(':', ''),
    request.url.host,
    `${request.url.pathname}${request.url.search}`,
    canonicalHeaders,
    contentHash,
    authHeader,
  ].join('\t');
  const signingKey = hmac('sha256', params.clientSecret, timestamp).toString('base64');
  const signature = hmac('sha256', signingKey, dataToSign).toString('base64');
  return { header: `${authHeader}signature=${signature}` };
}

// ─── NTLM (NTLMv2, MS-NLMP) ───────────────────────────────────────────────────

/** MD4, which NTLM is built on and OpenSSL 3 no longer offers by default. RFC 1320. */
export function md4(input: Buffer): Buffer {
  try {
    return crypto.createHash('md4').update(input).digest();
  } catch {
    // Computed here instead.
  }
  const bitLength = input.length * 8;
  const padded = Buffer.alloc((((input.length + 8) >> 6) + 1) * 64);
  input.copy(padded);
  padded[input.length] = 0x80;
  padded.writeUInt32LE(bitLength >>> 0, padded.length - 8);
  padded.writeUInt32LE(Math.floor(bitLength / 2 ** 32), padded.length - 4);
  let [a, b, c, d] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  const F = (x: number, y: number, z: number) => (x & y) | (~x & z);
  const G = (x: number, y: number, z: number) => (x & y) | (x & z) | (y & z);
  const H = (x: number, y: number, z: number) => x ^ y ^ z;
  for (let offset = 0; offset < padded.length; offset += 64) {
    const X = Array.from({ length: 16 }, (_, i) => padded.readUInt32LE(offset + i * 4));
    const [aa, bb, cc, dd] = [a, b, c, d];
    for (const i of [0, 4, 8, 12]) {
      a = rotl((a + F(b, c, d) + X[i]) | 0, 3);
      d = rotl((d + F(a, b, c) + X[i + 1]) | 0, 7);
      c = rotl((c + F(d, a, b) + X[i + 2]) | 0, 11);
      b = rotl((b + F(c, d, a) + X[i + 3]) | 0, 19);
    }
    for (const i of [0, 1, 2, 3]) {
      a = rotl((a + G(b, c, d) + X[i] + 0x5a827999) | 0, 3);
      d = rotl((d + G(a, b, c) + X[i + 4] + 0x5a827999) | 0, 5);
      c = rotl((c + G(d, a, b) + X[i + 8] + 0x5a827999) | 0, 9);
      b = rotl((b + G(c, d, a) + X[i + 12] + 0x5a827999) | 0, 13);
    }
    for (const i of [0, 2, 1, 3]) {
      a = rotl((a + H(b, c, d) + X[i] + 0x6ed9eba1) | 0, 3);
      d = rotl((d + H(a, b, c) + X[i + 8] + 0x6ed9eba1) | 0, 9);
      c = rotl((c + H(d, a, b) + X[i + 4] + 0x6ed9eba1) | 0, 11);
      b = rotl((b + H(c, d, a) + X[i + 12] + 0x6ed9eba1) | 0, 15);
    }
    a = (a + aa) | 0;
    b = (b + bb) | 0;
    c = (c + cc) | 0;
    d = (d + dd) | 0;
  }
  const out = Buffer.alloc(16);
  [a, b, c, d].forEach((word, i) => out.writeInt32LE(word, i * 4));
  return out;
}

const utf16 = (text: string) => Buffer.from(text, 'utf16le');
export const ntHash = (password: string) => md4(utf16(password));
/** NTOWFv2: the key every NTLMv2 response is made with. */
export const ntowfv2 = (password: string, user: string, domain: string) =>
  hmac('md5', ntHash(password), utf16(user.toUpperCase() + domain));

const NTLM_SIGNATURE = Buffer.from('NTLMSSP\0', 'latin1');
/** Unicode, request target, NTLM, always sign, extended session security, target info, 128, 56. */
const NTLM_FLAGS = 0xa0888205;

export function ntlmNegotiate(): string {
  const message = Buffer.alloc(32);
  NTLM_SIGNATURE.copy(message, 0);
  message.writeUInt32LE(1, 8);
  message.writeUInt32LE(NTLM_FLAGS, 12);
  return `NTLM ${message.toString('base64')}`;
}

export function parseNtlmChallenge(headerValue: string): { challenge: Buffer; targetInfo: Buffer; flags: number } | null {
  const match = headerValue.match(/NTLM\s+([A-Za-z0-9+/=]+)/i);
  if (!match) return null;
  const message = Buffer.from(match[1], 'base64');
  if (message.length < 32 || !message.subarray(0, 8).equals(NTLM_SIGNATURE) || message.readUInt32LE(8) !== 2) return null;
  const infoLength = message.length >= 48 ? message.readUInt16LE(40) : 0;
  const infoOffset = message.length >= 48 ? message.readUInt32LE(44) : 0;
  return {
    flags: message.readUInt32LE(20),
    challenge: message.subarray(24, 32),
    targetInfo: infoLength ? message.subarray(infoOffset, infoOffset + infoLength) : Buffer.alloc(0),
  };
}

/** The NTLMv2 response to a challenge: the proof, then the blob it was computed over. */
export function ntlmv2Response(key: Buffer, serverChallenge: Buffer, clientChallenge: Buffer, timestamp: Buffer, targetInfo: Buffer) {
  const blob = Buffer.concat([
    Buffer.from([1, 1, 0, 0, 0, 0, 0, 0]),
    timestamp,
    clientChallenge,
    Buffer.alloc(4),
    targetInfo,
    Buffer.alloc(4),
  ]);
  const proof = hmac('md5', key, Buffer.concat([serverChallenge, blob]));
  return {
    nt: Buffer.concat([proof, blob]),
    lm: Buffer.concat([hmac('md5', key, Buffer.concat([serverChallenge, clientChallenge])), clientChallenge]),
  };
}

export function ntlmAuthenticate(
  params: NtlmParams,
  challenge: { challenge: Buffer; targetInfo: Buffer },
  clock: Pick<Clock, 'now'>,
  clientChallenge: Buffer = crypto.randomBytes(8),
): string {
  // DOMAIN\user in the username field is how people type it; the domain field wins when set.
  let user = params.username;
  let domain = params.domain;
  const slash = user.indexOf('\\');
  if (slash > 0 && !domain) {
    domain = user.slice(0, slash);
    user = user.slice(slash + 1);
  }
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64LE((BigInt(clock.now.getTime()) + 11644473600000n) * 10000n);
  const { nt, lm } = ntlmv2Response(ntowfv2(params.password, user, domain), challenge.challenge, clientChallenge, timestamp, challenge.targetInfo);
  const fields = [lm, nt, utf16(domain), utf16(user), utf16(params.workstation), Buffer.alloc(0)];
  const headerLength = 64;
  const message = Buffer.alloc(headerLength + fields.reduce((sum, field) => sum + field.length, 0));
  NTLM_SIGNATURE.copy(message, 0);
  message.writeUInt32LE(3, 8);
  let offset = headerLength;
  fields.forEach((field, index) => {
    const at = 12 + index * 8;
    message.writeUInt16LE(field.length, at);
    message.writeUInt16LE(field.length, at + 2);
    message.writeUInt32LE(offset, at + 4);
    field.copy(message, offset);
    offset += field.length;
  });
  message.writeUInt32LE(NTLM_FLAGS, 60);
  return `NTLM ${message.toString('base64')}`;
}

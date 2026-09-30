import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import { chromium, type Browser } from 'playwright';
import {
  akamaiEdgeGrid,
  asapToken,
  awsSigV4,
  awsServiceOf,
  digestAuthorization,
  hawk,
  jwtBearer,
  md4,
  ntHash,
  ntlmv2Response,
  ntowfv2,
  oauth1,
  parseChallenge,
  parseNtlmChallenge,
  signJwt,
  type Clock,
} from './api-auth';
import { runApiRequest } from './api-test-runner';
import { fetchThroughBrowser } from './agents/agent-fetch';
import {
  AkamaiEdgeGridAuthParamsSchema,
  AsapAuthParamsSchema,
  AuthParamsSchema,
  AwsSigV4AuthParamsSchema,
  HawkAuthParamsSchema,
  IMPLEMENTED_AUTH_TYPES,
  AuthTypeSchema,
  JwtBearerAuthParamsSchema,
  OAuth1AuthParamsSchema,
} from '@shared/schema';

/**
 * The authentication schemes the API tester offered and never implemented, each checked against
 * its published test vectors, and the two challenge schemes against real servers.
 */

const clock = (iso: string, nonce = 'n0nce'): Clock => ({ now: new Date(iso), nonce: () => nonce });
const request = (method: string, url: string, headers: Record<string, string> = {}, body?: string) => ({ method, url: new URL(url), headers, body });

describe('every scheme the dropdown offers', () => {
  it('is implemented, and a test saved with only its name still loads', () => {
    expect([...IMPLEMENTED_AUTH_TYPES].sort()).toEqual([...AuthTypeSchema.options].sort());
    for (const type of ['jwtBearer', 'digest', 'oauth1', 'hawk', 'aws', 'ntlm', 'akamai', 'asap']) {
      expect(AuthParamsSchema.safeParse({ type }).success).toBe(true);
    }
  });
});

describe('JWT', () => {
  it('HS256 gives the token jwt.io gives', () => {
    const result = signJwt('HS256', 'your-256-bit-secret', {}, { sub: '1234567890', name: 'John Doe', iat: 1516239022 });
    expect(result).toEqual({
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    });
  });

  it('RS256 and ES256 sign so the public key verifies, ES256 as r||s', () => {
    for (const [algorithm, type, options] of [
      ['RS256', 'rsa', { modulusLength: 2048 }],
      ['ES256', 'ec', { namedCurve: 'P-256' }],
    ] as const) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync(type as any, { ...options, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } } as any);
      const params = JwtBearerAuthParamsSchema.parse({ algorithm, secret: privateKey, payload: '{"sub":"svc"}', headers: '{"kid":"k1"}' });
      const result = jwtBearer(params, clock('2026-09-30T10:00:00Z'));
      if ('error' in result) throw new Error(result.error);
      const [head, body, signature] = result.token.split('.');
      expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ kid: 'k1', alg: algorithm, typ: 'JWT' });
      expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toEqual({ iat: 1790762400, sub: 'svc' });
      const valid = crypto.verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey as string, ...(algorithm === 'ES256' ? { dsaEncoding: 'ieee-p1363' as const } : {}) }, Buffer.from(signature, 'base64url'));
      expect(valid).toBe(true);
      if (algorithm === 'ES256') expect(Buffer.from(signature, 'base64url')).toHaveLength(64);
    }
  });

  it('says what is wrong with a key or a payload', () => {
    expect(jwtBearer(JwtBearerAuthParamsSchema.parse({ secret: '' }), clock('2026-01-01T00:00:00Z'))).toMatchObject({ error: /secret/ });
    expect(jwtBearer(JwtBearerAuthParamsSchema.parse({ secret: 's', payload: '{nope' }), clock('2026-01-01T00:00:00Z'))).toMatchObject({ error: /not valid JSON/ });
    expect(jwtBearer(JwtBearerAuthParamsSchema.parse({ algorithm: 'RS256', secret: 'not a key' }), clock('2026-01-01T00:00:00Z'))).toMatchObject({ error: /PEM private key/ });
  });

  it('Atlassian ASAP carries its required claims and key id', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const params = AsapAuthParamsSchema.parse({ issuer: 'svc-a', audience: 'svc-b', keyId: 'svc-a/key1', privateKey, expirySeconds: 60 });
    const result = asapToken(params, clock('2026-09-30T10:00:00Z'));
    if ('error' in result) throw new Error(result.error);
    const [head, body, signature] = result.token.split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toMatchObject({ alg: 'RS256', kid: 'svc-a/key1' });
    expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toMatchObject({ iss: 'svc-a', sub: 'svc-a', aud: 'svc-b', iat: 1790762400, exp: 1790762460, jti: expect.any(String) });
    expect(crypto.verify('sha256', Buffer.from(`${head}.${body}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(asapToken(AsapAuthParamsSchema.parse({}), clock('2026-01-01T00:00:00Z'))).toMatchObject({ error: /issuer, audience, keyId, privateKey/ });
  });
});

describe('Digest', () => {
  it('answers the RFC 2617 example as the RFC does', () => {
    const challenge = parseChallenge('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"', 'Digest')!;
    const answer = digestAuthorization(challenge, { username: 'Mufasa', password: 'Circle Of Life' }, { method: 'GET', uri: '/dir/index.html' }, '0a4f113b');
    expect(answer).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(answer).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
    expect(answer).toContain('nc=00000001');
  });
});

describe('OAuth 1.0', () => {
  it('signs the OAuth Core 1.0 example as the specification does', () => {
    const params = OAuth1AuthParamsSchema.parse({ consumerKey: 'dpf43f3p2l4k3l03', consumerSecret: 'kd94hf93k423kf44', token: 'nnch734d00sl2jdk', tokenSecret: 'pfkkdhi9sl3r4s00' });
    const result = oauth1(params, request('GET', 'http://photos.example.net/photos?file=vacation.jpg&size=original'), clock('2007-10-01T12:34:56Z', 'kllo9940pd9333jh'));
    expect(result).toMatchObject({ header: expect.stringContaining('oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"') });
  });

  it('signs a form body, and can go in the query instead', () => {
    const params = OAuth1AuthParamsSchema.parse({ consumerKey: 'k', consumerSecret: 's', addTo: 'query' });
    const withForm = oauth1(params, request('POST', 'https://api.test/x', { 'Content-Type': 'application/x-www-form-urlencoded' }, 'a=1'), clock('2026-01-01T00:00:00Z'));
    const withoutForm = oauth1(params, request('POST', 'https://api.test/x', { 'Content-Type': 'application/json' }, 'a=1'), clock('2026-01-01T00:00:00Z'));
    const signature = (r: any) => r.query.find(([k]: [string]) => k === 'oauth_signature')[1];
    expect(signature(withForm)).not.toBe(signature(withoutForm));
    expect(OAuth1AuthParamsSchema.parse({}).signatureMethod).toBe('HMAC-SHA1');
  });
});

describe('Hawk', () => {
  it("gives the MAC of the Hawk README's example", () => {
    const params = HawkAuthParamsSchema.parse({ authId: 'dh37fgj492je', authKey: 'werxhqb98rpaxn39848xrunpaw3489ruxnpa98w4rxn', ext: 'some-app-ext-data' });
    const result = hawk(params, request('GET', 'http://example.com:8000/resource/1?b=1&a=2'), clock('2012-11-25T08:30:34Z', 'j4h3g2'));
    expect(result).toEqual({
      header: 'Hawk id="dh37fgj492je", ts="1353832234", nonce="j4h3g2", ext="some-app-ext-data", mac="6R4rV5iE+NPoym+WwjeHzjAGXUtLNIxmo1vpMofpLAE="',
    });
  });
});

describe('AWS Signature Version 4', () => {
  const aws = AwsSigV4AuthParamsSchema.parse({ accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service' });
  const at = clock('2015-08-30T12:36:00Z');

  it('signs the "get-vanilla" case of the AWS test suite', () => {
    const result = awsSigV4(aws, request('GET', 'https://example.amazonaws.com/'), at);
    expect(result).toEqual({
      headers: {
        'x-amz-date': '20150830T123600Z',
        Authorization: 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
      },
    });
  });

  it('signs "get-vanilla-query-order-key-case" with the query sorted', () => {
    const result = awsSigV4(aws, request('GET', 'https://example.amazonaws.com/?Param2=value2&Param1=value1'), at);
    expect('headers' in result && result.headers.Authorization).toContain('Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500');
  });

  it('adds the payload hash S3 wants, and the session token, and reads the service off the host', () => {
    const result = awsSigV4({ ...aws, service: '', sessionToken: 'tok' }, request('PUT', 'https://bucket.s3.eu-west-1.amazonaws.com/key', {}, 'hello'), at);
    if ('error' in result) throw new Error(result.error);
    expect(result.headers['x-amz-content-sha256']).toBe(crypto.createHash('sha256').update('hello').digest('hex'));
    expect(result.headers['x-amz-security-token']).toBe('tok');
    expect(result.headers.Authorization).toContain('/us-east-1/s3/aws4_request');
    expect(awsServiceOf('abc123.execute-api.eu-west-1.amazonaws.com')).toBe('execute-api');
    expect(awsServiceOf('sts.amazonaws.com')).toBe('sts');
    expect(awsSigV4({ ...aws, service: '' }, request('GET', 'https://api.example.com/'), at)).toMatchObject({ error: /service name/ });
  });
});

describe('Akamai EdgeGrid', () => {
  it('signs method, URL, headers to sign and the body hash, with the timestamp as its key', () => {
    const params = AkamaiEdgeGridAuthParamsSchema.parse({ clientToken: 'akab-c', clientSecret: 'secret', accessToken: 'akab-a', headersToSign: 'X-Test1' });
    const result = akamaiEdgeGrid(params, request('POST', 'https://akab-host.luna.akamaiapis.net/papi/v1/cpcodes?x=1', { 'X-Test1': '  a   b ' }, '{"a":1}'), clock('2026-09-30T10:00:00Z', 'nonce-1'));
    if ('error' in result) throw new Error(result.error);
    const timestamp = '20260930T10:00:00+0000';
    const auth = `EG1-HMAC-SHA256 client_token=akab-c;access_token=akab-a;timestamp=${timestamp};nonce=nonce-1;`;
    const data = ['POST', 'https', 'akab-host.luna.akamaiapis.net', '/papi/v1/cpcodes?x=1', 'x-test1:a b', crypto.createHash('sha256').update('{"a":1}').digest('base64'), auth].join('\t');
    const key = crypto.createHmac('sha256', 'secret').update(timestamp).digest('base64');
    expect(result.header).toBe(`${auth}signature=${crypto.createHmac('sha256', key).update(data).digest('base64')}`);
  });
});

describe('NTLM', () => {
  it('has MD4 and the MS-NLMP keys right', () => {
    expect(md4(Buffer.alloc(0)).toString('hex')).toBe('31d6cfe0d16ae931b73c59d7e0c089c0');
    expect(md4(Buffer.from('abc')).toString('hex')).toBe('a448017aaf21d8525fc10ae87aa6729d');
    expect(ntHash('Password').toString('hex')).toBe('a4f49c406510bdcab6824ee7c30fd852');
    expect(ntowfv2('Password', 'User', 'Domain').toString('hex')).toBe('0c868a403bfd7a93a3001ef22ef02e3f');
  });
});

// ─── Against servers ─────────────────────────────────────────────────────────

const USER = { username: 'alice', password: 's3cret', domain: 'CORP' };

/** A server that does Digest and NTLM the way IIS and Apache do, and says 200 only when satisfied. */
function challengeServer() {
  const ntlmSockets = new WeakMap<object, { challenge: Buffer }>();
  const nonce = crypto.randomBytes(8).toString('hex');
  return http.createServer((req, res) => {
    const auth = req.headers.authorization ?? '';
    if (req.url?.startsWith('/digest')) {
      const fields = parseChallenge(auth, 'Digest');
      if (fields) {
        const ha1 = crypto.createHash('md5').update(`${USER.username}:realm:${USER.password}`).digest('hex');
        const ha2 = crypto.createHash('md5').update(`${req.method}:${fields.uri}`).digest('hex');
        const expected = crypto.createHash('md5').update(`${ha1}:${nonce}:${fields.nc}:${fields.cnonce}:auth:${ha2}`).digest('hex');
        if (fields.response === expected) return res.writeHead(200).end('digest ok');
      }
      return res.writeHead(401, { 'WWW-Authenticate': `Digest realm="realm", qop="auth", nonce="${nonce}"` }).end();
    }
    // NTLM: the answer counts only on the connection that got the challenge.
    const message = auth.startsWith('NTLM ') ? Buffer.from(auth.slice(5), 'base64') : null;
    if (message && message.readUInt32LE(8) === 1) {
      const challenge = crypto.randomBytes(8);
      ntlmSockets.set(req.socket, { challenge });
      const targetInfo = Buffer.from([2, 0, 8, 0, ...Buffer.from('CORP', 'utf16le'), 0, 0, 0, 0]);
      const type2 = Buffer.alloc(48 + targetInfo.length);
      Buffer.from('NTLMSSP\0', 'latin1').copy(type2, 0);
      type2.writeUInt32LE(2, 8);
      type2.writeUInt32LE(0xa0888205, 20);
      challenge.copy(type2, 24);
      type2.writeUInt16LE(targetInfo.length, 40);
      type2.writeUInt16LE(targetInfo.length, 42);
      type2.writeUInt32LE(48, 44);
      targetInfo.copy(type2, 48);
      return res.writeHead(401, { 'WWW-Authenticate': `NTLM ${type2.toString('base64')}` }).end();
    }
    if (message && message.readUInt32LE(8) === 3) {
      const pending = ntlmSockets.get(req.socket);
      if (!pending) return res.writeHead(401, { 'WWW-Authenticate': 'NTLM' }).end('answer on another connection');
      const field = (index: number) => message.subarray(message.readUInt32LE(12 + index * 8 + 4), message.readUInt32LE(12 + index * 8 + 4) + message.readUInt16LE(12 + index * 8));
      const nt = field(1);
      const user = field(3).toString('utf16le');
      const domain = field(2).toString('utf16le');
      const blob = nt.subarray(16);
      const proof = crypto.createHmac('md5', ntowfv2(USER.password, user, domain)).update(Buffer.concat([pending.challenge, blob])).digest();
      if (user === USER.username && domain === USER.domain && proof.equals(nt.subarray(0, 16))) return res.writeHead(200).end(`ntlm ok ${domain}\\${user}`);
      return res.writeHead(401).end('wrong answer');
    }
    res.writeHead(401, { 'WWW-Authenticate': 'NTLM' }).end();
  });
}

describe('the challenge schemes against a server', () => {
  let server: http.Server;
  let base: string;
  let browser: Browser;

  beforeAll(async () => {
    server = challengeServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const assertOk = [{ id: 'a', source: 'status_code', comparison: 'equals', targetValue: '200', enabled: true }] as any;

  it('Digest: answers the challenge and gets in; the wrong password does not', async () => {
    const ok = await runApiRequest({ method: 'GET', url: `${base}/digest/data?x=1`, assertions: assertOk, auth: { type: 'digest', params: { username: 'alice', password: '{{pw}}' } } }, { pw: 's3cret' });
    expect(ok).toMatchObject({ status: 200, passed: true, body: 'digest ok' });
    const wrong = await runApiRequest({ method: 'GET', url: `${base}/digest/data`, auth: { type: 'digest', params: { username: 'alice', password: 'nope' } } }, {});
    expect(wrong.status).toBe(401);
  });

  it('NTLM: the whole handshake on one connection, from this server', async () => {
    const ok = await runApiRequest({ method: 'POST', url: `${base}/ntlm`, body: { a: 1 }, assertions: assertOk, auth: { type: 'ntlm', params: { ...USER, workstation: 'WS' } } }, {});
    expect(ok).toMatchObject({ status: 200, passed: true, body: 'ntlm ok CORP\\alice' });
    // DOMAIN\user typed in the username field.
    const typed = await runApiRequest({ method: 'GET', url: `${base}/ntlm`, auth: { type: 'ntlm', params: { username: 'CORP\\alice', password: 's3cret', domain: '', workstation: '' } } }, {});
    expect(typed.body).toBe('ntlm ok CORP\\alice');
    const wrong = await runApiRequest({ method: 'GET', url: `${base}/ntlm`, auth: { type: 'ntlm', params: { ...USER, password: 'nope', workstation: '' } } }, {});
    expect(wrong.status).toBe(401);
  });

  it('NTLM: and from a browser, as a local agent sends it', async () => {
    const fromAgent = fetchThroughBrowser(async () => browser);
    const ok = await runApiRequest({ method: 'GET', url: `${base}/ntlm`, auth: { type: 'ntlm', params: { ...USER, workstation: '' } } }, {}, fromAgent);
    expect(ok).toMatchObject({ status: 200, body: 'ntlm ok CORP\\alice' });
  }, 60_000);

  it('refuses to send without the fields a scheme needs, and says which', async () => {
    const missing = await runApiRequest({ method: 'GET', url: `${base}/x`, auth: { type: 'digest', params: { username: '', password: '' } } }, {});
    expect(missing.error).toMatch(/needs a username/);
    const aws = await runApiRequest({ method: 'GET', url: `${base}/x`, auth: { type: 'aws', params: AwsSigV4AuthParamsSchema.parse({}) } }, {});
    expect(aws.error).toMatch(/access key/);
  });

  it('parses a challenge that is not NTLM as no challenge', () => {
    expect(parseNtlmChallenge('Negotiate abc')).toBeNull();
    expect(ntlmv2Response(Buffer.alloc(16), Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(0)).nt).toHaveLength(16 + 28 + 4);
  });
});

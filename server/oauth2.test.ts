import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { runApiRequest } from './api-test-runner';
import { clearTokenCache } from './oauth2';
import { IMPLEMENTED_AUTH_TYPES, AuthTypeSchema, AuthParamsSchema, type AuthType } from '@shared/schema';

/**
 * Authentication, as the runner performs it.
 *
 * Two things were wrong here and they compounded. The dropdown offered fourteen schemes and
 * the runner implemented three, with the rest falling through to "send the request as
 * written" — so a test that said OAuth 2.0 went out with no credentials, the target answered
 * 401, and the report blamed the endpoint. And the API Tester page built the Authorization
 * header in the browser instead of sending its settings to the server, so `{{name}}` in a
 * token was sent to the target literally (the environment's values are on the server) and
 * the same test authenticated differently from the page than from a schedule.
 */

/** The API under test. Records what reached it, and guards /private with a bearer token. */
let target: http.Server;
let targetUrl: string;
let reachedTarget: Array<{ url: string; headers: http.IncomingHttpHeaders }>;

/** The identity provider. */
let idp: http.Server;
let idpUrl: string;
let tokenRequests: Array<{ headers: http.IncomingHttpHeaders; body: string }>;
/** What the next token request gets, so one test can make the endpoint misbehave. */
let tokenReply: { status: number; body: string };

beforeAll(async () => {
  target = http.createServer((req, res) => {
    reachedTarget.push({ url: req.url ?? '', headers: req.headers });
    const auth = req.headers.authorization;
    if ((req.url ?? '').startsWith('/private') && auth !== 'Bearer issued-token-1') {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"unauthorized"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;

  idp = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      tokenRequests.push({ headers: req.headers, body });
      res.writeHead(tokenReply.status, { 'Content-Type': 'application/json' }).end(tokenReply.body);
    });
  });
  await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve));
  idpUrl = `http://127.0.0.1:${(idp.address() as AddressInfo).port}/token`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => target.close(() => resolve()));
  await new Promise<void>((resolve) => idp.close(() => resolve()));
});

beforeEach(() => {
  reachedTarget = [];
  tokenRequests = [];
  tokenReply = { status: 200, body: JSON.stringify({ access_token: 'issued-token-1', token_type: 'Bearer', expires_in: 3600 }) };
  // The cache is module state shared by every test in this file.
  clearTokenCache();
});

const oauth2 = (over: Record<string, unknown> = {}) =>
  ({
    type: 'oauth2',
    params: {
      grantType: 'client_credentials',
      tokenUrl: idpUrl,
      clientId: 'svc-account',
      clientSecret: 's3cret',
      scope: '',
      username: '',
      password: '',
      clientAuth: 'header',
      ...over,
    },
  }) as never;

describe('OAuth 2.0, client credentials', () => {
  it('obtains a token and sends it to the target', async () => {
    const result = await runApiRequest({ method: 'GET', url: `${targetUrl}/private`, auth: oauth2() }, {});

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
    // The target's own 401 rule is the assertion: a request that reached it without the
    // token would have come back 401, whatever this runner reported about itself.
    expect(reachedTarget[0].headers.authorization).toBe('Bearer issued-token-1');
  });

  it('asks for the grant the way the spec describes it', async () => {
    await runApiRequest({ method: 'GET', url: `${targetUrl}/private`, auth: oauth2({ scope: 'orders.read' }) }, {});

    const asked = new URLSearchParams(tokenRequests[0].body);
    expect(asked.get('grant_type')).toBe('client_credentials');
    expect(asked.get('scope')).toBe('orders.read');
    expect(tokenRequests[0].headers['content-type']).toContain('application/x-www-form-urlencoded');
    // RFC 6749 §2.3.1: the client credentials belong in a Basic header by default.
    const expected = Buffer.from('svc-account:s3cret').toString('base64');
    expect(tokenRequests[0].headers.authorization).toBe(`Basic ${expected}`);
  });

  it('puts the client credentials in the body when told to', async () => {
    await runApiRequest(
      { method: 'GET', url: `${targetUrl}/private`, auth: oauth2({ clientAuth: 'body' }) },
      {},
    );

    const asked = new URLSearchParams(tokenRequests[0].body);
    expect(asked.get('client_id')).toBe('svc-account');
    expect(asked.get('client_secret')).toBe('s3cret');
    // Some providers accept them only one way, so sending both would authenticate against
    // a server that rejects the combination.
    expect(tokenRequests[0].headers.authorization).toBeUndefined();
  });

  it('reuses the token instead of authenticating once per request', async () => {
    await runApiRequest({ method: 'GET', url: `${targetUrl}/private`, auth: oauth2() }, {});
    await runApiRequest({ method: 'GET', url: `${targetUrl}/private`, auth: oauth2() }, {});
    await runApiRequest({ method: 'GET', url: `${targetUrl}/private`, auth: oauth2() }, {});

    // A plan of thirty requests hitting the token endpoint thirty times is slow, and against
    // a provider that rate-limits it is a run that fails for reasons of its own making.
    expect(tokenRequests).toHaveLength(1);
    expect(reachedTarget).toHaveLength(3);
  });

  it('does not reuse it for different credentials', async () => {
    await runApiRequest({ method: 'GET', url: `${targetUrl}/private`, auth: oauth2() }, {});
    await runApiRequest(
      { method: 'GET', url: `${targetUrl}/private`, auth: oauth2({ clientId: 'other-account' }) },
      {},
    );

    expect(tokenRequests).toHaveLength(2);
  });

  it('gets a new token once the old one has expired', async () => {
    tokenReply = {
      status: 200,
      // Shorter than the safety margin, so it is already treated as expired.
      body: JSON.stringify({ access_token: 'issued-token-1', token_type: 'Bearer', expires_in: 1 }),
    };

    await runApiRequest({ method: 'GET', url: `${targetUrl}/private`, auth: oauth2() }, {});
    await runApiRequest({ method: 'GET', url: `${targetUrl}/private`, auth: oauth2() }, {});

    expect(tokenRequests).toHaveLength(2);
  });

  it('sends the token type the server chose', async () => {
    tokenReply = { status: 200, body: JSON.stringify({ access_token: 'abc', token_type: 'DPoP', expires_in: 60 }) };

    await runApiRequest({ method: 'GET', url: `${targetUrl}/public`, auth: oauth2() }, {});

    expect(reachedTarget[0].headers.authorization).toBe('DPoP abc');
  });

  it('normalises the casing of bearer, which providers spell either way', async () => {
    tokenReply = { status: 200, body: JSON.stringify({ access_token: 'abc', token_type: 'bearer', expires_in: 60 }) };

    await runApiRequest({ method: 'GET', url: `${targetUrl}/public`, auth: oauth2() }, {});

    expect(reachedTarget[0].headers.authorization).toBe('Bearer abc');
  });
});

describe('OAuth 2.0, password grant', () => {
  it('sends the resource owner credentials', async () => {
    await runApiRequest(
      {
        method: 'GET',
        url: `${targetUrl}/private`,
        auth: oauth2({ grantType: 'password', username: 'operator', password: 'pw' }),
      },
      {},
    );

    const asked = new URLSearchParams(tokenRequests[0].body);
    expect(asked.get('grant_type')).toBe('password');
    expect(asked.get('username')).toBe('operator');
    expect(asked.get('password')).toBe('pw');
  });

  it('refuses before sending when it has no username', async () => {
    const result = await runApiRequest(
      { method: 'GET', url: `${targetUrl}/private`, auth: oauth2({ grantType: 'password' }) },
      {},
    );

    expect(result.error).toContain('username');
    expect(tokenRequests).toHaveLength(0);
  });
});

describe('when the token cannot be obtained', () => {
  it('reports what the token endpoint said, not the target’s 401', async () => {
    tokenReply = {
      status: 400,
      body: JSON.stringify({ error: 'invalid_client', error_description: 'client secret expired' }),
    };

    const result = await runApiRequest({ method: 'GET', url: `${targetUrl}/private`, auth: oauth2() }, {});

    expect(result.passed).toBe(false);
    expect(result.error).toContain('invalid_client');
    expect(result.error).toContain('client secret expired');
    // Sending it anyway would produce a 401 from the target and a report blaming an
    // endpoint that is working exactly as intended.
    expect(reachedTarget).toHaveLength(0);
  });

  it('says so when a 200 carries no access_token', async () => {
    tokenReply = { status: 200, body: JSON.stringify({ token_type: 'Bearer', expires_in: 60 }) };

    const result = await runApiRequest({ method: 'GET', url: `${targetUrl}/private`, auth: oauth2() }, {});

    // The failure that looks most like success: an empty Authorization header would be sent
    // and the whole thing would read as a target problem.
    expect(result.error).toContain('no access_token');
    expect(reachedTarget).toHaveLength(0);
  });

  it('names the missing field rather than saying it is not configured', async () => {
    const result = await runApiRequest(
      { method: 'GET', url: `${targetUrl}/private`, auth: oauth2({ tokenUrl: '' }) },
      {},
    );

    expect(result.error).toContain('token URL');
  });
});

describe('credentials come from the environment', () => {
  it('resolves placeholders in the OAuth 2.0 settings', async () => {
    await runApiRequest(
      {
        method: 'GET',
        url: `${targetUrl}/private`,
        auth: oauth2({ clientId: '{{dmoClientId}}', clientSecret: '{{dmoSecret}}' }),
      },
      { dmoClientId: 'from-environment', dmoSecret: 'also-from-environment' },
    );

    const expected = Buffer.from('from-environment:also-from-environment').toString('base64');
    expect(tokenRequests[0].headers.authorization).toBe(`Basic ${expected}`);
  });

  it('resolves them in a bearer token too', async () => {
    // The API Tester page built this header in the browser, which has no environment: the
    // literal string `{{dmoToken}}` was sent as the token and the target answered 401.
    await runApiRequest(
      {
        method: 'GET',
        url: `${targetUrl}/public`,
        auth: { type: 'bearer', params: { token: '{{dmoToken}}' } } as never,
      },
      { dmoToken: 'issued-token-1' },
    );

    expect(reachedTarget[0].headers.authorization).toBe('Bearer issued-token-1');
  });
});

describe('a scheme nothing implements', () => {
  it('refuses the request instead of sending it anonymous', async () => {
    const result = await runApiRequest(
      { method: 'GET', url: `${targetUrl}/private`, auth: { type: 'ntlm' } as never },
      {},
    );

    expect(result.passed).toBe(false);
    expect(result.error).toContain('NTLM');
    expect(reachedTarget).toHaveLength(0);
  });

  it('still sends the request when the tester wrote the header themselves', async () => {
    // The escape hatch the refusal points at, so an unimplemented scheme is an obstacle and
    // not a wall.
    const result = await runApiRequest(
      {
        method: 'GET',
        url: `${targetUrl}/private`,
        headers: { Authorization: 'Bearer issued-token-1' },
        auth: { type: 'none' } as never,
      },
      {},
    );

    expect(result.status).toBe(200);
  });

  it('handles exactly the schemes the product claims to implement', async () => {
    // The list the dropdown greys out and the list the runner accepts are the same list, so
    // neither can promise something the other refuses.
    const accepted: AuthType[] = [];
    for (const type of AuthTypeSchema.options) {
      const auth =
        type === 'oauth2'
          ? oauth2()
          : type === 'basic'
            ? ({ type, params: { username: 'u', password: 'p' } } as never)
            : type === 'bearer'
              ? ({ type, params: { token: 'issued-token-1' } } as never)
              : type === 'apiKey'
                ? ({ type, params: { key: 'k', value: 'v', addTo: 'header' } } as never)
                : ({ type } as never);

      const result = await runApiRequest({ method: 'GET', url: `${targetUrl}/public`, auth }, {});
      if (!result.error) accepted.push(type);
    }

    expect(accepted.sort()).toEqual([...IMPLEMENTED_AUTH_TYPES].sort());
  });
});

describe('what the wire accepts', () => {
  // /api/proxy-api-request and the saved-test row both validate through AuthParamsSchema,
  // so this is the gate every path goes through.

  it('takes the settings the form produces', () => {
    const parsed = AuthParamsSchema.safeParse({
      type: 'oauth2',
      params: {
        grantType: 'client_credentials',
        tokenUrl: 'https://login.example.com/token',
        clientId: 'svc',
        clientSecret: 's3cret',
        scope: 'orders.read',
        username: '',
        password: '',
        clientAuth: 'header',
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('still loads a test saved before OAuth 2.0 carried any settings', () => {
    // Those rows hold `{ type: 'oauth2' }` and nothing else, because the union entry had no
    // params at all. Requiring them now would make such a test unopenable — it would fail
    // validation on load, and the tester could not even see what it had been set to.
    const parsed = AuthParamsSchema.safeParse({ type: 'oauth2' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.type === 'oauth2' && parsed.data.params.grantType).toBe(
      'client_credentials',
    );
  });

  it('rejects a grant the runner cannot complete', () => {
    // authorization_code needs a person at a browser. Accepting it here would mean a test
    // that validates, saves, schedules, and then fails every night at 3am.
    const parsed = AuthParamsSchema.safeParse({
      type: 'oauth2',
      params: { grantType: 'authorization_code', tokenUrl: 'https://x/token', clientId: 'a' },
    });

    expect(parsed.success).toBe(false);
  });
});

// Disposable external identity provider. Product routes, session and OIDC validation stay real.
// The checked-in TLS key is public test material, usable only on this loopback fixture.
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

const issuer = 'https://localhost:5083';
const clientId = 'installation-e2e';
const clientSecret = 'installation-e2e-secret';
const redirectUri = 'http://127.0.0.1:5080/api/sso/callback';

export async function startOidcProvider() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'installation',
    use: 'sig',
    alg: 'RS256',
  };
  const codes = new Map();
  const server = createServer(
    {
      key: readFileSync(new URL('./fixtures/oidc-test.key', import.meta.url)),
      cert: readFileSync(new URL('./fixtures/oidc-test.crt', import.meta.url)),
    },
    async (req, res) => {
      const url = new URL(req.url, issuer);
      const json = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
        return json(200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (req.method === 'GET' && url.pathname === '/jwks') return json(200, { keys: [jwk] });
      if (url.pathname === '/authorize') {
        const parameters = url.searchParams;
        if (
          parameters.get('client_id') !== clientId ||
          parameters.get('redirect_uri') !== redirectUri ||
          parameters.get('response_type') !== 'code' ||
          parameters.get('code_challenge_method') !== 'S256' ||
          !parameters.get('state') ||
          !parameters.get('nonce') ||
          !parameters.get('code_challenge')
        )
          return json(400, { error: 'invalid_request' });
        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          return res.end(
            '<!doctype html><title>E2E identity provider</title><h1>Installation identity provider</h1><form method="post"><label>Provider email<input name="email" type="email" required></label><label>Provider password<input name="password" type="password" required></label><button type="submit">Sign in</button></form>',
          );
        }
        if (req.method === 'POST') {
          let body = '';
          for await (const chunk of req) body += chunk;
          const form = new URLSearchParams(body);
          if (
            !/^[^@]+@[^@]+\.example\.test$/.test(form.get('email') ?? '') ||
            form.get('password') !== 'provider-e2e-password'
          )
            return json(401, { error: 'invalid_credentials' });
          const code = randomUUID();
          codes.set(code, {
            email: form.get('email'),
            nonce: parameters.get('nonce'),
            challenge: parameters.get('code_challenge'),
            expires: Date.now() + 60_000,
          });
          const callback = new URL(redirectUri);
          callback.searchParams.set('code', code);
          callback.searchParams.set('state', parameters.get('state'));
          res.writeHead(302, { Location: callback.href });
          return res.end();
        }
      }
      if (req.method === 'POST' && url.pathname === '/token') {
        // OAuth Basic credentials are form-encoded before Base64 (including hyphens).
        const authorization = req.headers.authorization ?? '';
        if (!/^Basic /i.test(authorization)) return json(401, { error: 'invalid_client' });
        const supplied = Buffer.from(authorization.slice(6), 'base64').toString().split(':');
        const decode = (value) => new URLSearchParams(`value=${value ?? ''}`).get('value');
        if (decode(supplied[0]) !== clientId || decode(supplied[1]) !== clientSecret)
          return json(401, { error: 'invalid_client' });
        let body = '';
        for await (const chunk of req) body += chunk;
        const parameters = new URLSearchParams(body);
        const pending = codes.get(parameters.get('code'));
        codes.delete(parameters.get('code'));
        const challenge = createHash('sha256')
          .update(parameters.get('code_verifier') ?? '')
          .digest('base64url');
        if (
          !pending ||
          pending.expires < Date.now() ||
          pending.challenge !== challenge ||
          parameters.get('redirect_uri') !== redirectUri ||
          parameters.get('grant_type') !== 'authorization_code'
        ) {
          return json(400, { error: 'invalid_grant' });
        }
        const now = Math.floor(Date.now() / 1000);
        const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const payload = `${encode({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })}.${encode({ iss: issuer, aud: clientId, sub: pending.email, email: pending.email, email_verified: true, nonce: pending.nonce, iat: now, exp: now + 300 })}`;
        return json(200, {
          token_type: 'Bearer',
          access_token: randomUUID(),
          expires_in: 300,
          id_token: `${payload}.${sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64url')}`,
        });
      }
      return json(404, { error: 'not_found' });
    },
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(5083, 'localhost', resolve);
  });
  return server;
}

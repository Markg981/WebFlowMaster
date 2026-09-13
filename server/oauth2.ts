import crypto from 'node:crypto';
import type { OAuth2AuthParams } from '@shared/schema';
import { fetchTarget, substituteVariables } from './outbound-http';

/**
 * Getting an OAuth 2.0 access token, so a test can authenticate the way the service it
 * tests does.
 *
 * The enum has offered "OAuth 2.0" since the beginning and nothing was ever behind it: the
 * request went out with no Authorization header at all, the target answered 401, and the
 * report said the endpoint was broken. For an enterprise API — which is most of what this
 * product is pointed at — that made the whole API side unusable, because client credentials
 * are how those APIs are reached.
 *
 * This cannot live in the browser, which is why the API Tester page could never have grown
 * it: the token endpoint is a different origin than the app, and the client secret would be
 * handed to anyone with the developer tools open.
 */

const TOKEN_REQUEST_TIMEOUT_MS = 15_000;

/**
 * How early to treat a token as expired.
 *
 * A plan can spend a while between obtaining a token and using it on its last request, and
 * a token that expires in flight fails a test for a reason that has nothing to do with what
 * it checks.
 */
const EXPIRY_MARGIN_MS = 30_000;

/** What to assume when the server does not say. Short, but not per-request. */
const DEFAULT_LIFETIME_MS = 60_000;

interface CachedToken {
  /** The finished header value, not the bare token: the scheme comes from the same reply. */
  authorization: string;
  expiresAt: number;
}

/**
 * Tokens already obtained, keyed by everything that identifies one.
 *
 * A plan authenticating once per request would be both slow and, against an identity
 * provider that rate-limits the token endpoint, a way to fail a run for reasons of its own
 * making.
 */
const cache = new Map<string, CachedToken>();

/** Exported for tests, which need a cold cache per case. */
export function clearTokenCache(): void {
  cache.clear();
}

type Resolved = { [K in keyof OAuth2AuthParams]: OAuth2AuthParams[K] };

function resolve(params: OAuth2AuthParams, vars: Record<string, string>): Resolved {
  const text = (value: string) => substituteVariables(value ?? '', vars);
  return {
    grantType: params.grantType,
    clientAuth: params.clientAuth,
    tokenUrl: text(params.tokenUrl),
    clientId: text(params.clientId),
    clientSecret: text(params.clientSecret),
    scope: text(params.scope),
    username: text(params.username),
    password: text(params.password),
  };
}

/**
 * The cache key.
 *
 * Hashed rather than assembled in the clear because the secret has to be part of it —
 * rotating a secret must invalidate the token obtained with the old one — and a Map key
 * holding a credential is a credential one stray log line away from being written down.
 */
function cacheKey(r: Resolved): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([r.grantType, r.tokenUrl, r.clientId, r.clientSecret, r.scope, r.username, r.password]))
    .digest('hex');
}

/** What the token endpoint said went wrong, in the shape RFC 6749 §5.2 defines. */
function describeFailure(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const code = parsed?.error;
    const detail = parsed?.error_description;
    if (code) return `token endpoint returned ${status}: ${code}${detail ? ` — ${detail}` : ''}`;
  } catch {
    // Not JSON; fall through to the raw body.
  }
  const trimmed = body.trim().replace(/\s+/g, ' ').slice(0, 200);
  return `token endpoint returned ${status}${trimmed ? `: ${trimmed}` : ''}`;
}

export type TokenResult = { authorization: string } | { error: string };

/**
 * The Authorization header value for these settings, from the cache or from the token
 * endpoint.
 *
 * Returns the failure rather than throwing it: a target that will not issue a token is a
 * failed test, like a target that is down, and the plan has other tests to run.
 */
export async function accessTokenFor(
  params: OAuth2AuthParams,
  vars: Record<string, string>,
): Promise<TokenResult> {
  const r = resolve(params, vars);

  // Named individually, because "OAuth 2.0 is not configured" leaves the tester to guess
  // which of seven fields is the empty one.
  if (!r.tokenUrl) return { error: 'OAuth 2.0: no token URL configured.' };
  if (!r.clientId) return { error: 'OAuth 2.0: no client ID configured.' };
  if (r.grantType === 'password' && !r.username) {
    return { error: 'OAuth 2.0: the password grant needs a username.' };
  }

  let tokenEndpoint: URL;
  try {
    tokenEndpoint = new URL(r.tokenUrl);
  } catch {
    return { error: `OAuth 2.0: invalid token URL "${r.tokenUrl}".` };
  }

  const key = cacheKey(r);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { authorization: cached.authorization };

  const form = new URLSearchParams();
  form.set('grant_type', r.grantType);
  if (r.scope) form.set('scope', r.scope);
  if (r.grantType === 'password') {
    form.set('username', r.username);
    form.set('password', r.password);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  if (r.clientAuth === 'header') {
    headers.Authorization = `Basic ${Buffer.from(`${r.clientId}:${r.clientSecret}`).toString('base64')}`;
  } else {
    form.set('client_id', r.clientId);
    if (r.clientSecret) form.set('client_secret', r.clientSecret);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchTarget(tokenEndpoint.toString(), {
      method: 'POST',
      headers,
      body: form.toString(),
      signal: controller.signal,
    });
  } catch (e: any) {
    return {
      error:
        e?.name === 'AbortError'
          ? `OAuth 2.0: the token endpoint did not answer within ${TOKEN_REQUEST_TIMEOUT_MS}ms.`
          : `OAuth 2.0: could not reach the token endpoint — ${String(e?.message ?? e)}`,
    };
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text().catch(() => '');

  if (!response.ok) return { error: `OAuth 2.0: ${describeFailure(response.status, raw)}` };

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: 'OAuth 2.0: the token endpoint answered with something that is not JSON.' };
  }

  const token = payload?.access_token;
  if (typeof token !== 'string' || !token) {
    // A 200 with no token is the failure that looks most like success, so it gets its own
    // message rather than an empty Authorization header sent to the target.
    return { error: 'OAuth 2.0: the token endpoint answered 200 but returned no access_token.' };
  }

  // The scheme is the server's to choose (RFC 6749 §7.1), so it comes from the reply rather
  // than being assumed — but providers spell it "bearer" as often as "Bearer", and a
  // recorded request is easier to compare against another when the casing is settled.
  const declared = typeof payload?.token_type === 'string' ? payload.token_type.trim() : '';
  const scheme = !declared || declared.toLowerCase() === 'bearer' ? 'Bearer' : declared;
  const authorization = `${scheme} ${token}`;

  const lifetime = Number(payload?.expires_in);
  const validFor = Number.isFinite(lifetime) && lifetime > 0 ? lifetime * 1000 : DEFAULT_LIFETIME_MS;
  cache.set(key, { authorization, expiresAt: Date.now() + Math.max(validFor - EXPIRY_MARGIN_MS, 0) });

  return { authorization };
}

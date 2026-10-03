import { AuthParamsSchema, type Assertion, type AuthParams } from '@shared/schema';
import { runGrpc, runWebSocket, xpathValue, type ProtocolResponse } from './api-protocols';
import { fetchTarget, substituteInValues, substituteVariables } from './outbound-http';
import { findUnresolvedVariables } from './variables';
import { accessTokenFor } from './oauth2';
import {
  akamaiEdgeGrid,
  asapToken,
  awsSigV4,
  digestAuthorization,
  hawk,
  jwtBearer,
  ntlmAuthenticate,
  ntlmNegotiate,
  oauth1,
  parseChallenge,
  parseNtlmChallenge,
  systemClock,
  type DigestParams,
  type NtlmParams,
} from './api-auth';

/**
 * Running one API request, with its assertions and its extractions.
 *
 * This logic used to live entirely inside the `/api/proxy-api-request` route handler, where
 * nothing else could reach it — so when a test plan came to run an API test,
 * `test-execution-service` had nothing to call and shipped a placeholder instead:
 *
 *     const success = Math.random() > 0.2; // Simulate 80% pass rate
 *
 * Every API test inside a plan therefore reported a fabricated result, failing one run in
 * five with the message "Simulated API test failure". That is worse than having no coverage,
 * because the report looked exactly like a real one and nobody goes looking for coverage
 * they believe they already have.
 */

const REQUEST_TIMEOUT_MS = 30_000;

/** Where a value comes from — the same vocabulary the assertions use. */
export type ExtractionSource = 'status_code' | 'header' | 'body_json_path' | 'body_text' | 'body_xpath';

/**
 * A value captured from a response, to be used by a later request as `{{name}}`.
 *
 * Without these an API test can only check one endpoint in isolation. A real test is a
 * flow — authenticate, create, read back, delete — and every step after the first needs
 * something the previous one returned.
 */
export interface Extraction {
  id: string;
  name: string;
  source: ExtractionSource;
  property?: string;
}

export interface ApiRequestSpec {
  method: string;
  url: string;
  queryParams?: Record<string, string | string[]> | null;
  headers?: Record<string, string> | null;
  body?: unknown;
  assertions?: Assertion[] | null;
  extractions?: Extraction[] | null;
  /**
   * The authentication the saved test carries.
   *
   * The API Tester page built these headers in the browser, so a test's own auth settings
   * were ignored the moment anything else ran it: a plan sent the request anonymous and the
   * test failed for a reason unrelated to what it checked.
   */
  auth?: AuthParams | null;
  /**
   * A multipart/form-data body, in place of `body`.
   *
   * The page used to put a browser FormData in `body`; it reached here through JSON, where a
   * FormData is `{}`, and the target received an empty JSON object instead of the fields and
   * files. Files therefore travel as base64 and are rebuilt into a form here.
   */
  multipart?: MultipartPart[] | null;
  /** A file sent as the whole body, in place of `body` — base64 for the same reason. */
  binary?: { contentType?: string | null; base64: string } | null;
  /** A gRPC test's service definition (server/api-protocols.ts). */
  protoDefinition?: string | null;
}

export type MultipartPart =
  | { key: string; type: 'text'; value: string }
  | { key: string; type: 'file'; fileName: string; contentType?: string | null; base64: string };

/**
 * A form encoded to bytes, with the Content-Type that names its boundary.
 *
 * Bytes rather than the FormData itself: a request sent through a local agent carries text
 * or bytes only (server/agents/agent-fetch.ts), and the boundary has to be in the header
 * that goes with them.
 */
async function encodeMultipart(
  parts: MultipartPart[],
  vars: Record<string, string>,
): Promise<{ bytes: Buffer; contentType: string }> {
  const form = new FormData();
  for (const part of parts) {
    const key = substituteVariables(part.key, vars);
    if (part.type === 'file') {
      const blob = new Blob([Buffer.from(part.base64, 'base64')], {
        type: part.contentType || 'application/octet-stream',
      });
      form.append(key, blob, part.fileName);
    } else {
      form.append(key, substituteVariables(part.value, vars));
    }
  }
  const encoded = new Response(form);
  return {
    bytes: Buffer.from(await encoded.arrayBuffer()),
    contentType: encoded.headers.get('content-type') ?? 'multipart/form-data',
  };
}

function withoutContentType(headers: Record<string, string>): void {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'content-type') delete headers[name];
  }
}

export interface AssertionOutcome {
  assertion: Assertion;
  pass: boolean;
  actualValue: unknown;
  error?: string;
}

export interface ApiRunResult {
  passed: boolean;
  status?: number;
  statusText?: string;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
  assertions: AssertionOutcome[];
  /** Captured values, ready to be merged into the variables of the next request. */
  extracted: Record<string, string>;
  extractionErrors: Array<{ name: string; reason: string }>;
  /** Set when the request could not be made or completed at all. */
  error?: string;
}

/** Reads a dotted path with optional array indexes out of a parsed JSON body. */
export function getValueByPath(obj: any, path: string): any {
  if (!path || path === '$' || path === '') return obj;
  const parts = path.replace(/^\$\.?/, '').split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, prop, index] = arrayMatch;
      current = current[prop];
      if (Array.isArray(current)) {
        current = current[parseInt(index)];
      } else {
        return undefined;
      }
    } else {
      current = current[part];
    }
  }
  return current;
}

function compare(comparison: string, actual: any, target: string | undefined): boolean | string {
  const text = typeof actual === 'string' ? actual : String(actual ?? '');
  switch (comparison) {
    case 'exists': return actual !== undefined && actual !== null;
    case 'not_exists': return actual === undefined || actual === null;
    case 'is_empty': return actual === '' || actual === null || actual === undefined ||
      (Array.isArray(actual) && actual.length === 0);
    case 'is_not_empty': return !(actual === '' || actual === null || actual === undefined ||
      (Array.isArray(actual) && actual.length === 0));
    case 'equals': return String(actual) === String(target);
    case 'not_equals': return String(actual) !== String(target);
    case 'contains': return text.includes(target ?? '');
    case 'not_contains': return !text.includes(target ?? '');
    case 'matches_regex':
      try { return new RegExp(target ?? '').test(text); } catch { return `Invalid regex: ${target}`; }
    case 'not_matches_regex':
      try { return !new RegExp(target ?? '').test(text); } catch { return `Invalid regex: ${target}`; }
    case 'greater_than':
    case 'less_than':
    case 'greater_than_or_equals':
    case 'less_than_or_equals': {
      const a = Number(actual);
      const b = Number(target);
      if (Number.isNaN(a) || Number.isNaN(b)) return 'Not a number for a numeric comparison';
      if (comparison === 'greater_than') return a > b;
      if (comparison === 'less_than') return a < b;
      if (comparison === 'greater_than_or_equals') return a >= b;
      return a <= b;
    }
    default:
      return `Unsupported comparison: ${comparison}`;
  }
}

/** The value an assertion or extraction points at, given a response. */
function valueFrom(
  source: string,
  property: string | undefined,
  response: { status: number; headers: Record<string, string>; body: unknown; text: string; durationMs: number },
): unknown {
  switch (source) {
    case 'status_code': return response.status;
    case 'response_time': return response.durationMs;
    case 'header': return response.headers[(property ?? '').toLowerCase()];
    case 'body_text': return response.text;
    case 'body_json_path':
      return typeof response.body === 'object' && response.body !== null
        ? getValueByPath(response.body, property ?? '$')
        : undefined;
    // An XML answer (SOAP): the text an XPath selects, namespaces ignored when it uses no prefix.
    case 'body_xpath':
      try {
        return xpathValue(response.text, property ?? '/');
      } catch {
        return undefined;
      }
    default: return undefined;
  }
}

/** Answering a challenge takes a second request: these schemes are sent by `sendWithChallenge`. */
type Challenge = { scheme: 'digest'; params: DigestParams } | { scheme: 'ntlm'; params: NtlmParams };

/** Every string parameter of a scheme with `{{name}}` substituted, as the other schemes do. */
function substituted<T extends Record<string, unknown>>(params: T, vars: Record<string, string>): T {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, typeof value === 'string' ? substituteVariables(value, vars) : value]),
  ) as T;
}

/**
 * Adds whatever the test's auth settings imply, to the headers or the query.
 *
 * Returns a message when the request must not be sent, a challenge scheme when it is sent by
 * `sendWithChallenge`, and null when it may be sent as it is. It runs after the body is built,
 * because OAuth 1.0, Hawk, AWS and Akamai sign the body too (server/api-auth.ts).
 *
 * Values go through substitution because the token usually comes from an earlier request
 * in the same plan, or from the environment.
 */
async function applyAuth(
  saved: AuthParams | null | undefined,
  request: { method: string; url: URL; headers: Record<string, string>; body: string | Buffer | undefined },
  vars: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<string | Challenge | null> {
  if (!saved?.type) return null;
  // A test saved while a scheme was only a name holds `{ type }` and nothing else: its
  // parameters come from the schema's defaults, and the scheme then says which one is missing.
  const parsed = AuthParamsSchema.safeParse(saved);
  const auth = parsed.success ? parsed.data : saved;
  const { headers, url } = request;
  const clock = systemClock();
  const setAuthorization = (result: { header: string } | { error: string }) => {
    if ('error' in result) return result.error;
    headers.Authorization = result.header;
    return null;
  };

  // A header the tester wrote by hand is more specific than a setting on the test;
  // overwriting it would make a deliberate override look broken.
  const hasAuthorization = Object.keys(headers).some((h) => h.toLowerCase() === 'authorization');

  switch (auth.type) {
    case 'basic': {
      if (hasAuthorization) return null;
      const username = substituteVariables(auth.params.username ?? '', vars);
      if (!username) return null;
      const password = substituteVariables(auth.params.password ?? '', vars);
      headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      return null;
    }
    case 'bearer': {
      if (hasAuthorization) return null;
      const token = substituteVariables(auth.params.token ?? '', vars);
      if (!token) return null;
      headers.Authorization = `Bearer ${token}`;
      return null;
    }
    case 'apiKey': {
      const key = substituteVariables(auth.params.key ?? '', vars);
      const value = substituteVariables(auth.params.value ?? '', vars);
      if (!key || !value) return null;
      if (auth.params.addTo === 'query') url.searchParams.append(key, value);
      else if (!Object.keys(headers).some((h) => h.toLowerCase() === key.toLowerCase())) headers[key] = value;
      return null;
    }
    case 'oauth2': {
      // A header written by hand still wins, the same way it does for the others: pasting a
      // token in while debugging should not be overridden by the settings behind it.
      if (hasAuthorization) return null;
      const result = await accessTokenFor(auth.params, vars, fetchImpl);
      if ('error' in result) return result.error;
      headers.Authorization = result.authorization;
      return null;
    }
    case 'jwtBearer': {
      if (hasAuthorization && auth.params.addTo === 'header') return null;
      const params = substituted(auth.params, vars);
      const result = jwtBearer(params, clock);
      if ('error' in result) return result.error;
      if (params.addTo === 'query') url.searchParams.set(params.queryParam || 'token', result.token);
      else headers.Authorization = params.headerPrefix ? `${params.headerPrefix} ${result.token}` : result.token;
      return null;
    }
    case 'asap': {
      if (hasAuthorization) return null;
      const result = asapToken(substituted(auth.params, vars), clock);
      if ('error' in result) return result.error;
      headers.Authorization = `Bearer ${result.token}`;
      return null;
    }
    case 'oauth1': {
      if (hasAuthorization && auth.params.addTo === 'header') return null;
      const result = oauth1(substituted(auth.params, vars), request, clock);
      if ('error' in result) return result.error;
      if (result.query) result.query.forEach(([key, value]) => url.searchParams.append(key, value));
      if (result.header) headers.Authorization = result.header;
      return null;
    }
    case 'hawk':
      if (hasAuthorization) return null;
      return setAuthorization(hawk(substituted(auth.params, vars), request, clock));
    case 'akamai':
      if (hasAuthorization) return null;
      return setAuthorization(akamaiEdgeGrid(substituted(auth.params, vars), request, clock));
    case 'aws': {
      if (hasAuthorization) return null;
      const result = awsSigV4(substituted(auth.params, vars), request, clock);
      if ('error' in result) return result.error;
      Object.assign(headers, result.headers);
      return null;
    }
    case 'digest':
    case 'ntlm': {
      if (hasAuthorization) return null;
      const params = substituted(auth.params, vars);
      if (!params.username) return `${auth.type === 'digest' ? 'Digest' : 'NTLM'} authentication needs a username.`;
      return { scheme: auth.type, params } as Challenge;
    }
    case 'none':
    case 'inherit':
      // Deliberately no credentials. 'inherit' means the same here, because this runner has
      // no collection above the request to inherit from.
      return null;
    default: {
      const unknown: never = auth;
      return `Unknown authentication "${(unknown as { type?: string }).type}".`;
    }
  }
}

/**
 * A fetch whose requests all travel on one connection, for the schemes whose handshake belongs
 * to the connection rather than to a request — NTLM. Offered by both transports: this server's
 * (server/outbound-http.ts) and a local agent's (server/agents/agent-fetch.ts).
 */
export type OneConnectionFetch = typeof fetch & {
  oneConnection?: () => { fetch: typeof fetch; close: () => Promise<void> };
  runProtocol?: (request: import('@shared/agent-protocol').AgentProtocolRequest) => Promise<ProtocolResponse>;
};

/**
 * Sends a request whose credentials answer the server's challenge: the request goes out, the
 * server names its terms in WWW-Authenticate, and the request goes again with the answer.
 * A server that does not challenge gets the first request's answer back, as with any scheme.
 */
async function sendWithChallenge(
  challenge: Challenge,
  fetchImpl: OneConnectionFetch,
  url: URL,
  options: RequestInit,
): Promise<Response | { error: string }> {
  const headers = options.headers as Record<string, string>;
  if (challenge.scheme === 'digest') {
    const first = await fetchImpl(url.toString(), options);
    const offered = first.status === 401 ? first.headers.get('www-authenticate') : null;
    const terms = offered ? parseChallenge(offered, 'Digest') : null;
    if (!terms) return first;
    await first.arrayBuffer().catch(() => undefined);
    const authorization = digestAuthorization(
      terms,
      challenge.params,
      { method: String(options.method ?? 'GET').toUpperCase(), uri: `${url.pathname}${url.search}`, body: options.body as string | Buffer | undefined },
      systemClock().nonce(),
    );
    if (typeof authorization !== 'string') return authorization;
    return fetchImpl(url.toString(), { ...options, headers: { ...headers, Authorization: authorization } });
  }

  const connection = fetchImpl.oneConnection?.();
  if (!connection) return { error: 'NTLM needs the whole handshake on one connection, which this transport cannot keep.' };
  try {
    const first = await connection.fetch(url.toString(), { ...options, headers: { ...headers, Authorization: ntlmNegotiate() } });
    const offered = first.status === 401 ? first.headers.get('www-authenticate') ?? '' : '';
    const terms = parseNtlmChallenge(offered);
    if (!terms) return first;
    await first.arrayBuffer().catch(() => undefined);
    const authorization = ntlmAuthenticate(challenge.params, terms, systemClock());
    const answered = await connection.fetch(url.toString(), { ...options, headers: { ...headers, Authorization: authorization } });
    // Read before the connection closes: the body travels on it.
    const body = await answered.arrayBuffer();
    return new Response([204, 205, 304].includes(answered.status) ? null : body, {
      status: answered.status,
      statusText: answered.statusText,
      headers: answered.headers,
    });
  } finally {
    await connection.close().catch(() => {});
  }
}

export async function runApiRequest(
  spec: ApiRequestSpec,
  vars: Record<string, string>,
  // Where the request is sent from: this server, or a local agent (server/agents/agent-fetch.ts).
  fetchImpl: OneConnectionFetch = fetchTarget,
): Promise<ApiRunResult> {
  const startTime = Date.now();
  const empty = {
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    assertions: [] as AssertionOutcome[],
    extracted: {} as Record<string, string>,
    extractionErrors: [] as Array<{ name: string; reason: string }>,
  };

  // Refuse before sending, and name what is missing. Substitution deliberately leaves an
  // unknown `{{name}}` in place, which would otherwise be sent to the target as a literal
  // and come back as a puzzling 404.
  const missing = findUnresolvedVariables(spec.url, vars);
  if (missing.length > 0) {
    return {
      ...empty,
      passed: false,
      durationMs: Date.now() - startTime,
      error:
        `Unresolved variable(s) ${missing.join(', ')} in the URL. Define them in the ` +
        'environment, or capture them from an earlier request in the plan.',
    };
  }

  const resolvedUrl = substituteVariables(spec.url, vars);
  let targetUrl: URL;
  try {
    targetUrl = new URL(resolvedUrl);
  } catch {
    return { ...empty, passed: false, durationMs: Date.now() - startTime, error: `Invalid target URL: "${resolvedUrl}"` };
  }

  for (const [key, value] of Object.entries(substituteInValues(spec.queryParams, vars) ?? {})) {
    if (Array.isArray(value)) value.forEach((v) => targetUrl.searchParams.append(key, v));
    else targetUrl.searchParams.set(key, value);
  }

  const headers: Record<string, string> = { ...(substituteInValues(spec.headers, vars) ?? {}) };
  // Set by the transport, and wrong if carried over from a saved request.
  for (const forbidden of ['host', 'Host', 'content-length', 'Content-Length']) delete headers[forbidden];

  // WebSocket and gRPC: a connection of their own rather than one request (server/api-protocols.ts).
  if (/^(wss?|grpcs?):$/.test(targetUrl.protocol) || spec.method === 'WEBSOCKET' || spec.method === 'GRPC') {
    return runOtherProtocol(spec, vars, targetUrl, headers, fetchImpl, startTime, empty);
  }

  const options: RequestInit = { method: spec.method, headers };
  const carriesBody = spec.method !== 'GET' && spec.method !== 'HEAD';
  if (carriesBody && spec.multipart) {
    const { bytes, contentType } = await encodeMultipart(spec.multipart, vars);
    // Only the encoder knows the boundary, so whatever the request said is replaced.
    withoutContentType(headers);
    headers['Content-Type'] = contentType;
    options.body = bytes;
  } else if (carriesBody && spec.binary) {
    options.body = Buffer.from(spec.binary.base64, 'base64');
    if (!headers['content-type'] && !headers['Content-Type']) {
      headers['Content-Type'] = spec.binary.contentType || 'application/octet-stream';
    }
  } else if (carriesBody && spec.body !== undefined) {
    if (typeof spec.body === 'string') {
      options.body = substituteVariables(spec.body, vars);
    } else if (spec.body !== null) {
      // Substituted as text so `{{name}}` works inside nested values, then re-parsed is
      // unnecessary — the target receives JSON either way.
      options.body = substituteVariables(JSON.stringify(spec.body), vars);
      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }
  }

  // Before the request rather than after a 401: a scheme that cannot be satisfied is a
  // problem with the test, and saying so beats reporting the target's refusal as if the
  // endpoint were at fault.
  const auth = await applyAuth(
    spec.auth,
    { method: spec.method, url: targetUrl, headers, body: options.body as string | Buffer | undefined },
    vars,
    fetchImpl,
  );
  if (typeof auth === 'string') {
    return { ...empty, passed: false, durationMs: Date.now() - startTime, error: auth };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  options.signal = controller.signal;

  let response: Response;
  try {
    const sent = auth ? await sendWithChallenge(auth, fetchImpl, targetUrl, options) : await fetchImpl(targetUrl.toString(), options);
    if (!(sent instanceof Response)) {
      return { ...empty, passed: false, durationMs: Date.now() - startTime, error: sent.error };
    }
    response = sent;
  } catch (e: any) {
    // A target that is down is a failed test, not a crashed runner: the plan has other
    // tests to run, and this one's result is "could not reach it".
    return {
      ...empty,
      passed: false,
      durationMs: Date.now() - startTime,
      error: e?.name === 'AbortError' ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms` : String(e?.message ?? e),
    };
  } finally {
    clearTimeout(timeout);
  }

  const durationMs = Date.now() - startTime;
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => { responseHeaders[key.toLowerCase()] = value; });

  const text = await response.text();
  let body: unknown = text;
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json') && text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  const snapshot = { status: response.status, headers: responseHeaders, body, text, durationMs };
  return { ...evaluate(spec, snapshot), status: response.status, statusText: response.statusText, headers: responseHeaders, body, durationMs };
}

/** The assertions and captures of a request, on whatever answered it. */
function evaluate(
  spec: ApiRequestSpec,
  snapshot: { status: number; headers: Record<string, string>; body: unknown; text: string; durationMs: number },
): Pick<ApiRunResult, 'passed' | 'assertions' | 'extracted' | 'extractionErrors'> {
  const assertions: AssertionOutcome[] = [];
  for (const assertion of spec.assertions ?? []) {
    if (assertion.enabled === false) continue;
    const actualValue = valueFrom(assertion.source, assertion.property, snapshot);
    const outcome = compare(assertion.comparison, actualValue, assertion.targetValue);
    assertions.push(
      typeof outcome === 'string'
        ? { assertion, pass: false, actualValue, error: outcome }
        : { assertion, pass: outcome, actualValue },
    );
  }

  const extracted: Record<string, string> = {};
  const extractionErrors: Array<{ name: string; reason: string }> = [];
  for (const extraction of spec.extractions ?? []) {
    const value = valueFrom(extraction.source, extraction.property, snapshot);
    if (value === undefined || value === null) {
      // Recorded rather than silently skipped: an absent variable becomes a literal
      // `{{name}}` in the next request, which then fails somewhere else entirely and takes
      // the reader with it.
      extractionErrors.push({
        name: extraction.name,
        reason: `Nothing at ${extraction.source}${extraction.property ? ` "${extraction.property}"` : ''}`,
      });
      continue;
    }
    extracted[extraction.name] = typeof value === 'string' ? value : JSON.stringify(value).replace(/^"|"$/g, '');
  }

  return { passed: assertions.every((a) => a.pass), assertions, extracted, extractionErrors };
}

async function runOtherProtocol(
  spec: ApiRequestSpec,
  vars: Record<string, string>,
  targetUrl: URL,
  headers: Record<string, string>,
  fetchImpl: OneConnectionFetch,
  startTime: number,
  empty: Omit<ApiRunResult, 'passed' | 'durationMs'>,
): Promise<ApiRunResult> {
  const fail = (error: string): ApiRunResult => ({ ...empty, passed: false, durationMs: Date.now() - startTime, error });
  const grpc = targetUrl.protocol === 'grpc:' || targetUrl.protocol === 'grpcs:' || spec.method === 'GRPC';
  const kind = grpc ? 'gRPC' : 'WebSocket';
  if (fetchImpl !== fetchTarget && !fetchImpl.runProtocol) return fail(`The selected transport does not support ${kind} tests.`);
  if (grpc && targetUrl.protocol !== 'grpc:' && targetUrl.protocol !== 'grpcs:') return fail('A gRPC address starts with grpc:// or grpcs://.');
  if (!grpc && targetUrl.protocol !== 'ws:' && targetUrl.protocol !== 'wss:') return fail('A WebSocket address starts with ws:// or wss://.');
  // Header-based authorizations (bearer, basic, API key…) go on the handshake or the metadata.
  const auth = await applyAuth(spec.auth, { method: 'GET', url: targetUrl, headers, body: undefined }, vars, fetchImpl);
  if (typeof auth === 'string') return fail(auth);
  if (auth) return fail(`${auth.scheme === 'ntlm' ? 'NTLM' : 'Digest'} authentication is not available for ${kind}.`);
  const body = typeof spec.body === 'string' ? substituteVariables(spec.body, vars) : spec.body == null ? '' : substituteVariables(JSON.stringify(spec.body), vars);
  let answer: ProtocolResponse;
  try {
    answer = fetchImpl.runProtocol
      ? await fetchImpl.runProtocol({ protocol: grpc ? 'grpc' : 'websocket', url: targetUrl.toString(), proto: spec.protoDefinition ?? undefined, headers, body, timeoutMs: REQUEST_TIMEOUT_MS })
      : grpc
      ? await runGrpc({ url: targetUrl, proto: spec.protoDefinition ?? '', headers, body, timeoutMs: REQUEST_TIMEOUT_MS })
      : await runWebSocket({ url: targetUrl.toString(), headers, body, timeoutMs: REQUEST_TIMEOUT_MS });
  } catch (error) {
    return fail((error as Error).message);
  }
  const durationMs = Date.now() - startTime;
  const snapshot = { status: answer.status, headers: answer.headers, body: answer.body, text: answer.text, durationMs };
  return { ...evaluate(spec, snapshot), status: answer.status, statusText: answer.statusText, headers: answer.headers, body: answer.body, durationMs };
}

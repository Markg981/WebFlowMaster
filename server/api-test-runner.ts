import type { Assertion } from '@shared/schema';
import { fetchTarget, substituteInValues, substituteVariables } from './outbound-http';
import { findUnresolvedVariables } from './variables';

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
export type ExtractionSource = 'status_code' | 'header' | 'body_json_path' | 'body_text';

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
    default: return undefined;
  }
}

export async function runApiRequest(
  spec: ApiRequestSpec,
  vars: Record<string, string>,
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

  const options: RequestInit = { method: spec.method, headers };
  if (spec.method !== 'GET' && spec.method !== 'HEAD' && spec.body !== undefined) {
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  options.signal = controller.signal;

  let response: Response;
  try {
    response = await fetchTarget(targetUrl.toString(), options);
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

  return {
    passed: assertions.every((a) => a.pass),
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body,
    durationMs,
    assertions,
    extracted,
    extractionErrors,
  };
}

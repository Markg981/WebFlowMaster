import type { Precondition, PreconditionCheck } from '@shared/schema';
import { fetchTarget, substituteVariables as substituteVars } from './outbound-http';

/** What became of one precondition. `satisfied` is a success, not a skipped failure. */
export type PreconditionStatus = 'applied' | 'satisfied' | 'failed';

export interface PreconditionStep {
  name: string;
  status: PreconditionStatus;
  /** Why it was already satisfied, or what the setup call did. */
  detail?: string;
}

export interface PreconditionResult {
  ok: boolean;
  /** Setup calls that actually ran. Preconditions found already satisfied are not counted. */
  ranCount: number;
  /** Preconditions whose state was already as required, so nothing was called. */
  satisfiedCount: number;
  /** One entry per precondition, in order, for the report. */
  steps: PreconditionStep[];
  failedAt?: string; // name of the precondition that failed
  reason?: string;
}

/** Builds the URL for a request shape, applying variables and enabled query params. */
function buildUrl(
  rawUrl: string,
  queryParams: Precondition['queryParams'],
  vars: Record<string, string>,
): { url: string } | { error: string } {
  const url = substituteVars(rawUrl, vars);
  const qp = (queryParams ?? []).filter((p) => p.enabled !== false && p.key);
  if (qp.length === 0) return { url };
  try {
    const u = new URL(url);
    for (const p of qp) u.searchParams.set(p.key, substituteVars(p.value, vars));
    return { url: u.toString() };
  } catch {
    return { error: `invalid URL: ${url}` };
  }
}

/** Reads a dotted path out of a parsed body. Returns undefined for anything missing. */
function readPath(body: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>(
      (node, key) =>
        node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      body,
    );
}

/**
 * Asks whether a precondition's state is already in place.
 *
 * A check that cannot be carried out — the endpoint is down, the body is not the JSON the
 * path assumes — reports `false`, not an error: the answer is "I could not establish that
 * it is already done", and the honest response to that is to do it. The setup call then
 * either succeeds or fails on its own terms, which is a better failure to read than one
 * about a probe.
 */
async function isAlreadySatisfied(
  check: PreconditionCheck,
  vars: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ satisfied: boolean; detail?: string }> {
  const built = buildUrl(check.url, check.queryParams, vars);
  if ('error' in built) return { satisfied: false };

  const method = (check.method || 'GET').toUpperCase();
  const headers: Record<string, string> = { ...(check.requestHeaders ?? {}) };

  let res: Response;
  try {
    res = await fetchImpl(built.url, { method, headers });
  } catch {
    return { satisfied: false };
  }

  const acceptable = check.expectStatus ?? null;
  const statusOk = acceptable ? acceptable.includes(res.status) : res.ok;
  if (!statusOk) return { satisfied: false };

  // Status alone is the whole check when nothing else was asked for.
  if (!check.jsonPath && check.bodyContains == null) {
    return { satisfied: true, detail: `${method} ${built.url} answered ${res.status}` };
  }

  let text: string;
  try {
    text = await res.text();
  } catch {
    return { satisfied: false };
  }

  if (check.bodyContains != null) {
    const needle = substituteVars(check.bodyContains, vars);
    if (!text.includes(needle)) return { satisfied: false };
    if (!check.jsonPath) {
      return { satisfied: true, detail: `response contains "${needle}"` };
    }
  }

  if (check.jsonPath) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { satisfied: false };
    }
    const actual = readPath(body, check.jsonPath);
    // With no `equals`, the path merely has to be there and not be false or null — enough
    // for the common "does this record exist" shape.
    if (check.equals === undefined || check.equals === null) {
      const present = actual !== undefined && actual !== null && actual !== false;
      return present
        ? { satisfied: true, detail: `${check.jsonPath} is present` }
        : { satisfied: false };
    }
    const wanted =
      typeof check.equals === 'string' ? substituteVars(check.equals, vars) : check.equals;
    // Compared as written, except that a JSON number or boolean read back as a string from
    // a loosely typed API would otherwise never match what the author typed in the field.
    const same = actual === wanted || String(actual) === String(wanted);
    return same
      ? { satisfied: true, detail: `${check.jsonPath} is already ${String(wanted)}` }
      : { satisfied: false };
  }

  return { satisfied: false };
}

/**
 * Runs a UI test's preconditions — ordered API setup calls made against the app under
 * test's own API, so state is established through real business logic (never raw DB).
 *
 * Fail-fast: the first non-2xx response or network error stops execution and reports which
 * precondition failed, so the caller can mark the test blocked instead of producing a
 * misleading pass/fail.
 *
 * A precondition states a starting point, not an operation. Where one carries a `check`,
 * the runner asks whether that starting point is already there and skips the call when it
 * is; where one lists `satisfiedStatuses`, a setup call answering with one of them — 409 on
 * a create being the usual case — counts as satisfied rather than failed. Both are
 * successes and both are reported as such, because "the order already existed" and "the
 * order was created" are different facts about the run and a report that shows them
 * identically cannot be used to explain either.
 */
export async function runPreconditions(
  preconditions: Precondition[] | null | undefined,
  vars: Record<string, string>,
  fetchImpl: typeof fetch = fetchTarget,
): Promise<PreconditionResult> {
  const list = preconditions ?? [];
  const steps: PreconditionStep[] = [];
  let ran = 0;
  let satisfied = 0;

  const fail = (name: string, reason: string): PreconditionResult => {
    steps.push({ name, status: 'failed', detail: reason });
    return { ok: false, ranCount: ran, satisfiedCount: satisfied, steps, failedAt: name, reason };
  };

  for (const pc of list) {
    if (pc.check) {
      const already = await isAlreadySatisfied(pc.check, vars, fetchImpl);
      if (already.satisfied) {
        satisfied++;
        steps.push({ name: pc.name, status: 'satisfied', detail: already.detail });
        continue;
      }
    }

    const built = buildUrl(pc.url, pc.queryParams, vars);
    if ('error' in built) return fail(pc.name, built.error);
    const url = built.url;

    const headers: Record<string, string> = { ...(pc.requestHeaders ?? {}) };
    let body: string | undefined;
    const method = (pc.method || 'GET').toUpperCase();
    if (pc.requestBody != null && method !== 'GET' && method !== 'HEAD') {
      body = typeof pc.requestBody === 'string' ? pc.requestBody : JSON.stringify(pc.requestBody);
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
    }

    ran++;
    try {
      const res = await fetchImpl(url, { method, headers, body });
      if (!res.ok) {
        if ((pc.satisfiedStatuses ?? []).includes(res.status)) {
          // Not a failure: the state the precondition asks for is there, and this is how
          // that API says so.
          ran--;
          satisfied++;
          steps.push({
            name: pc.name,
            status: 'satisfied',
            detail: `HTTP ${res.status} from ${method} ${url} — already in place`,
          });
          continue;
        }
        return fail(pc.name, `HTTP ${res.status} from ${method} ${url}`);
      }
    } catch (e: any) {
      return fail(pc.name, `request error: ${e?.message ?? String(e)}`);
    }
    steps.push({ name: pc.name, status: 'applied', detail: `${method} ${url}` });
  }

  return { ok: true, ranCount: ran, satisfiedCount: satisfied, steps };
}

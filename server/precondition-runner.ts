import type { Precondition } from '@shared/schema';

export interface PreconditionResult {
  ok: boolean;
  ranCount: number;
  failedAt?: string; // name of the precondition that failed
  reason?: string;
}

function substituteVars(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => (k in vars ? vars[k] : `{{${k}}}`));
}

/**
 * Runs a UI test's preconditions — ordered API setup calls made against the app under
 * test's own API, so state is established through real business logic (never raw DB).
 * Fail-fast: the first non-2xx response or network error stops execution and reports
 * which precondition failed, so the caller can mark the test blocked instead of
 * producing a misleading pass/fail.
 */
export async function runPreconditions(
  preconditions: Precondition[] | null | undefined,
  vars: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<PreconditionResult> {
  const list = preconditions ?? [];
  let ran = 0;
  for (const pc of list) {
    let url = substituteVars(pc.url, vars);
    const qp = (pc.queryParams ?? []).filter((p) => p.enabled !== false && p.key);
    if (qp.length > 0) {
      try {
        const u = new URL(url);
        for (const p of qp) u.searchParams.set(p.key, substituteVars(p.value, vars));
        url = u.toString();
      } catch {
        return { ok: false, ranCount: ran, failedAt: pc.name, reason: `invalid URL: ${url}` };
      }
    }

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
        return { ok: false, ranCount: ran, failedAt: pc.name, reason: `HTTP ${res.status} from ${method} ${url}` };
      }
    } catch (e: any) {
      return { ok: false, ranCount: ran, failedAt: pc.name, reason: `request error: ${e?.message ?? String(e)}` };
    }
  }
  return { ok: true, ranCount: ran };
}

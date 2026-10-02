import type { Cleanup } from '@shared/schema';
import { fetchTarget, substituteVariables } from './outbound-http';

/**
 * A UI test's cleanup: API calls made after the test, whatever its outcome, to remove the data it
 * created — the order it placed, the customer its precondition made. The counterpart of
 * preconditions (server/precondition-runner.ts), with the opposite temper:
 *
 * - Not fail-fast. Every cleanup is attempted, because one that fails is no reason to leave the
 *   rest of the data behind too.
 * - Idempotent by default. 404 and 410 mean the thing is already gone, which is what was wanted:
 *   a cleanup that deletes what a precondition created runs once per dataset row, and only the
 *   first finds it. `satisfiedStatuses` adds others.
 * - A call naming a variable the run never set is not made: `DELETE /orders/{{orderId}}` after a
 *   test that failed before it stored the order id would otherwise go to `/orders/{{orderId}}`.
 *   It is reported as skipped, which is what happened.
 * - It never changes the test's result: that is about the application. A cleanup that failed is
 *   reported as such, on its own line, because it left data behind.
 */

export type CleanupStatus = 'done' | 'gone' | 'skipped' | 'failed';

export interface CleanupStep {
  name: string;
  status: CleanupStatus;
  detail: string;
}

export interface CleanupResult {
  /** No cleanup failed. Skipped ones do not count against it, and are reported. */
  ok: boolean;
  steps: CleanupStep[];
}

/** How long one cleanup call may take: the run waits for it, and a hung API must not hold it. */
export const CLEANUP_TIMEOUT_MS = 30_000;
/** Answers that mean the thing is already gone. */
const GONE = [404, 410];
const UNRESOLVED = /\{\{\s*([\w.]+)\s*\}\}/;

function unresolvedIn(values: Array<string | undefined>): string | null {
  for (const value of values) {
    const match = value ? UNRESOLVED.exec(value) : null;
    if (match) return match[1];
  }
  return null;
}

/**
 * Runs the cleanups once for each set of variables: one per run of the steps (a dataset row each),
 * holding what those steps stored ({{orderId}} from a "store text" step) over the environment's.
 */
export async function runCleanups(
  cleanups: Cleanup[] | null | undefined,
  variableSets: Array<Record<string, string>>,
  fetchImpl: typeof fetch = fetchTarget,
): Promise<CleanupResult> {
  const list = cleanups ?? [];
  const steps: CleanupStep[] = [];
  if (list.length === 0) return { ok: true, steps };
  const sets = variableSets.length > 0 ? variableSets : [{}];

  for (const [index, vars] of sets.entries()) {
    const prefix = sets.length > 1 ? `Row ${index + 1} — ` : '';
    for (const cleanup of list) {
      const name = `${prefix}${cleanup.name}`;
      const method = (cleanup.method || 'DELETE').toUpperCase();
      const url = substituteVariables(cleanup.url, vars);
      const query = (cleanup.queryParams ?? [])
        .filter((p) => p.enabled !== false && p.key)
        .map((p) => ({ key: p.key, value: substituteVariables(p.value, vars) }));
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(cleanup.requestHeaders ?? {})) headers[key] = substituteVariables(value, vars);
      let body: string | undefined;
      if (cleanup.requestBody != null && method !== 'GET' && method !== 'HEAD') {
        const raw = typeof cleanup.requestBody === 'string' ? cleanup.requestBody : JSON.stringify(cleanup.requestBody);
        body = substituteVariables(raw, vars);
        if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
      }

      const missing = unresolvedIn([url, body, ...query.map((q) => q.value), ...Object.values(headers)]);
      if (missing) {
        steps.push({ name, status: 'skipped', detail: `not called: {{${missing}}} has no value in this run (the step that sets it did not run)` });
        continue;
      }

      let target: string;
      try {
        const u = new URL(url);
        for (const q of query) u.searchParams.set(q.key, q.value);
        target = u.toString();
      } catch {
        steps.push({ name, status: 'failed', detail: `invalid URL: ${url}` });
        continue;
      }

      try {
        const res = await fetchImpl(target, { method, headers, body, signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS) });
        if (res.ok) steps.push({ name, status: 'done', detail: `${method} ${target} answered ${res.status}` });
        else if ([...GONE, ...(cleanup.satisfiedStatuses ?? [])].includes(res.status)) {
          steps.push({ name, status: 'gone', detail: `${method} ${target} answered ${res.status}: already gone` });
        } else steps.push({ name, status: 'failed', detail: `HTTP ${res.status} from ${method} ${target}` });
        // The body is not read; release the connection.
        await res.body?.cancel().catch(() => undefined);
      } catch (error) {
        const message = error instanceof Error ? (error.name === 'TimeoutError' ? `no answer in ${CLEANUP_TIMEOUT_MS / 1000}s` : error.message) : String(error);
        steps.push({ name, status: 'failed', detail: `request error: ${message}` });
      }
    }
  }
  return { ok: steps.every((s) => s.status !== 'failed'), steps };
}

/** The cleanup as one line of the test's steps in a report: failed when any call failed. */
export function cleanupReportStep(result: CleanupResult): { name: string; type: 'cleanup'; status: 'passed' | 'failed'; details: string; error?: string } {
  const count = (status: CleanupStatus) => result.steps.filter((s) => s.status === status).length;
  const parts = [`${count('done')} done`, count('gone') ? `${count('gone')} already gone` : '', count('skipped') ? `${count('skipped')} skipped` : '', count('failed') ? `${count('failed')} failed` : '']
    .filter(Boolean)
    .join(', ');
  const failed = result.steps.filter((s) => s.status === 'failed');
  return {
    name: 'Cleanup',
    type: 'cleanup',
    status: result.ok ? 'passed' : 'failed',
    details: `${parts}. ${result.steps.map((s) => `${s.name}: ${s.status} (${s.detail})`).join('; ')}`,
    ...(failed.length > 0 ? { error: `Data may have been left behind: ${failed.map((s) => `${s.name} — ${s.detail}`).join('; ')}` } : {}),
  };
}

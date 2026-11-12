import type {
  CheckpointCapture,
  ComparisonDifference,
  ComparisonPolicy,
  NetworkCheckpointEntry,
} from '@shared/comparison';
import { urlPatternMatcher } from '@shared/patterns';
import { diffCheckpoints, unionKeys, type DifferenceAt } from './checkpoints';
import type { ComparedStep } from './steps';

/** The entries of a stored network checkpoint, read defensively: it comes from a stored log. */
function entriesOf(capture: CheckpointCapture): NetworkCheckpointEntry[] {
  const entries = (capture.data as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      method: String(e.method ?? ''),
      path: String(e.path ?? ''),
      query: Array.isArray(e.query) ? e.query.map((q) => String(q)) : [],
      requestBodyHash: typeof e.requestBodyHash === 'string' ? e.requestBodyHash : null,
      status: typeof e.status === 'number' ? e.status : 0,
      ...(typeof e.responseBodyHash === 'string' ? { responseBodyHash: e.responseBodyHash } : {}),
    }));
}

/**
 * The requests of each side grouped by what identifies a call, under the policy: method, path and
 * query without the ignored parameters. Only the paths the policy includes count; an empty list
 * includes every path.
 */
function callsOf(
  entries: NetworkCheckpointEntry[],
  policy: ComparisonPolicy['network'],
): Map<string, NetworkCheckpointEntry[]> {
  const include = policy.include.map(urlPatternMatcher);
  const ignored = new Set(policy.ignoreQueryParams);
  const calls = new Map<string, NetworkCheckpointEntry[]>();
  for (const entry of entries) {
    if (include.length > 0 && !include.some((matches) => matches(entry.path))) continue;
    const query = entry.query.filter((q) => !ignored.has(q.split('=')[0]));
    const key = `${entry.method} ${entry.path}${query.length > 0 ? `?${query.join('&')}` : ''}`;
    const same = calls.get(key) ?? [];
    same.push(entry);
    calls.set(key, same);
  }
  // The same call made twice pairs by status and bodies, not by the order it was answered in.
  const order = (e: NetworkCheckpointEntry) =>
    `${String(e.status).padStart(3, '0')}|${e.requestBodyHash ?? ''}|${e.responseBodyHash ?? ''}`;
  for (const same of calls.values()) same.sort((p, q) => (order(p) < order(q) ? -1 : 1));
  return calls;
}

/**
 * Network checkpoints with the same name: how many times each call was made, and for each its
 * status, request body hash and, when the policy asks, response body hash.
 */
export function diffNetwork(
  baseline: ComparedStep[],
  candidate: ComparedStep[],
  policy: ComparisonPolicy,
): ComparisonDifference[] {
  return diffCheckpoints(baseline, candidate, 'network', (a, b) => {
    const left = callsOf(entriesOf(a), policy.network);
    const right = callsOf(entriesOf(b), policy.network);
    const out: DifferenceAt[] = [];
    for (const call of unionKeys(left, right)) {
      const x = left.get(call) ?? [];
      const y = right.get(call) ?? [];
      const at = `requests[${call}]`;
      if (x.length !== y.length)
        out.push({ path: `${at}.count`, baseline: x.length, candidate: y.length });
      for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
        const n = x.length > 1 ? `#${i + 1}` : '';
        if (x[i].status !== y[i].status)
          out.push({ path: `${at}${n}.status`, baseline: x[i].status, candidate: y[i].status });
        if (x[i].requestBodyHash !== y[i].requestBodyHash)
          out.push({
            path: `${at}${n}.requestBody`,
            baseline: x[i].requestBodyHash,
            candidate: y[i].requestBodyHash,
          });
        // A response not hashed on one side (not a fetch, or too large) is not compared.
        const ha = x[i].responseBodyHash;
        const hb = y[i].responseBodyHash;
        if (policy.network.compareResponseHash && ha && hb && ha !== hb)
          out.push({ path: `${at}${n}.responseBody`, baseline: ha, candidate: hb });
      }
    }
    return out;
  });
}

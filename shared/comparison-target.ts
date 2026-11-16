/**
 * Where one side of a comparison runs, when the comparison names addresses
 * (docs/superpowers/specs/2026-11-16-comparison-urls-design.md).
 *
 * A side's run sees `{{baseUrl}}` as its own address, and every address of the other version
 * written in a test's definition is replaced by its own before the test runs, so a test recorded
 * with a fixed address still opens the version this side is about. Pure: the frozen definitions
 * are never changed, only the copy a run hands to the runner.
 */
import { normalizeComparisonUrl, type ComparisonRole, type ComparisonTarget } from './comparison';

export interface ComparisonAddresses {
  baselineUrl?: string | null;
  candidateUrl?: string | null;
  recordedUrl?: string | null;
}

/** The target of one side, or undefined when that side names no address. */
export function comparisonTargetFor(
  role: ComparisonRole,
  addresses: ComparisonAddresses,
): ComparisonTarget | undefined {
  const own = role === 'baseline' ? addresses.baselineUrl : addresses.candidateUrl;
  if (!own) return undefined;
  const url = normalizeComparisonUrl(own);
  const other = role === 'baseline' ? addresses.candidateUrl : addresses.baselineUrl;
  const rewriteFrom = [other, addresses.recordedUrl]
    .filter((value): value is string => !!value)
    .map(normalizeComparisonUrl)
    .filter((value, index, all) => value !== url && all.indexOf(value) === index)
    // Longest first, so `https://a/app` is not replaced inside `https://a/app-old` by a shorter rule.
    .sort((a, b) => b.length - a.length);
  return { url, rewriteFrom };
}

/**
 * `text` with every address in `rewriteFrom` replaced by the target's own. An address matches
 * only where it ends: `https://a/app` is replaced in `https://a/app/login` and `https://a/app?x`,
 * not in `https://a/application`.
 */
export function retargetText(text: string, target: ComparisonTarget): string {
  let out = text;
  for (const from of target.rewriteFrom) {
    if (!out.includes(from)) continue;
    const pattern = new RegExp(`${escapeRegExp(from)}(?=$|[/?#"'\`\\s<>()\\[\\]{},;|])`, 'g');
    out = out.replace(pattern, () => target.url);
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A copy of a test definition (or any JSON-like value) with every string retargeted. Values that
 * are not plain objects, arrays or strings (dates, numbers) are kept as they are.
 */
export function retargetDefinition<T>(value: T, target: ComparisonTarget | undefined): T {
  if (!target || target.rewriteFrom.length === 0) return value;
  return walk(value, target) as T;
}

function walk(value: unknown, target: ComparisonTarget): unknown {
  if (typeof value === 'string') return retargetText(value, target);
  if (Array.isArray(value)) return value.map((item) => walk(item, target));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = walk(item, target);
    return out;
  }
  return value;
}

/** A side's name when it has no environment: the address's host, or the address itself. */
export function comparisonSideLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname && parsed.pathname !== '/'
      ? `${parsed.host}${parsed.pathname}`
      : parsed.host;
  } catch {
    return url;
  }
}

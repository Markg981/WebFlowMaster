/**
 * How fast a page is, as a test step sees it (server/web-performance.ts).
 *
 * Two steps. `measurePerformance` reads what the browser itself recorded about the page the test
 * is on — the Core Web Vitals and the timings around them — and checks them against limits.
 * `auditLighthouse` runs Lighthouse against the page's address and checks its category scores.
 *
 * Limits are written as the step's value, one comparison per metric:
 *
 *   LCP < 2.5s, CLS <= 0.1, TTFB < 800ms, weight < 2MB
 *   performance >= 80, accessibility >= 90
 *
 * Times take `ms` or `s` (milliseconds when bare), sizes `KB` or `MB` (bytes when bare).
 */

export const PERFORMANCE_METRICS = ['LCP', 'FCP', 'CLS', 'INP', 'TBT', 'TTFB', 'DCL', 'LOAD', 'REQUESTS', 'WEIGHT'] as const;
export type PerformanceMetric = (typeof PERFORMANCE_METRICS)[number];

export const LIGHTHOUSE_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
export type LighthouseCategory = (typeof LIGHTHOUSE_CATEGORIES)[number];

export const METRIC_LABELS: Record<PerformanceMetric, string> = {
  LCP: 'Largest Contentful Paint',
  FCP: 'First Contentful Paint',
  CLS: 'Cumulative Layout Shift',
  INP: 'Interaction to Next Paint',
  TBT: 'Total Blocking Time',
  TTFB: 'Time to First Byte',
  DCL: 'DOM content loaded',
  LOAD: 'Load event',
  REQUESTS: 'Requests',
  WEIGHT: 'Transferred',
};

/** What a metric is measured in, for parsing limits and showing values. */
export const METRIC_UNIT: Record<PerformanceMetric, 'ms' | 'score' | 'count' | 'bytes'> = {
  LCP: 'ms', FCP: 'ms', CLS: 'score', INP: 'ms', TBT: 'ms', TTFB: 'ms', DCL: 'ms', LOAD: 'ms', REQUESTS: 'count', WEIGHT: 'bytes',
};

/**
 * The limits an empty `measurePerformance` checks: Google's "good" thresholds for the Core Web
 * Vitals. INP needs an interaction before the step; without one it is not measured.
 */
export const DEFAULT_PERFORMANCE_LIMITS = 'LCP <= 2500, CLS <= 0.1, INP <= 200';

export type Comparison = '<' | '<=' | '>' | '>=';

export interface Limit<M extends string = string> {
  metric: M;
  op: Comparison;
  value: number;
  /** As written, for messages. */
  text: string;
}

export interface Check<M extends string = string> extends Limit<M> {
  actual: number | null;
  /** True when it holds; null when the metric could not be measured (it does not fail the step). */
  ok: boolean | null;
}

export interface PerformanceFinding {
  url: string;
  /** Null where this browser does not measure it (only Chromium reports LCP, CLS, INP and TBT). */
  metrics: Record<PerformanceMetric, number | null>;
  checks: Check<PerformanceMetric>[];
}

export interface LighthouseFinding {
  url: string;
  formFactor: 'mobile' | 'desktop';
  /** 0–100 per category. */
  scores: Partial<Record<LighthouseCategory, number>>;
  /** Lab values Lighthouse measured, in ms (CLS unitless). */
  metrics: Partial<Record<'LCP' | 'FCP' | 'CLS' | 'TBT' | 'SI' | 'TTI', number>>;
  checks: Check<LighthouseCategory>[];
  /** The HTML report, kept with the run's evidence. */
  reportUrl?: string;
}

const COMPARISON = /^\s*([A-Za-z-]+)\s*(<=|>=|<|>)\s*([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)\s*$/;

function scaled(value: number, unit: string, kind: 'ms' | 'score' | 'count' | 'bytes'): number | string {
  const u = unit.toLowerCase();
  if (kind === 'ms') return u === '' || u === 'ms' ? value : u === 's' ? value * 1000 : `Use ms or s for a time, not "${unit}".`;
  if (kind === 'bytes') {
    if (u === '' || u === 'b') return value;
    if (u === 'kb') return value * 1024;
    if (u === 'mb') return value * 1024 * 1024;
    return `Use KB or MB for a size, not "${unit}".`;
  }
  return u === '' ? value : `"${unit}" means nothing after a ${kind === 'count' ? 'count' : 'score'}.`;
}

/** `LCP < 2.5s, CLS <= 0.1` as limits, or the first thing wrong with it. */
export function parsePerformanceLimits(text: string): Limit<PerformanceMetric>[] | { error: string } {
  const limits: Limit<PerformanceMetric>[] = [];
  for (const part of text.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean)) {
    const m = COMPARISON.exec(part);
    if (!m) return { error: `"${part}" is not a limit. Write it like LCP < 2.5s or CLS <= 0.1.` };
    const metric = m[1].toUpperCase() as PerformanceMetric;
    if (!PERFORMANCE_METRICS.includes(metric)) return { error: `Unknown metric "${m[1]}". Use one of: ${PERFORMANCE_METRICS.join(', ')}.` };
    const value = scaled(Number(m[3]), m[4], METRIC_UNIT[metric]);
    if (typeof value === 'string') return { error: `${part}: ${value}` };
    limits.push({ metric, op: m[2] as Comparison, value, text: part });
  }
  return limits;
}

/** `performance >= 80, seo >= 90` as limits; `desktop` or `mobile` anywhere chooses the form factor. */
export function parseLighthouseLimits(text: string): { limits: Limit<LighthouseCategory>[]; formFactor: 'mobile' | 'desktop' } | { error: string } {
  const limits: Limit<LighthouseCategory>[] = [];
  let formFactor: 'mobile' | 'desktop' = 'mobile';
  for (const part of text.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean)) {
    if (/^(desktop|mobile)$/i.test(part)) {
      formFactor = part.toLowerCase() as 'mobile' | 'desktop';
      continue;
    }
    const m = COMPARISON.exec(part);
    if (!m) return { error: `"${part}" is not a limit. Write it like performance >= 80, or desktop.` };
    const category = m[1].toLowerCase() as LighthouseCategory;
    if (!LIGHTHOUSE_CATEGORIES.includes(category)) return { error: `Unknown category "${m[1]}". Use one of: ${LIGHTHOUSE_CATEGORIES.join(', ')}.` };
    if (m[4]) return { error: `${part}: a score is a number from 0 to 100.` };
    const value = Number(m[3]);
    if (value < 0 || value > 100) return { error: `${part}: a score is a number from 0 to 100.` };
    limits.push({ metric: category, op: m[2] as Comparison, value, text: part });
  }
  return { limits, formFactor };
}

export function holds(actual: number, op: Comparison, limit: number): boolean {
  switch (op) {
    case '<': return actual < limit;
    case '<=': return actual <= limit;
    case '>': return actual > limit;
    case '>=': return actual >= limit;
  }
}

export function check<M extends string>(limits: Limit<M>[], values: Partial<Record<M, number | null>>): Check<M>[] {
  return limits.map((limit) => {
    const actual = values[limit.metric] ?? null;
    return { ...limit, actual, ok: actual === null ? null : holds(actual, limit.op, limit.value) };
  });
}

export function formatMetric(metric: PerformanceMetric, value: number | null): string {
  if (value === null) return '—';
  switch (METRIC_UNIT[metric]) {
    case 'ms': return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
    case 'bytes': return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(2)} MB` : `${Math.round(value / 1024)} KB`;
    case 'score': return value.toFixed(3);
    default: return String(Math.round(value));
  }
}

/** One line for the step: the limits that failed, or what was measured. */
export function describeChecks<M extends string>(checks: Check<M>[], format: (metric: M, value: number | null) => string): string {
  const failed = checks.filter((c) => c.ok === false);
  const missing = checks.filter((c) => c.ok === null);
  const parts = (failed.length ? failed : checks.filter((c) => c.ok)).map((c) => `${c.metric} ${format(c.metric, c.actual)} (limit ${c.op} ${format(c.metric, c.value)})`);
  const head = failed.length ? `Over the limit: ${parts.join('; ')}.` : parts.length ? `Within the limits: ${parts.join('; ')}.` : 'Measured.';
  return missing.length ? `${head} Not measured in this browser or page: ${missing.map((c) => c.metric).join(', ')}.` : head;
}

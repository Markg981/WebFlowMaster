import type {
  ChartCheckpointData,
  CheckpointCapture,
  ComparisonDifference,
  ComparisonPolicy,
} from '@shared/comparison';
import { numbersMatch } from './normalizers';
import { diffCheckpoints, keyed, unionKeys, type DifferenceAt } from './checkpoints';
import type { ComparedStep } from './steps';

type Series = ChartCheckpointData['series'][number];
type Point = Series['points'][number];

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** The model of a stored chart checkpoint, read defensively: it comes from a stored log. */
function chartOf(capture: CheckpointCapture): ChartCheckpointData {
  const data = (capture.data ?? {}) as Partial<Record<keyof ChartCheckpointData, unknown>>;
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v)
      ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      : [];
  return {
    series: list(data.series).map((s) => ({
      name: String(s.name ?? ''),
      type: String(s.type ?? ''),
      points: (Array.isArray(s.points) ? s.points : [])
        .filter((p): p is unknown[] => Array.isArray(p))
        .map((p): Point => [typeof p[0] === 'number' ? p[0] : String(p[0] ?? ''), finite(p[1])]),
    })),
    axes: list(data.axes).map((a) => ({
      name: String(a.name ?? ''),
      min: finite(a.min),
      max: finite(a.max),
    })),
    lines: list(data.lines).map((l) => ({
      axis: String(l.axis ?? ''),
      value: finite(l.value) ?? 0,
      label: String(l.label ?? ''),
    })),
  };
}

/** Two values of a chart the same: both missing, or numbers within the tolerance. */
function valuesMatch(a: number | null, b: number | null, policy: ComparisonPolicy): boolean {
  if (a === null || b === null) return a === b;
  return numbersMatch(a, b, policy.numeric);
}

function diffSeries(x: Series[], y: Series[], policy: ComparisonPolicy, out: DifferenceAt[]) {
  const left = keyed(x, (s) => s.name);
  const right = keyed(y, (s) => s.name);
  for (const name of unionKeys(left, right)) {
    const a = left.get(name);
    const b = right.get(name);
    const at = `series[${name}]`;
    if (!a || !b) {
      out.push({ path: at, baseline: a ?? null, candidate: b ?? null });
      continue;
    }
    if (a.type !== b.type) out.push({ path: `${at}.type`, baseline: a.type, candidate: b.type });
    // Points pair by their argument, so a category missing on one side shifts nothing.
    const pa = keyed(a.points, (p) => String(p[0]));
    const pb = keyed(b.points, (p) => String(p[0]));
    for (const arg of unionKeys(pa, pb)) {
      const va = pa.get(arg);
      const vb = pb.get(arg);
      if (va && vb && valuesMatch(va[1], vb[1], policy)) continue;
      out.push({
        path: `${at}.points[${arg}]`,
        baseline: va ? va[1] : null,
        candidate: vb ? vb[1] : null,
      });
    }
  }
}

/**
 * Chart checkpoints with the same name: series paired by name and their points by argument,
 * values within the numeric tolerance; axis ranges by axis name; reference lines by axis and label.
 */
export function diffChart(
  baseline: ComparedStep[],
  candidate: ComparedStep[],
  policy: ComparisonPolicy,
): ComparisonDifference[] {
  return diffCheckpoints(baseline, candidate, 'chart', (a, b) => {
    const x = chartOf(a);
    const y = chartOf(b);
    const out: DifferenceAt[] = [];
    diffSeries(x.series, y.series, policy, out);

    const axesA = keyed(x.axes, (axis) => axis.name);
    const axesB = keyed(y.axes, (axis) => axis.name);
    for (const name of unionKeys(axesA, axesB)) {
      const l = axesA.get(name);
      const r = axesB.get(name);
      if (!l || !r) {
        out.push({ path: `axes[${name}]`, baseline: l ?? null, candidate: r ?? null });
        continue;
      }
      for (const end of ['min', 'max'] as const)
        if (!valuesMatch(l[end], r[end], policy))
          out.push({ path: `axes[${name}].${end}`, baseline: l[end], candidate: r[end] });
    }

    const linesA = keyed(x.lines, (line) => `${line.axis}:${line.label}`);
    const linesB = keyed(y.lines, (line) => `${line.axis}:${line.label}`);
    for (const key of unionKeys(linesA, linesB)) {
      const l = linesA.get(key);
      const r = linesB.get(key);
      if (l && r && valuesMatch(l.value, r.value, policy)) continue;
      out.push({ path: `lines[${key}]`, baseline: l?.value ?? null, candidate: r?.value ?? null });
    }
    return out;
  });
}

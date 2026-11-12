import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartCheckpointData } from '@shared/comparison';

/**
 * A chart checkpoint drawn twice on the same axes: each series of the baseline as a solid line,
 * the same series of the candidate dashed in the same colour, so a moved point stands out.
 *
 * What was captured is the chart's model, not its picture: a bar or pie series is drawn as a
 * line here too, which is what makes two models comparable point by point.
 */

const COLORS = [1, 2, 3, 4, 5].map((n) => `hsl(var(--chart-${n}))`);

const asChart = (value: unknown): ChartCheckpointData | null =>
  value && Array.isArray((value as ChartCheckpointData).series)
    ? (value as ChartCheckpointData)
    : null;

/** One row per x: `b<i>` the baseline's y of series i, `c<i>` the candidate's. */
export function overlayRows(
  baseline: ChartCheckpointData | null,
  candidate: ChartCheckpointData | null,
) {
  const names: string[] = [];
  for (const chart of [baseline, candidate])
    for (const series of chart?.series ?? [])
      if (!names.includes(series.name)) names.push(series.name);
  const rows = new Map<string, Record<string, string | number | null>>();
  const put = (chart: ChartCheckpointData | null, prefix: 'b' | 'c') => {
    for (const series of chart?.series ?? []) {
      const i = names.indexOf(series.name);
      for (const [x, y] of series.points) {
        const key = String(x);
        const row = rows.get(key) ?? { x: key };
        row[`${prefix}${i}`] = y;
        rows.set(key, row);
      }
    }
  };
  put(baseline, 'b');
  put(candidate, 'c');
  return { names, rows: [...rows.values()] };
}

export default function DiffChart({
  baseline,
  candidate,
}: {
  baseline: unknown;
  candidate: unknown;
}) {
  const { t } = useTranslation();
  const left = asChart(baseline);
  const right = asChart(candidate);
  const { names, rows } = overlayRows(left, right);
  if (rows.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        {t('comparisons.diff.noPoints', 'Neither side has a point to draw.')}
      </p>
    );
  const baselineLabel = t('comparisons.baseline', 'Baseline');
  const candidateLabel = t('comparisons.candidate', 'Candidate');
  return (
    <div className="h-72 w-full" data-testid="diff-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="x" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {names.flatMap((name, i) => [
            <Line
              key={`b${i}`}
              dataKey={`b${i}`}
              name={`${name} · ${baselineLabel}`}
              stroke={COLORS[i % COLORS.length]}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />,
            <Line
              key={`c${i}`}
              dataKey={`c${i}`}
              name={`${name} · ${candidateLabel}`}
              stroke={COLORS[i % COLORS.length]}
              strokeDasharray="5 4"
              dot={{ r: 2 }}
              isAnimationActive={false}
              connectNulls
            />,
          ])}
          {(right?.lines ?? left?.lines ?? []).map((line, i) => (
            <ReferenceLine
              key={`line${i}`}
              y={line.value}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="2 2"
              label={{ value: line.label, fontSize: 10 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

import React from 'react';
import { useTranslation } from 'react-i18next';
import { peakVus, totalDurationSec, type LoadStage } from '@shared/load-test';

/** The number of virtual users over time, as the stages ask for it; the warm-up shaded. */
export function LoadProfileChart({ stages, warmUpSec }: { stages: LoadStage[]; warmUpSec: number }) {
  const { t } = useTranslation();
  const total = totalDurationSec(stages);
  const peak = peakVus(stages);
  if (total === 0 || peak === 0) return null;
  const width = 600;
  const height = 120;
  const x = (sec: number) => (sec / total) * width;
  const y = (vus: number) => height - (vus / peak) * (height - 8);
  let elapsed = 0;
  const points = [`${x(0)},${y(0)}`];
  for (const stage of stages) {
    elapsed += stage.durationSec;
    points.push(`${x(elapsed)},${y(stage.targetVus)}`);
  }
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-28 w-full rounded border bg-muted/30"
      preserveAspectRatio="none"
      role="img"
      aria-label={t('loadTests.profileChart', 'Load profile: up to {{peak}} virtual users over {{total}} s', { peak, total })}
    >
      {warmUpSec > 0 && <rect x={0} y={0} width={x(Math.min(warmUpSec, total))} height={height} className="fill-muted" />}
      <polyline points={[...points, `${x(total)},${height}`, `${x(0)},${height}`].join(' ')} className="fill-primary/15 stroke-none" />
      <polyline points={points.join(' ')} fill="none" className="stroke-primary" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

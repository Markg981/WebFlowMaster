import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PERFORMANCE_LIMITS, type ApiPerformance } from '@shared/api-performance';

/**
 * An API test's performance check (shared/api-performance.ts): how many requests, how many at
 * once, and the thresholds a run fails on. Off, the test sends its request once.
 */

export const DEFAULT_PERFORMANCE: ApiPerformance = { iterations: 20, concurrency: 2, thresholds: { p95Ms: 1000, errorRatePct: 0 } };

type ThresholdKey = keyof ApiPerformance['thresholds'];

interface Props {
  value: ApiPerformance | null;
  onChange: (value: ApiPerformance | null) => void;
  disabled?: boolean;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

export function PerformanceEditor({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const setThreshold = (key: ThresholdKey, raw: string) => {
    if (!value) return;
    const thresholds = { ...value.thresholds };
    if (raw.trim() === '') delete thresholds[key];
    else thresholds[key] = key === 'errorRatePct' ? Math.min(100, Math.max(0, Number(raw))) : Math.max(1, Math.round(Number(raw)));
    onChange({ ...value, thresholds });
  };
  const thresholdFields: Array<{ key: ThresholdKey; label: string; unit: string }> = [
    { key: 'p50Ms', label: t('apiPerformance.p50', 'Median (p50)'), unit: 'ms' },
    { key: 'p95Ms', label: t('apiPerformance.p95', '95th percentile (p95)'), unit: 'ms' },
    { key: 'maxMs', label: t('apiPerformance.max', 'Slowest'), unit: 'ms' },
    { key: 'errorRatePct', label: t('apiPerformance.errorRate', 'Failed requests'), unit: '%' },
  ];

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={!!value} onCheckedChange={(on) => onChange(on ? DEFAULT_PERFORMANCE : null)} disabled={disabled} aria-label={t('apiPerformance.enable', 'Check response times over several requests')} />
        {t('apiPerformance.enable', 'Check response times over several requests')}
      </label>
      <p className="text-xs text-muted-foreground">
        {t(
          'apiPerformance.help',
          'In a plan, the request is sent again until the count is reached, a few at once, and the test fails when a threshold is exceeded. Captures come from the first request only. This measures an endpoint; it is not a load test.',
        )}
      </p>
      {value && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <div className="space-y-1">
              <Label htmlFor="perf-iterations">{t('apiPerformance.iterations', 'Requests')}</Label>
              <Input
                id="perf-iterations"
                type="number"
                min={2}
                max={PERFORMANCE_LIMITS.iterations}
                value={value.iterations}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, iterations: clamp(Number(e.target.value) || 2, 2, PERFORMANCE_LIMITS.iterations) })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="perf-concurrency">{t('apiPerformance.concurrency', 'At once')}</Label>
              <Input
                id="perf-concurrency"
                type="number"
                min={1}
                max={PERFORMANCE_LIMITS.concurrency}
                value={value.concurrency}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, concurrency: clamp(Number(e.target.value) || 1, 1, PERFORMANCE_LIMITS.concurrency) })}
              />
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{t('apiPerformance.thresholds', 'Fail the test when (leave empty for no limit)')}</p>
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              {thresholdFields.map(({ key, label, unit }) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`perf-${key}`}>
                    {label} &gt; ({unit})
                  </Label>
                  <Input id={`perf-${key}`} type="number" min={0} value={value.thresholds[key] ?? ''} disabled={disabled} onChange={(e) => setThreshold(key, e.target.value)} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

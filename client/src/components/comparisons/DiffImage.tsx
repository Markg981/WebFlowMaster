import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/**
 * Two screenshots of the same step: next to each other, or one over the other with a slider
 * that fades from the baseline to the candidate, which shows a shifted element better than
 * looking from one picture to the other.
 */
export default function DiffImage({
  baseline,
  candidate,
}: {
  baseline: string | null;
  candidate: string | null;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'side' | 'overlay'>('side');
  const [mix, setMix] = useState(50);
  const baselineLabel = t('comparisons.baseline', 'Baseline');
  const candidateLabel = t('comparisons.candidate', 'Candidate');
  const alt = (side: string) =>
    t('comparisons.report.screenshotOf', 'Screenshot on {{side}}', { side });
  const missing = (
    <p className="text-xs text-muted-foreground">
      {t('comparisons.report.noScreenshot', 'No screenshot you can open.')}
    </p>
  );
  const both = baseline !== null && candidate !== null;

  return (
    <div className="space-y-2" data-testid="diff-image">
      {both && (
        <ToggleGroup
          type="single"
          size="sm"
          value={view}
          onValueChange={(value) => value && setView(value as 'side' | 'overlay')}
          aria-label={t('comparisons.diff.imageView', 'How to show the screenshots')}
        >
          <ToggleGroupItem value="side">
            {t('comparisons.diff.sideBySide', 'Side by side')}
          </ToggleGroupItem>
          <ToggleGroupItem value="overlay">
            {t('comparisons.diff.overlay', 'Overlay')}
          </ToggleGroupItem>
        </ToggleGroup>
      )}
      {both && view === 'overlay' ? (
        <div className="space-y-2">
          <div className="relative inline-block border rounded">
            <img src={baseline} alt={alt(baselineLabel)} className="block max-h-96" />
            <img
              src={candidate}
              alt={alt(candidateLabel)}
              className="absolute inset-0 h-full w-full object-contain"
              style={{ opacity: mix / 100 }}
            />
          </div>
          <div className="flex items-center gap-2 text-xs max-w-sm">
            <span>{baselineLabel}</span>
            <Slider
              value={[mix]}
              min={0}
              max={100}
              step={1}
              onValueChange={([value]) => setMix(value)}
              aria-label={t('comparisons.diff.mix', 'Fade from baseline to candidate')}
            />
            <span>{candidateLabel}</span>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {[
            [baselineLabel, baseline],
            [candidateLabel, candidate],
          ].map(([label, src]) => (
            <div key={label} className="space-y-1">
              <div className="text-xs text-muted-foreground">{label}</div>
              {src ? (
                <a href={src} target="_blank" rel="noreferrer">
                  <img src={src} alt={alt(label as string)} className="max-h-64 border rounded" />
                </a>
              ) : (
                missing
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

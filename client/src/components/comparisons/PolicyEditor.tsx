import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ComparisonPolicySchema, type ComparisonPolicy } from '@shared/comparison';

/**
 * The tolerances of a comparison: how texts are normalised, how far numbers may drift, which
 * calls count, and whether screenshots and durations block a verdict or only inform it.
 *
 * Lists are edited one item per line; a replace rule is `pattern => replacement`, the pattern a
 * regular expression the engine applies to both sides before comparing.
 */

export const defaultPolicy = (): ComparisonPolicy => ComparisonPolicySchema.parse({});

type Mode = ComparisonPolicy['visual']['mode'];

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** `pattern => with` per line; a line without the arrow replaces with nothing. */
export function parseReplaceRules(text: string): ComparisonPolicy['text']['replace'] {
  return lines(text).map((line) => {
    const at = line.indexOf('=>');
    return at < 0
      ? { pattern: line, with: '' }
      : { pattern: line.slice(0, at).trim(), with: line.slice(at + 2).trim() };
  });
}

const formatReplaceRules = (rules: ComparisonPolicy['text']['replace']) =>
  rules.map((rule) => (rule.with ? `${rule.pattern} => ${rule.with}` : rule.pattern)).join('\n');

const number = (text: string, fallback: number) => {
  const value = Number(text);
  return text.trim() === '' || !Number.isFinite(value) || value < 0 ? fallback : value;
};

export default function PolicyEditor({
  value,
  onChange,
}: {
  value: ComparisonPolicy;
  onChange: (policy: ComparisonPolicy) => void;
}) {
  const { t } = useTranslation();
  // Lists are kept as typed so a half-written line is not reformatted under the cursor.
  const [replaceText, setReplaceText] = React.useState(() =>
    formatReplaceRules(value.text.replace),
  );
  const [includeText, setIncludeText] = React.useState(() => value.network.include.join('\n'));
  const [ignoreText, setIgnoreText] = React.useState(() =>
    value.network.ignoreQueryParams.join('\n'),
  );

  const set = <K extends keyof ComparisonPolicy>(key: K, part: Partial<ComparisonPolicy[K]>) =>
    onChange({ ...value, [key]: { ...value[key], ...part } });

  const switchRow = (
    id: string,
    label: string,
    checked: boolean,
    onToggle: (v: boolean) => void,
  ) => (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onToggle} />
    </div>
  );

  const modeSelect = (id: string, label: string, mode: Mode, onPick: (mode: Mode) => void) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={mode} onValueChange={(v) => onPick(v as Mode)}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">{t('comparisons.policy.modes.off', 'Not compared')}</SelectItem>
          <SelectItem value="informative">
            {t('comparisons.policy.modes.informative', 'Informative')}
          </SelectItem>
          <SelectItem value="blocking">
            {t('comparisons.policy.modes.blocking', 'Blocking')}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="policy-editor">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          {t('comparisons.policy.text', 'Texts and cells')}
        </legend>
        {switchRow(
          'policy-whitespace',
          t('comparisons.policy.collapseWhitespace', 'Treat runs of spaces as one'),
          value.text.collapseWhitespace,
          (v) => set('text', { collapseWhitespace: v }),
        )}
        {switchRow(
          'policy-case',
          t('comparisons.policy.ignoreCase', 'Ignore upper and lower case'),
          value.text.ignoreCase,
          (v) => set('text', { ignoreCase: v }),
        )}
        <div className="space-y-1">
          <Label htmlFor="policy-replace">
            {t('comparisons.policy.replace', 'Replace before comparing (one per line)')}
          </Label>
          <Textarea
            id="policy-replace"
            rows={2}
            value={replaceText}
            placeholder={t('comparisons.policy.replacePlaceholder', 'ORD-\\d+ => ORD-#')}
            onChange={(e) => {
              setReplaceText(e.target.value);
              set('text', { replace: parseReplaceRules(e.target.value).slice(0, 50) });
            }}
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-2 grid-cols-2">
        <legend className="text-sm font-medium col-span-2">
          {t('comparisons.policy.numeric', 'Numbers')}
        </legend>
        <div className="space-y-1">
          <Label htmlFor="policy-abs">
            {t('comparisons.policy.absTolerance', 'Absolute tolerance')}
          </Label>
          <Input
            id="policy-abs"
            type="number"
            min={0}
            step="any"
            value={value.numeric.absTolerance}
            onChange={(e) => set('numeric', { absTolerance: number(e.target.value, 0) })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="policy-rel">
            {t('comparisons.policy.relTolerance', 'Relative tolerance (%)')}
          </Label>
          <Input
            id="policy-rel"
            type="number"
            min={0}
            max={100}
            step="any"
            value={Math.round(value.numeric.relTolerance * 10_000) / 100}
            onChange={(e) =>
              set('numeric', { relTolerance: Math.min(1, number(e.target.value, 0) / 100) })
            }
          />
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('comparisons.policy.network', 'Calls')}</legend>
        <div className="space-y-1">
          <Label htmlFor="policy-include">
            {t('comparisons.policy.include', 'Compare the calls whose URL matches (one per line)')}
          </Label>
          <Textarea
            id="policy-include"
            rows={2}
            value={includeText}
            onChange={(e) => {
              setIncludeText(e.target.value);
              set('network', { include: lines(e.target.value).slice(0, 50) });
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="policy-ignore-query">
            {t('comparisons.policy.ignoreQueryParams', 'Query parameters to ignore (one per line)')}
          </Label>
          <Textarea
            id="policy-ignore-query"
            rows={2}
            value={ignoreText}
            placeholder="_ts"
            onChange={(e) => {
              setIgnoreText(e.target.value);
              set('network', { ignoreQueryParams: lines(e.target.value).slice(0, 50) });
            }}
          />
        </div>
        {switchRow(
          'policy-response-hash',
          t('comparisons.policy.compareResponseHash', 'Compare the response bodies too'),
          value.network.compareResponseHash,
          (v) => set('network', { compareResponseHash: v }),
        )}
      </fieldset>

      <fieldset className="grid gap-2 grid-cols-2">
        <legend className="text-sm font-medium col-span-2">
          {t('comparisons.policy.visualAndTime', 'Screenshots and durations')}
        </legend>
        {modeSelect(
          'policy-visual-mode',
          t('comparisons.policy.visualMode', 'Screenshots'),
          value.visual.mode,
          (mode) => set('visual', { mode }),
        )}
        <div className="space-y-1">
          <Label htmlFor="policy-visual-threshold">
            {t('comparisons.policy.visualThreshold', 'Changed pixels allowed (%)')}
          </Label>
          <Input
            id="policy-visual-threshold"
            type="number"
            min={0}
            max={100}
            step="any"
            disabled={value.visual.mode === 'off'}
            value={Math.round(value.visual.threshold * 10_000) / 100}
            onChange={(e) =>
              set('visual', { threshold: Math.min(1, number(e.target.value, 1) / 100) })
            }
          />
        </div>
        {modeSelect(
          'policy-performance-mode',
          t('comparisons.policy.performanceMode', 'Durations'),
          value.performance.mode,
          (mode) => set('performance', { mode }),
        )}
        <div className="space-y-1">
          <Label htmlFor="policy-slowdown">
            {t('comparisons.policy.maxSlowdownPct', 'Slowdown allowed (%)')}
          </Label>
          <Input
            id="policy-slowdown"
            type="number"
            min={0}
            max={10000}
            disabled={value.performance.mode === 'off'}
            value={value.performance.maxSlowdownPct}
            onChange={(e) =>
              set('performance', {
                maxSlowdownPct: Math.min(10_000, number(e.target.value, 20)),
              })
            }
          />
        </div>
      </fieldset>
    </div>
  );
}

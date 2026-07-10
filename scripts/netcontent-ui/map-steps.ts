import type { UiElement } from './parse-views';

// Intermediate, tool-internal step. Converted to the app's TestStep shape by the importer.
export interface MappedStep {
  action: 'click' | 'input' | 'select' | 'navigate' | 'assertion';
  selector?: string;
  label?: string;
  value?: string;
  assertType?: 'containsText';
  note?: string; // review hint when the mapping is uncertain
  rawStep: string;
}

// Split a "Steps/Description" cell into individual steps (numbered list or newlines).
export function splitSteps(stepsText: string): string[] {
  return (stepsText || '')
    .split(/\r?\n|(?=\s*\d+[.)]\s)/)
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter((s) => s.length > 0);
}

const norm = (s: string) =>
  (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Verbs/fillers dropped from a step phrase so the meaningful nouns drive the match.
// Only generic fillers and classifying verbs — NOT words that are also element labels
// (save, new, record, start, complete, add, submit…), which must stay for matching.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'into', 'with', 'from', 'that', 'this',
  'click', 'press', 'open', 'enter', 'input', 'type', 'set', 'fill', 'select', 'choose',
  'pick', 'verify', 'confirm', 'observe', 'ensure', 'should', 'will', 'must', 'navigate',
  'field', 'button', 'value', 'values', 'box', 'option', 'options', 'tab', 'page', 'screen',
  'view', 'modal', 'required', 'amount', 'number',
]);

function meaningful(phrase: string): string[] {
  return norm(phrase).split(' ').filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// Token-overlap score between the step phrase and an element's identifying text.
function scoreElement(phrase: string, el: UiElement): number {
  const words = meaningful(phrase);
  if (words.length === 0) return 0;
  const target = new Set(
    norm([el.label, el.name, el.ngModel, el.ngClick].filter(Boolean).join(' ')).split(' '),
  );
  let overlap = 0;
  for (const w of words) if (target.has(w)) overlap++;
  return overlap / words.length;
}

function bestMatch(phrase: string, elements: UiElement[], roles?: UiElement['role'][]): UiElement | null {
  let best: UiElement | null = null;
  let bestScore = 0;
  for (const el of elements) {
    if (roles && !roles.includes(el.role)) continue;
    const s = scoreElement(phrase, el);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  return bestScore >= 0.34 ? best : null;
}

const VERB = {
  input: /\b(enter|input|type|set|fill|provide|specify)\b/i,
  select: /\b(select|choose|pick)\b/i,
  navigate: /\b(navigate|go to)\b/i,
  assert: /\b(verify|confirm|observe|ensure|should|must|expected|displays?|shows?|will (have|be|show))\b/i,
};

function extractValue(step: string): string | undefined {
  const quoted = step.match(/["']([^"']+)["']/);
  if (quoted) return quoted[1];
  const asVal = step.match(/\b(?:as|to|=)\s+([A-Za-z0-9_.]+)/i);
  if (asVal) return asVal[1];
  const num = step.match(/\b(\d+(?:\.\d+)?)\b/);
  if (num) return num[1];
  return undefined;
}

export function mapStep(step: string, elements: UiElement[]): MappedStep {
  const s = step.trim();
  let action: MappedStep['action'];
  if (VERB.assert.test(s) && !VERB.input.test(s)) action = 'assertion';
  else if (VERB.input.test(s)) action = 'input';
  else if (VERB.select.test(s)) action = 'select';
  else if (VERB.navigate.test(s)) action = 'navigate';
  else action = 'click';

  if (action === 'assertion') {
    return {
      action: 'assertion',
      assertType: 'containsText',
      value: (extractValue(s) ?? s).slice(0, 80),
      rawStep: s,
      note: 'review: assertion inferred from text',
    };
  }
  if (action === 'navigate') {
    return { action: 'navigate', value: s, rawStep: s, note: 'review: map navigation to app route/menu' };
  }

  const roles =
    action === 'input' ? (['input', 'textarea'] as UiElement['role'][]) : action === 'select' ? (['select'] as UiElement['role'][]) : undefined;
  const el = bestMatch(s, elements, roles);
  if (!el) return { action, rawStep: s, note: 'unmatched: fill target manually' };
  return {
    action,
    selector: el.selector,
    label: el.label,
    value: action === 'input' ? extractValue(s) : undefined,
    rawStep: s,
  };
}

export function mapSteps(stepsText: string, elements: UiElement[]): MappedStep[] {
  return splitSteps(stepsText).map((s) => mapStep(s, elements));
}

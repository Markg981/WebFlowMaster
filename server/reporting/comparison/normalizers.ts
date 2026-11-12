import type { ComparisonPolicy } from '@shared/comparison';

/** A replace rule whose pattern is not a valid regular expression is skipped, not fatal. */
function compiled(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'g');
  } catch {
    return null;
  }
}

/** A text as the policy says to compare it: replace rules, then whitespace, then case. */
export function normalizeText(value: string, policy: ComparisonPolicy['text']): string {
  let text = value;
  for (const rule of policy.replace) {
    const regex = compiled(rule.pattern);
    if (regex) text = text.replace(regex, rule.with);
  }
  if (policy.collapseWhitespace) text = text.replace(/\s+/g, ' ').trim();
  if (policy.ignoreCase) text = text.toLocaleLowerCase();
  return text;
}

/**
 * The number a text states, or null when it is not only a number.
 *
 * Accepts a sign, thousands separators and either decimal mark, as an application shows them in
 * either locale: `1.234,5` and `1,234.5` both read as 1234.5. A trailing `%` is kept off.
 */
export function parseNumber(value: string): number | null {
  const text = value.trim().replace(/%$/, '').replace(/\s/g, '');
  if (!/^[-+]?[\d.,]*\d[\d.,]*$/.test(text)) return null;
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  const decimal = lastDot > lastComma ? '.' : ',';
  const other = decimal === '.' ? ',' : '.';
  let digits = text.split(other).join('');
  // A single separator followed by exactly three digits is a thousands separator: `1,234` or `1.234`.
  if (lastDot === -1 || lastComma === -1) {
    const parts = digits.split(decimal);
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) digits = parts.join('');
  }
  const n = Number(digits.replace(decimal, '.'));
  return Number.isFinite(n) ? n : null;
}

/** Two numbers equal within either tolerance of the policy. */
export function numbersMatch(a: number, b: number, policy: ComparisonPolicy['numeric']): boolean {
  if (a === b) return true;
  const delta = Math.abs(a - b);
  if (delta <= policy.absTolerance) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale > 0 && delta / scale <= policy.relTolerance;
}

/** Two texts the same under the policy; two numbers within its tolerance count as the same. */
export function textsMatch(a: string, b: string, policy: ComparisonPolicy): boolean {
  const left = normalizeText(a, policy.text);
  const right = normalizeText(b, policy.text);
  if (left === right) return true;
  const x = parseNumber(left);
  const y = parseNumber(right);
  return x !== null && y !== null && numbersMatch(x, y, policy.numeric);
}

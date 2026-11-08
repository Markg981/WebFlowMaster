import { guardedMatch, guardedTest } from './regex-guard';

/**
 * Compiles a regular expression written by a user (assertions, OTP patterns).
 *
 * V8 matches with backtracking, so a pattern such as `^(a+)+$` blocks the event loop for seconds
 * on a few dozen characters. Rather than running the match off-thread, the pattern is checked
 * before it is compiled: a length limit, a rejection of nested unbounded quantifiers (star
 * height above 1) and of repeated alternations whose branches start alike (`(a|aa)+`). Matching
 * itself runs under a time budget (regex-guard.ts), since static checks cannot be complete.
 * Throws an Error with a user-readable message.
 */
export const MAX_REGEX_LENGTH = 200;
export const MAX_REGEX_INPUT_LENGTH = 100_000;

/** Highest nesting of unbounded quantifiers ('*', '+', '{n,}') found in the pattern. */
function starHeight(source: string): number {
  const stack: number[] = [0]; // max star height inside each open group
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === '(') stack.push(0);
    else if (c === ')') {
      const inner = stack.pop() ?? 0;
      const quantified = /^(?:[*+]|\{\d+,\d*\})/.test(source.slice(i + 1));
      if (quantified && inner > 0) return inner + 1;
      const level = stack.length - 1;
      stack[level] = Math.max(stack[level], quantified ? inner + 1 : inner);
    } else if (c === '*' || c === '+') {
      stack[stack.length - 1] = Math.max(stack[stack.length - 1], 1);
    } else if (c === '{' && /^\{\d+,\d*\}/.test(source.slice(i))) {
      stack[stack.length - 1] = Math.max(stack[stack.length - 1], 1);
    }
  }
  return Math.max(...stack);
}

/** First token of an alternation branch: an escape, a character class or a single character. */
function firstAtom(branch: string): string {
  const m = /^(?:\\.|\[(?:\\.|[^\]\\])*\]|[\s\S])/.exec(branch);
  return m ? m[0] : '';
}

function atomsOverlap(a: string, b: string): boolean {
  if (a === '' || b === '' || a === b || a === '.' || b === '.') return true;
  if (a.startsWith('[') || b.startsWith('[')) return true; // sets are not compared
  // Two different literals never overlap; a class overlaps what it can match.
  const isWord = (x: string) => /^[A-Za-z0-9_]$/.test(x);
  const isDigit = (x: string) => /^[0-9]$/.test(x);
  const isSpace = (x: string) => x === ' ';
  const covers = (cls: string, other: string) =>
    cls === '\\w'
      ? isWord(other) || other === '\\d'
      : cls === '\\d'
        ? isDigit(other) || other === '\\w'
        : cls === '\\s' && (isSpace(other) || other === '\\s');
  return covers(a, b) || covers(b, a);
}

/** True when a quantified group has alternation branches that can begin with the same input. */
function hasOverlappingAlternation(source: string): boolean {
  const stack: number[][] = [];
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === '(') {
      const skip = /^\?(?::|=|!|<[=!])/.exec(source.slice(i + 1))?.[0].length ?? 0;
      stack.push([i + 1 + skip]);
    } else if (c === '|' && stack.length) stack[stack.length - 1].push(i + 1);
    else if (c === ')') {
      const starts = stack.pop();
      if (!starts || starts.length < 2) continue;
      if (!/^(?:[*+]|\{\d+,\d*\})/.test(source.slice(i + 1))) continue;
      const atoms = starts.map((b) => firstAtom(source.slice(b, i)));
      for (let x = 0; x < atoms.length; x++)
        for (let y = x + 1; y < atoms.length; y++)
          if (atomsOverlap(atoms[x], atoms[y])) return true;
    }
  }
  return false;
}

export function compileSafeRegex(source: string, flags?: string): RegExp {
  if (source.length > MAX_REGEX_LENGTH) {
    throw new Error(`the pattern is longer than ${MAX_REGEX_LENGTH} characters`);
  }
  if (starHeight(source) > 1) {
    throw new Error(
      'the pattern repeats a repeated group (for example "(a+)+"), which can take forever to match; simplify it',
    );
  }
  if (hasOverlappingAlternation(source)) {
    throw new Error(
      'the pattern repeats an alternation whose branches start alike (for example "(a|aa)+"), which can take forever to match; simplify it',
    );
  }
  return new RegExp(source, flags);
}

function capInput(text: string): string {
  return text.length > MAX_REGEX_INPUT_LENGTH ? text.slice(0, MAX_REGEX_INPUT_LENGTH) : text;
}

/**
 * Tests `text` against a user pattern; the text is capped and the match runs under a time
 * budget. Throws RegexTimeoutError ("regex timed out after 100 ms") when it takes too long.
 */
export function safeRegexTest(re: RegExp, text: string): boolean {
  return guardedTest(re.source, re.flags, capInput(text));
}

/** Like String.match for a non-global pattern, under the same time budget. */
export function safeRegexMatch(re: RegExp, text: string): (string | undefined)[] | null {
  return guardedMatch(re.source, re.flags.replace(/[gy]/g, ''), capInput(text))?.groups ?? null;
}

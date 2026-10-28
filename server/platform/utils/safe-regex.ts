/**
 * Compiles a regular expression written by a user (assertions, OTP patterns).
 *
 * V8 matches with backtracking, so a pattern such as `^(a+)+$` blocks the event loop for seconds
 * on a few dozen characters. Rather than running the match off-thread, the pattern is checked
 * before it is compiled: a length limit and a rejection of nested unbounded quantifiers (star
 * height above 1), the shape of the catastrophic ones. Throws an Error with a user-readable message.
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

export function compileSafeRegex(source: string, flags?: string): RegExp {
  if (source.length > MAX_REGEX_LENGTH) {
    throw new Error(`the pattern is longer than ${MAX_REGEX_LENGTH} characters`);
  }
  if (starHeight(source) > 1) {
    throw new Error(
      'the pattern repeats a repeated group (for example "(a+)+"), which can take forever to match; simplify it',
    );
  }
  return new RegExp(source, flags);
}

/** Tests `text` against a user pattern; the text is capped so the match stays bounded. */
export function safeRegexTest(re: RegExp, text: string): boolean {
  return re.test(
    text.length > MAX_REGEX_INPUT_LENGTH ? text.slice(0, MAX_REGEX_INPUT_LENGTH) : text,
  );
}

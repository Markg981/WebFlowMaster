import { randomInt, randomUUID } from 'crypto';

/**
 * Values made up at run time: `{{$randomEmail}}`, `{{$randomInt(1,100)}}`, `{{$today(+7)}}`.
 *
 * A test that registers a user cannot type the same address twice — the second run is refused
 * as a duplicate and fails for a reason that has nothing to do with what it checks. Written as
 * a placeholder so they go wherever `{{name}}` already goes (a typed value, a URL, an API
 * body) with no field of their own. The `$` keeps them apart from variable names, which cannot
 * start with one, so no environment can shadow a generator by accident.
 *
 * Each placeholder is a fresh value. To use the same one twice, `setVariable` it first.
 */

export const GENERATOR_PATTERN = /\{\{\s*\$(\w+)(?:\(([^)]*)\))?\s*\}\}/g;

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ALPHANUMERIC = `${LETTERS}0123456789`;

function randomFrom(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** A whole number argument, or the default when the argument is absent. */
function intArg(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  return Number.isInteger(value) ? value : null;
}

/** yyyy-mm-dd, in UTC — the same date whichever worker the run lands on. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type Generator = (args: string[]) => string | null;

const GENERATORS: Record<string, Generator> = {
  uuid: () => randomUUID(),
  timestamp: () => String(Date.now()),
  now: () => new Date().toISOString(),
  // $today, or $today(+7) / $today(-1) for a date that many days away.
  today: ([offset]) => {
    const days = intArg(offset, 0);
    if (days === null) return null;
    return isoDate(new Date(Date.now() + days * 86_400_000));
  },
  randomInt: ([min, max]) => {
    const low = intArg(min, 0);
    const high = intArg(max, 1000);
    if (low === null || high === null || high < low) return null;
    return String(randomInt(low, high + 1));
  },
  randomDigits: ([length]) => {
    const n = intArg(length, 6);
    if (n === null || n < 1 || n > 64) return null;
    return randomFrom('0123456789', n);
  },
  randomString: ([length]) => {
    const n = intArg(length, 8);
    if (n === null || n < 1 || n > 256) return null;
    return randomFrom(ALPHANUMERIC, n);
  },
  // Under example.com, which is reserved and delivers nowhere: a test must not mail strangers.
  randomEmail: () => `test.${randomFrom(ALPHANUMERIC, 10)}@example.com`,
};

export const GENERATOR_NAMES = Object.keys(GENERATORS);

/** The generated value, or null when the name is unknown or its arguments do not fit. */
export function generate(name: string, rawArgs?: string): string | null {
  const generator = GENERATORS[name];
  if (!generator) return null;
  const args = rawArgs === undefined ? [] : rawArgs.split(',');
  return generator(args);
}

/** Replaces every generator placeholder it can; one it cannot is left as written. */
export function substituteGenerators(value: string): string {
  return value.replace(GENERATOR_PATTERN, (match, name: string, args?: string) => generate(name, args) ?? match);
}

/** The generator placeholders in a string that would stay as written, for the error message. */
export function findInvalidGenerators(value: string): string[] {
  const invalid = new Set<string>();
  for (const match of value.matchAll(GENERATOR_PATTERN)) {
    if (generate(match[1], match[2]) === null) invalid.add(match[0].replace(/^\{\{\s*|\s*\}\}$/g, ''));
  }
  return [...invalid];
}

import winston from 'winston';

/**
 * PII / Secret Redactor for Winston
 * 
 * Automatically masks sensitive fields (passwords, tokens, API keys, etc.)
 * before they are written to any log transport. This is critical for
 * compliance and to prevent accidental secret leakage, especially given
 * the decryptSecret() flow used during test plan execution.
 */

const SENSITIVE_KEYS = /^(password|passwd|secret|token|authorization|cookie|apikey|api_key|encryptedvalue|iv|authtag|credit_?card|ssn|session_?id|x-api-key)$/i;

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

/**
 * Recursively redact sensitive fields from an object.
 */
function redactValue(obj: any, depth: number = 0): any {
  if (depth > MAX_DEPTH || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => redactValue(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const redacted: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.test(key)) {
        redacted[key] = REDACTED;
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = redactValue(value, depth + 1);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  return obj;
}

/**
 * Winston format that redacts sensitive data from log metadata.
 * Add this to the format chain BEFORE the final serializer (json/printf).
 */
export const redactSensitiveData = winston.format((info) => {
  // Redact all metadata fields (everything except level, message, timestamp)
  const { level, message, timestamp, ...metadata } = info;
  const redactedMeta = redactValue(metadata);
  return { level, message, timestamp, ...redactedMeta } as winston.Logform.TransformableInfo;
});

/**
 * Redacts an arbitrary object with the same rules the winston format uses.
 * Exported so incident triggers go through one implementation, not a second copy.
 */
export function redactObject(value: unknown): unknown {
  return redactValue(value, 0);
}

// Derived from SENSITIVE_KEYS (stripping the `^(` / `)$` anchors) so the free-text scrubber
// below can never drift into a second, divergent list of sensitive key names.
const SENSITIVE_KEY_ALTERNATION = SENSITIVE_KEYS.source.replace(/^\^\(/, '').replace(/\)\$$/, '');

/** Matches `key: value` / `key=value` where key is one of SENSITIVE_KEYS, capturing the key
 * and separator so the replacement can keep them and only blank the value. */
const KEY_VALUE_PATTERN = new RegExp(
  `\\b(${SENSITIVE_KEY_ALTERNATION})(\\s*[:=]\\s*)("[^"]*"|'[^']*'|\\S+)`,
  'gi',
);

/** Bearer tokens don't have a "key" at all, but the scheme name is a reliable enough marker. */
const BEARER_TOKEN_PATTERN = /\bBearer\s+\S+/gi;

/**
 * Scrubs secrets out of free text — an error message, a title — that redactObject cannot
 * reach because there is no object key to match against, only prose.
 *
 * This is deliberately narrow and covers exactly two shapes: an explicit `key: value` /
 * `key=value` pair naming a sensitive key, and a bearer token. A secret embedded in prose
 * with no key at all (e.g. "the value is hunter2") is indistinguishable from any other word
 * and is NOT caught here — there is no general fix for that short of not logging free text.
 */
export function redactString(value: string): string {
  if (!value) return value;
  // Bearer first, and the order is load-bearing. Run the other way round, the key/value
  // pattern treats the bare word "Bearer" as the value of the preceding sensitive key —
  // "Authorization: Bearer abc.def" became "Authorization: [REDACTED] abc.def", consuming
  // the word that BEARER_TOKEN_PATTERN needed to match and leaving the real token in clear.
  return value
    .replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED}`)
    .replace(KEY_VALUE_PATTERN, (_match, key: string, sep: string) => `${key}${sep}${REDACTED}`);
}

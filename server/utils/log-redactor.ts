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

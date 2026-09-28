import { isSensitiveKey, redactString } from './utils/log-redactor';

/**
 * What the API tester's history may keep of an exchange.
 *
 * The tester resolves `{{variables}}` on the server, so the request the history is given
 * still names them — but the response is whatever the far end sent back, and an endpoint
 * that echoes a token (httpbin's `/bearer`, a login returning `access_token`) put that
 * token in clear into a table every member of the organization can list. Two passes:
 *
 * 1. Every value of the selected environment goes back to its `{{name}}`. Environment
 *    values live in the encrypted secrets table; the history is not encrypted, so none of
 *    them may land there, whatever key they happen to be under.
 * 2. The fields the log redactor already treats as sensitive (`token`, `authorization`,
 *    `cookie`, …) are blanked, which catches credentials the environment never held, such
 *    as a token a login endpoint has just issued. A value that is nothing but a placeholder
 *    (`Bearer {{token}}`) is kept: it reveals nothing, and blanking it would stop the entry
 *    from being replayed.
 */

/** Below this, a value is too likely to occur by accident ("1", "yes") to be replaced. */
const MIN_SECRET_LENGTH = 4;

/** Headers that carry a credential under a name the log redactor does not list. */
const SENSITIVE_HEADERS = /^(set-cookie|proxy-authorization|x-auth-token|x-csrf-token)$/i;

/** `{{token}}`, `Bearer {{token}}`, `Basic {{credentials}}`: a reference, not a value. */
const PURE_PLACEHOLDER = /^\s*(?:(?:Bearer|Basic|Token)\s+)?\{\{\s*[\w.]+\s*\}\}\s*$/i;

const REDACTED = '[REDACTED]';

export interface HistoryFields {
  url?: string;
  queryParams?: unknown;
  requestHeaders?: unknown;
  requestBody?: string | null;
  responseHeaders?: unknown;
  responseBody?: string | null;
}

type Secrets = Array<[name: string, value: string]>;

/** Longest first, so a value that contains another is replaced whole. */
function secretList(values: Record<string, string>): Secrets {
  return Object.entries(values)
    .filter(([, value]) => typeof value === 'string' && value.length >= MIN_SECRET_LENGTH)
    .sort(([, a], [, b]) => b.length - a.length);
}

function maskString(value: string, secrets: Secrets): string {
  let out = value;
  for (const [name, secret] of secrets) {
    if (out.includes(secret)) out = out.split(secret).join(`{{${name}}}`);
  }
  return out;
}

function redactStructured(value: unknown, secrets: Secrets, depth = 0): unknown {
  if (typeof value === 'string') return maskString(value, secrets);
  // Deeper than any real header map or response is nested; past it, keep nothing rather
  // than something unchecked.
  if (depth > 32) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactStructured(item, secrets, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const masked = redactStructured(item, secrets, depth + 1);
      const sensitive = isSensitiveKey(key) || SENSITIVE_HEADERS.test(key);
      out[key] = !sensitive || masked === null || masked === undefined
        || (typeof masked === 'string' && PURE_PLACEHOLDER.test(masked))
        ? masked
        : REDACTED;
    }
    return out;
  }
  return value;
}

/**
 * A body is stored as text, but is usually JSON: redacted by key when it parses, as free
 * text when it does not. Left byte-for-byte as sent when nothing in it needed hiding.
 */
function redactBody(body: string | null | undefined, secrets: Secrets): string | null | undefined {
  if (typeof body !== 'string' || body === '') return body;
  try {
    const parsed = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object') {
      const redacted = redactStructured(parsed, secrets);
      return JSON.stringify(redacted) === JSON.stringify(parsed) ? body : JSON.stringify(redacted);
    }
  } catch {
    // Not JSON: fall through to the text rules.
  }
  return redactString(maskString(body, secrets));
}

export function redactHistoryEntry<T extends HistoryFields>(
  entry: T,
  environmentValues: Record<string, string>,
): T {
  const secrets = secretList(environmentValues);
  return {
    ...entry,
    ...(entry.url !== undefined && { url: maskString(entry.url, secrets) }),
    ...('queryParams' in entry && { queryParams: redactStructured(entry.queryParams, secrets) }),
    ...('requestHeaders' in entry && { requestHeaders: redactStructured(entry.requestHeaders, secrets) }),
    ...('requestBody' in entry && { requestBody: redactBody(entry.requestBody, secrets) }),
    ...('responseHeaders' in entry && { responseHeaders: redactStructured(entry.responseHeaders, secrets) }),
    ...('responseBody' in entry && { responseBody: redactBody(entry.responseBody, secrets) }),
  };
}

import { Agent } from 'undici';

/**
 * Outbound HTTP for the systems under test (DMO and friends).
 *
 * Two concerns live here because both apply to every outbound call, whichever
 * runner makes it: resolving `{{variables}}` in URLs, and deciding whether a
 * host is allowed to present a certificate Node would otherwise reject.
 */

const DEFAULT_BASE_URL = 'http://localhost:7000';

/** Variables available to saved tests, e.g. `{{baseUrl}}/api/NetContent/GetEquipment`. */
export function requestVariables(): Record<string, string> {
  return { baseUrl: process.env.DMO_BASE_URL || DEFAULT_BASE_URL };
}

/**
 * Replaces `{{name}}` placeholders. Unknown names are left untouched rather than
 * blanked, so a typo surfaces as an obviously wrong URL instead of a silently
 * mangled one.
 */
export function substituteVariables(value: string, vars: Record<string, string> = requestVariables()): string {
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => (key in vars ? vars[key] : match));
}

/** Applies substitution to every string value of a record, leaving keys alone. */
export function substituteInValues<T extends Record<string, string | string[]>>(
  record: T | undefined | null,
  vars: Record<string, string> = requestVariables(),
): T | undefined | null {
  if (!record) return record;
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = Array.isArray(value) ? value.map((v) => substituteVariables(v, vars)) : substituteVariables(value, vars);
  }
  return out as T;
}

/**
 * Hosts whose TLS certificate is not verified, from INSECURE_TLS_HOSTS
 * (comma-separated `host:port`, e.g. "localhost:7000,dev.internal:8443").
 *
 * Development systems commonly serve https with a self-signed certificate, which
 * Node rejects outright (DEPTH_ZERO_SELF_SIGNED_CERT) before any request is sent.
 * The exemption is deliberately per-host and opt-in: it never disables
 * certificate verification globally, and it is ignored in production, where an
 * untrusted certificate is a real signal rather than a dev-setup annoyance.
 */
function insecureHosts(): Set<string> {
  return new Set(
    (process.env.INSECURE_TLS_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function allowsSelfSignedCertificate(url: string): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  return insecureHosts().has(host);
}

let insecureAgent: Agent | undefined;

/** The dispatcher to use for a target URL, or undefined for normal verification. */
export function dispatcherFor(url: string): Agent | undefined {
  if (!allowsSelfSignedCertificate(url)) return undefined;
  insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureAgent;
}

/** fetch() for systems under test: same contract, plus the per-host TLS exemption. */
export const fetchTarget: typeof fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const dispatcher = dispatcherFor(url);
  // `dispatcher` is an undici extension to RequestInit that Node's fetch honours
  // but the DOM typings don't describe.
  return fetch(input, dispatcher ? ({ ...init, dispatcher } as RequestInit) : init);
};

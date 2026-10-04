import type { ApiRunResult } from './api-test-runner';
import { redactHistoryEntry } from './history-redaction';
import { isSensitiveKey } from './utils/log-redactor';

/** Keep live captures for the next request, but persist only redacted protocol evidence. */
export function protocolReport(result: ApiRunResult, variables: Record<string, string>) {
  const captures =
    result.body && typeof result.body === 'object'
      ? (result.body as { captures?: Record<string, unknown> }).captures
      : undefined;
  const normalizedCaptures = Object.fromEntries(
    Object.entries(captures ?? {}).map(([name, value]) => {
      if (
        typeof value === 'string' &&
        (value.trimStart().startsWith('{') || value.trimStart().startsWith('['))
      ) {
        try {
          return [name, JSON.parse(value)];
        } catch {
          // Plain captures remain strings; live execution values are never changed.
        }
      }
      return [name, value];
    }),
  );
  const body = captures
    ? { ...(result.body as Record<string, unknown>), captures: normalizedCaptures }
    : result.body;
  const capturedSecrets: Record<string, string> = {};
  let secretCount = 0;
  function collectSecrets(value: unknown, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 32) return;
    for (const [name, child] of Object.entries(value)) {
      if (isSensitiveKey(name) && typeof child === 'string' && child) {
        capturedSecrets[`_protocol_secret_${secretCount++}`] = child;
      } else {
        collectSecrets(child, depth + 1);
      }
    }
  }
  collectSecrets(body);
  const evidence = {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
    body,
    extracted: result.extracted,
    error: result.error,
  };
  return JSON.parse(
    redactHistoryEntry(
      { responseBody: JSON.stringify(evidence) },
      { ...variables, ...capturedSecrets },
    ).responseBody!,
  ) as typeof evidence;
}

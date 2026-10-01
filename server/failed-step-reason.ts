/**
 * A failed UI test comes back with its error on the step that failed, not on the result: without
 * this the report said "No reason provided" and test management published a bare "Failed".
 */
export function failedStepReason(status: string | undefined, steps: unknown): string | undefined {
  if (status !== 'failed' && status !== 'error') return undefined;
  if (!Array.isArray(steps)) return undefined;
  const failed = steps.find((s: any) => s && /fail|error/i.test(String(s.status ?? ''))) as any;
  const reason = failed?.error ?? failed?.details;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : undefined;
}

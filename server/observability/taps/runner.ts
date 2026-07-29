import { getCorrelationId } from '../../middleware/correlation';
import { recordIncident } from '../incident';

/**
 * Reports an infrastructure failure of the test runner — a browser that will not launch,
 * a dead recording session, an unreachable precondition.
 *
 * Deliberately NOT called for a UI test that fails its assertions: that is a normal
 * product outcome, and recording it would bury the real defects under thousands of
 * artifacts describing tests doing exactly what they are supposed to do.
 *
 * Fire-and-forget, so a runner already in trouble is not additionally delayed by disk I/O.
 */
export function recordRunnerFailure(input: {
  phase: string;
  error: unknown;
  context: Record<string, unknown>;
  correlationId?: string;
  userId?: number;
}): void {
  // The correlation id must be read HERE, not inside the deferred callback: it lives in
  // AsyncLocalStorage, and by the time a microtask runs the request context may be gone.
  const correlationId = input.correlationId ?? getCorrelationId();
  const error = input.error instanceof Error ? input.error : new Error(String(input.error));
  const trigger = { phase: input.phase, ...input.context };

  // Deferred, because `recordIncident` is only async after its first await — its body runs
  // synchronously until then, and that stretch collects state. Calling it directly would
  // block the caller, which defeats the point of a fire-and-forget report from a runner
  // that is already failing.
  queueMicrotask(() => {
    void recordIncident({
      kind: 'runner',
      error,
      trigger,
      correlationId,
      userId: input.userId,
    }).catch((failure) => {
      // Never through the logger: it may be what is broken.
      console.error('[observability] failed to record runner failure:', failure);
    });
  });
}

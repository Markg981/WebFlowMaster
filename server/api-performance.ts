import { summarise, type ApiPerformance, type PerformanceSummary } from '@shared/api-performance';
import { runApiRequest, type ApiRequestSpec, type ApiRunResult, type OneConnectionFetch } from './api-test-runner';

/**
 * The performance check of an API test (shared/api-performance.ts): after the functional request,
 * the same request again until `iterations` are done, `concurrency` at a time, through the same
 * transport — a local agent's network when the plan runs on one.
 *
 * Captures are taken from the functional request only: the repetitions measure, they do not
 * change what later tests in the plan receive.
 */

function failureOf(result: ApiRunResult): string | null {
  if (result.error) return result.error;
  const failed = result.assertions.find((a) => !a.pass);
  if (!failed) return null;
  const { source, property, comparison, targetValue } = failed.assertion;
  return `${source}${property ? ` "${property}"` : ''} ${comparison} "${targetValue ?? ''}" — actual: ${JSON.stringify(failed.actualValue)}`;
}

export async function runPerformance(
  spec: ApiRequestSpec,
  vars: Record<string, string>,
  settings: ApiPerformance,
  first: ApiRunResult,
  fetchImpl?: OneConnectionFetch,
  /** Stops the remaining requests: the run was cancelled or ran out of time. */
  shouldStop: () => boolean = () => false,
): Promise<PerformanceSummary> {
  const samples: Array<{ durationMs: number; error: string | null }> = [{ durationMs: first.durationMs, error: failureOf(first) }];
  let remaining = settings.iterations - 1;
  const worker = async () => {
    while (remaining > 0 && !shouldStop()) {
      remaining -= 1;
      const result = await runApiRequest(spec, vars, fetchImpl);
      samples.push({ durationMs: result.durationMs, error: failureOf(result) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(settings.concurrency, settings.iterations - 1) }, worker));
  return summarise(samples, settings);
}

/**
 * Every state a run can be in, and the only words the server uses for them.
 *
 * Kept apart from shared/schema.ts so the client can import it without pulling the database
 * layer into the bundle: the report page, the reports list and the CLI all have to agree with
 * the server on which of these mean "still going", and a copy of the list in each of them is how
 * `queued` would have been missing from one.
 *
 * `queued` replaced `pending`, which meant two things: a run waiting for a worker, and a test row
 * the execution page has not reached yet. Only the first is a state of the run.
 *
 * Which state may follow which lives in server/execution-state.ts.
 */
export const EXECUTION_STATUSES = [
  'queued', 'running', 'completed', 'failed', 'error',
  'cancelling', 'cancelled', 'timed_out',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** A run in one of these has not finished, so a client polling it should keep polling. */
export const IN_FLIGHT_EXECUTION_STATUSES: readonly string[] = ['queued', 'running', 'cancelling'];

/**
 * Whether a run is still going.
 *
 * `pending` is accepted as well, deliberately: it is what an API client written against the
 * previous version still expects, and what a row in a database that has not run migration 0021
 * still says. Treating it as finished would make such a client stop polling a run that has not
 * started — which in CI means a pipeline reporting before the tests have run.
 */
export function isExecutionInFlight(status: string | null | undefined): boolean {
  if (!status) return false;
  return status === 'pending' || IN_FLIGHT_EXECUTION_STATUSES.includes(status);
}

export type ExecutionTrigger = 'manual' | 'scheduled' | 'webhook' | 'api';

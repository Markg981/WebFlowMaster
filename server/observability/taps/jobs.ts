import { getCorrelationId } from '../../middleware/correlation';
import { recordIncident } from '../incident';

interface JobLike {
  id?: string | number;
  name: string;
  data: unknown;
  attemptsMade?: number;
}

/**
 * Wraps a BullMQ handler so a failure produces an incident and still propagates.
 *
 * Rethrowing is not optional: swallowing the error here would make BullMQ mark the job
 * successful, so a broken job would silently never retry and never surface.
 */
export function withJobIncidents<T extends JobLike, R = void>(
  handler: (job: T, token?: string) => Promise<R>,
): (job: T, token?: string) => Promise<R> {
  return async (job: T, token?: string) => {
    try {
      // Returned, not only awaited: a job's return value is its answer to whoever waits on it.
      return await handler(job, token);
    } catch (error) {
      // BullMQ's way of saying "put this back for later", thrown on purpose — a run deferred
      // because its organization is at its limit. Not a failure, so not an incident.
      if ((error as { name?: string } | null)?.name === 'DelayedError') throw error;
      await recordIncident({
        kind: 'job',
        error: error instanceof Error ? error : new Error(String(error)),
        trigger: {
          jobId: job.id,
          jobName: job.name,
          jobData: job.data,
          attemptsMade: job.attemptsMade,
        },
        correlationId: getCorrelationId(),
      });
      throw error;
    }
  };
}

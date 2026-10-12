/**
 * What the jobs on the test execution queue carry, checked where the worker takes them.
 *
 * A payload comes out of Redis, written by whichever version of the web process queued it, so
 * the worker reads it as untrusted input: a job that does not match fails with a message naming
 * the field, instead of running with an undefined plan id. Unknown fields are kept (the trace
 * context, marks such as deferredForQuota) because the worker writes the payload back.
 */
import { z } from 'zod';

const userId = z.number().int().nullable();

export const ExecutePlanJobSchema = z
  .object({
    // `executionId` from the orchestrator; `testPlanRunId` from jobs queued before it.
    executionId: z.string().min(1).optional(),
    testPlanRunId: z.string().min(1).optional(),
    planId: z.string().min(1),
    userId,
    updateBaselines: z.boolean().optional(),
    correlationId: z.string().optional(),
    deferredForQuota: z.boolean().optional(),
  })
  .passthrough()
  .refine((job) => job.executionId || job.testPlanRunId, {
    message: 'executionId or testPlanRunId is required',
  });
export type ExecutePlanJob = z.infer<typeof ExecutePlanJobSchema>;

export const ShardJobSchema = z
  .object({
    executionId: z.string().min(1),
    planId: z.string().min(1),
    userId,
    shard: z.coerce.number().int().nonnegative(),
    updateBaselines: z.boolean().optional(),
  })
  .passthrough();

export const TriggerScheduleJobSchema = z.object({ scheduleId: z.string().min(1) }).passthrough();

/** The payload read through its schema; throws an error naming the job and the bad fields. */
export function readJob<T extends z.ZodTypeAny>(
  schema: T,
  job: { id?: string; name: string; data: unknown },
): z.infer<T> {
  const parsed = schema.safeParse(job.data);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(payload)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Job ${job.id ?? '?'} (${job.name}) has an invalid payload: ${fields}`);
}

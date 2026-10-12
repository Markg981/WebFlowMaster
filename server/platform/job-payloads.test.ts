import { describe, expect, it } from 'vitest';
import {
  ExecutePlanJobSchema,
  ShardJobSchema,
  TriggerScheduleJobSchema,
  readJob,
} from './job-payloads';
import { ClientSocketMessageSchema } from '@shared/live-socket';

describe('job payloads', () => {
  it('reads the payload the orchestrator queues, keeping fields it does not know', () => {
    const data = {
      executionId: 'e-1',
      testPlanRunId: 'e-1',
      planId: 'p-1',
      userId: null,
      updateBaselines: false,
      correlationId: 'c',
      traceContext: { traceparent: 'x' },
    };
    expect(readJob(ExecutePlanJobSchema, { id: '1', name: 'execute-plan', data })).toEqual(data);
  });

  it('reads a payload queued before executionId existed', () => {
    const job = readJob(ExecutePlanJobSchema, {
      name: 'execute-plan',
      data: { testPlanRunId: 'e-1', planId: 'p-1', userId: 4 },
    });
    expect(job.executionId ?? job.testPlanRunId).toBe('e-1');
  });

  it('fails a job without a run id or plan id, naming what is missing', () => {
    expect(() =>
      readJob(ExecutePlanJobSchema, { id: '7', name: 'execute-plan', data: { userId: 1 } }),
    ).toThrow(/Job 7 \(execute-plan\) has an invalid payload: planId/);
    expect(() =>
      readJob(ExecutePlanJobSchema, { name: 'execute-plan', data: { planId: 'p', userId: 1 } }),
    ).toThrow(/executionId or testPlanRunId is required/);
  });

  it('reads shard numbers sent as strings and schedule triggers', () => {
    expect(
      readJob(ShardJobSchema, {
        name: 'execute-shard',
        data: { executionId: 'e', planId: 'p', userId: 1, shard: '2' },
      }).shard,
    ).toBe(2);
    expect(
      readJob(TriggerScheduleJobSchema, { name: 'trigger-schedule', data: { scheduleId: 's' } }),
    ).toEqual({ scheduleId: 's' });
    expect(() => readJob(TriggerScheduleJobSchema, { name: 't', data: null })).toThrow(/payload/);
  });
});

describe('live socket messages from the browser', () => {
  it('accepts subscribe and unsubscribe, with string or numeric ids', () => {
    expect(
      ClientSocketMessageSchema.parse({ type: 'subscribe-execution', executionId: 'abc' }),
    ).toEqual({ type: 'subscribe-execution', executionId: 'abc' });
    expect(
      ClientSocketMessageSchema.parse({ type: 'unsubscribe-execution', executionId: 12 }),
    ).toEqual({ type: 'unsubscribe-execution', executionId: '12' });
  });

  it('refuses anything else', () => {
    for (const message of [
      null,
      'subscribe-execution',
      { type: 'subscribe-execution' },
      { type: 'subscribe-execution', executionId: '' },
      { type: 'subscribe-execution', executionId: { $ne: null } },
      { type: 'drop-everything', executionId: 'a' },
    ])
      expect(ClientSocketMessageSchema.safeParse(message).success).toBe(false);
  });
});

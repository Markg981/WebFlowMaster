import { describe, expect, it, vi } from 'vitest';
import { inlinePlanRunsEnabled, processInlineJob } from './inline-plan-runs';

describe('inlinePlanRunsEnabled', () => {
  it('is off unless RUNS_INLINE=true, so production keeps its separate worker', () => {
    expect(inlinePlanRunsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(inlinePlanRunsEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(inlinePlanRunsEnabled({ RUNS_INLINE: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(inlinePlanRunsEnabled({ RUNS_INLINE: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('processInlineJob', () => {
  const job = (name: string, data: Record<string, unknown>) => ({ id: '1', name, data }) as any;

  it('runs an execute-plan job through processTestPlanJob with the run id and baseline flag', async () => {
    const processPlan = vi.fn().mockResolvedValue(undefined);
    await processInlineJob(
      job('execute-plan', {
        planId: 'p1',
        userId: 'u1',
        executionId: 'e1234567890',
        updateBaselines: true,
      }),
      undefined,
      { processPlan },
    );
    expect(processPlan).toHaveBeenCalledWith('p1', 'e1234567890', 'u1', { updateBaselines: true });
  });

  it('refuses a job it cannot run, instead of completing it silently', async () => {
    const processPlan = vi.fn();
    await expect(
      processInlineJob(job('trigger-schedule', {}), undefined, { processPlan }),
    ).rejects.toThrow(/RUNS_INLINE/);
    expect(processPlan).not.toHaveBeenCalled();
  });
});

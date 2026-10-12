import { describe, it, expect, vi } from 'vitest';

/**
 * runTestPlan is the one place every "start a run" request goes through — the Run button, a
 * webhook, the CLI — and whatever it returns in `error` is what the route hands back. These
 * hold that a failure the orchestrator classified keeps its words and status, and that one it
 * did not is logged in full and answered in general terms.
 */

const enqueue = vi.fn();
const logError = vi.fn();

vi.mock('./queue', () => ({ TEST_EXECUTION_QUEUE_NAME: 'test-queue', testExecutionQueue: {} }));
vi.mock('./playwright-service', () => ({ playwrightService: {} }));
vi.mock('./execution-orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./execution-orchestrator')>();
  return {
    ...actual,
    executionOrchestrator: { enqueue: (...args: unknown[]) => enqueue(...args) },
  };
});
vi.mock('./logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => logError(...args),
    http: vi.fn(),
    debug: vi.fn(),
  },
  updateLogLevel: vi.fn(),
}));

const { runTestPlan } = await import('./test-execution-service');
const { ExecutionEnqueueError, QUEUE_SUBMISSION_FAILED } = await import('./execution-orchestrator');

describe('runTestPlan', () => {
  it('keeps the words and status of a failure the orchestrator classified', async () => {
    enqueue.mockRejectedValueOnce(
      new ExecutionEnqueueError(
        QUEUE_SUBMISSION_FAILED,
        'The queue refused the run.',
        503,
        'run-1',
      ),
    );
    expect(await runTestPlan('plan-1', 7)).toEqual({
      error: 'The queue refused the run.',
      status: 503,
      testPlanRunId: 'run-1',
    });
  });

  it('answers an unexpected failure in general terms and keeps the detail in the log', async () => {
    const failure = new Error('connect ECONNREFUSED 10.0.0.5:5432');
    enqueue.mockRejectedValueOnce(failure);

    const result = await runTestPlan('plan-1', 7);

    expect(result).toEqual({ error: 'The test plan run could not be started.', status: 500 });
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to enqueue test plan run',
        planId: 'plan-1',
        error: failure.message,
        stack: failure.stack,
      }),
    );
  });
});

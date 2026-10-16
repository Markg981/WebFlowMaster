import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Test } from '@shared/schema';
import type { BrowserSession } from '../browser-session';

/**
 * Stopping a test for real (C06, P05).
 *
 * A cancellation or a deadline used to be noticed between two steps and nowhere else: a step
 * stuck in a script that never settles kept its page, its browser and its slot for as long as
 * the process lived, and the run's verdict could arrive while it was still running. These run a
 * real Chromium, launched for the test alone, and check that a stop closes it within seconds,
 * that nothing after the stop starts, and that the slot it held can be taken again.
 */

const mocks = vi.hoisted(() => {
  // Short enough to watch a step reach it; set before the step executor reads it.
  process.env.RUN_STEP_DEADLINE_MS = '1500';
  return {
    sessions: [] as BrowserSession[],
    /** Launches not yet finished, so a test can wait for one it abandoned. */
    launching: 0,
    executeStep: vi.fn(),
    onLog: (_message: string) => {},
    hangCapture: false,
  };
});

vi.mock('../browser-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../browser-session')>();
  return {
    ...actual,
    openBrowserSession: async (...args: Parameters<typeof actual.openBrowserSession>) => {
      mocks.launching++;
      try {
        const session = await actual.openBrowserSession(...args);
        mocks.sessions.push(session);
        return session;
      } finally {
        mocks.launching--;
      }
    },
  };
});
vi.mock('../step-executor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../step-executor')>();
  mocks.executeStep.mockImplementation(actual.executeStep);
  return { ...actual, executeStep: mocks.executeStep };
});
vi.mock('../../runtime/run-evidence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../runtime/run-evidence')>();
  return {
    ...actual,
    captureRunEvidence: async (input: Parameters<typeof actual.captureRunEvidence>[0]) => {
      // Saving the evidence, for good: a video that never finalises, a grid that never answers.
      if (mocks.hangCapture) await new Promise(() => {});
      return actual.captureRunEvidence(input);
    },
  };
});
vi.mock('../../identity/storage', () => ({ storage: { getUserSettings: vi.fn() } }));
vi.mock('../../http/websocket', () => ({
  getWsEmitter: () => ({
    emitExecutionLog: (_id: string, entry: { message: string }) => mocks.onLog(entry.message),
  }),
}));

const { TestRunner } = await import('./test-runner');
const { RunStoppedError } = await import('../../execution/run-watch');

/** The promise every stopped test must keep: closed within this long of the signal. */
const CLOSE_WITHIN_MS = 5_000;

function scriptTest(...scripts: string[]): Test {
  return {
    id: 1,
    userId: 1,
    organizationId: 1,
    name: 'Scripts',
    url: null,
    sequence: scripts.map((value, i) => ({
      id: `s${i + 1}`,
      action: { id: 'executeScript', name: `Script ${i + 1}` },
      value,
    })),
    elements: [],
    dataset: null,
  } as unknown as Test;
}

const run = (test: Test, signal?: AbortSignal) =>
  new TestRunner().executeTestSequence(test, null, undefined, 'exec-1', {}, undefined, {
    signal,
  });

const stopIn = (controller: AbortController, ms: number, cause: 'cancelled' | 'timed_out') => {
  let at = 0;
  setTimeout(() => {
    at = Date.now();
    controller.abort(new RunStoppedError(cause, `Not run: the run was ${cause}.`));
  }, ms);
  return () => at;
};

function expectNoSessionLeft() {
  for (const session of mocks.sessions) expect(session.browser.isConnected()).toBe(false);
}

beforeEach(() => {
  mocks.sessions.length = 0;
  mocks.executeStep.mockClear();
  mocks.onLog = () => {};
  mocks.hangCapture = false;
});
afterEach(async () => {
  await Promise.all(mocks.sessions.map((session) => session.close()));
});

describe('a run that stops while a test is running', () => {
  it('closes a browser that was still launching when the stop came', async () => {
    const controller = new AbortController();
    setTimeout(
      () => controller.abort(new RunStoppedError('cancelled', 'Not run: the run was cancelled.')),
      1,
    );

    const result = await run(scriptTest('return 1;'), controller.signal);
    // The launch could not be called back; it closes itself the moment it finishes.
    await vi.waitFor(
      () => {
        expect(mocks.launching).toBe(0);
        expectNoSessionLeft();
      },
      { timeout: 30_000 },
    );

    expect(result).toMatchObject({ success: false, interrupted: 'cancelled' });
    expect(mocks.executeStep).not.toHaveBeenCalled();
  });

  it('opens no browser at all when the run stopped before the test began', async () => {
    const controller = new AbortController();
    controller.abort(new RunStoppedError('cancelled', 'Not run: the run was cancelled.'));

    const result = await run(scriptTest('return 1;'), controller.signal);

    expect(mocks.sessions).toHaveLength(0);
    expect(mocks.executeStep).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, interrupted: 'cancelled' });
    expect(result.error).toMatch(/^Stopped: the run was cancelled/);
  });

  it('closes the session within seconds of a cancel during a script that never settles', async () => {
    const controller = new AbortController();
    let stoppedAt = () => 0;
    mocks.onLog = (message) => {
      // Once the script is running, not while the browser is still launching.
      if (message.startsWith('Executing step 1')) stoppedAt = stopIn(controller, 300, 'cancelled');
    };

    const result = await run(
      scriptTest('return new Promise(() => {});', 'return "never";'),
      controller.signal,
    );
    const answeredAt = Date.now();

    expect(result).toMatchObject({ success: false, interrupted: 'cancelled' });
    expect(result.steps?.at(-1)).toMatchObject({
      status: 'failed',
      error: 'Stopped: the run was cancelled.',
    });
    // The second step never started.
    expect(mocks.executeStep).toHaveBeenCalledTimes(1);
    expect(answeredAt - stoppedAt()).toBeLessThan(CLOSE_WITHIN_MS);
    expect(mocks.sessions).toHaveLength(1);
    expectNoSessionLeft();
  });

  it('ends a step stuck in a synchronous loop at its deadline, closing its own browser', async () => {
    const started = Date.now();

    const result = await run(scriptTest('while (true) {}', 'return "never";'));

    expect(result).toMatchObject({ success: false, interrupted: 'timed_out' });
    expect(result.error).toMatch(/deadline of 2 s/);
    expect(mocks.executeStep).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1_500 + CLOSE_WITHIN_MS);
    expectNoSessionLeft();
  });

  it('does not start the next step when the stop comes between two steps', async () => {
    const controller = new AbortController();
    mocks.onLog = (message) => {
      if (message.startsWith('Executing step 2'))
        controller.abort(new RunStoppedError('timed_out', 'Not run: past its limit.'));
    };

    const result = await run(scriptTest('return 1;', 'return 2;'), controller.signal);

    expect(mocks.executeStep).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, interrupted: 'timed_out' });
    expect(result.steps?.map((step) => step.status)).toEqual(['passed', 'passed', 'failed']);
    expectNoSessionLeft();
  });

  it('closes the session when the stop comes while the evidence is being saved', async () => {
    const controller = new AbortController();
    mocks.hangCapture = true;
    mocks.onLog = (message) => {
      // The last step has started; by the time the evidence is saved the stop has come.
      if (message.startsWith('Executing step 1')) stopIn(controller, 300, 'cancelled');
    };
    let stoppedAt = 0;
    controller.signal.addEventListener('abort', () => (stoppedAt = Date.now()));

    const result = await run(scriptTest('return 1;'), controller.signal);

    expect(Date.now() - stoppedAt).toBeLessThan(CLOSE_WITHIN_MS);
    expect(result.evidence).toEqual({});
    expectNoSessionLeft();
  });

  it('frees the slot: the next test runs as soon as the stopped one has answered', async () => {
    const controller = new AbortController();
    mocks.onLog = (message) => {
      if (message.startsWith('Executing step 1')) stopIn(controller, 300, 'cancelled');
    };
    const stopped = await run(scriptTest('return new Promise(() => {});'), controller.signal);
    expect(stopped.interrupted).toBe('cancelled');
    mocks.onLog = () => {};

    const next = await run(scriptTest('return 1 + 1;'));

    expect(next.success).toBe(true);
    expect(next.steps?.at(-1)?.details).toBe('Returned 2.');
    expect(mocks.sessions).toHaveLength(2);
    expectNoSessionLeft();
  });
});

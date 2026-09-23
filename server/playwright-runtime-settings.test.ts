import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Test } from '@shared/schema';
import type { StepRuntime } from './run-policies';

/**
 * What the browser part of a run does with a plan's settings: which timeouts the page gets,
 * which screenshots are kept, and whether a failed step is tried again. The browser is a fake —
 * what is under test is the step loop, not Playwright.
 */

const mocks = vi.hoisted(() => ({
  executeStep: vi.fn(),
  screenshot: vi.fn(),
  setDefaultTimeout: vi.fn(),
  setDefaultNavigationTimeout: vi.fn(),
  getUserSettings: vi.fn(),
}));

vi.mock('./browsers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./browsers')>();
  const page = {
    setDefaultTimeout: mocks.setDefaultTimeout,
    setDefaultNavigationTimeout: mocks.setDefaultNavigationTimeout,
    setViewportSize: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    isClosed: () => false,
    close: vi.fn().mockResolvedValue(undefined),
    screenshot: mocks.screenshot,
  };
  const context = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) };
  return {
    ...actual,
    launchBrowser: vi.fn(async () => ({ newContext: vi.fn().mockResolvedValue(context), isConnected: () => true })),
  };
});
vi.mock('./browser-pool', () => ({ browserPool: Promise.resolve({ release: vi.fn() }) }));
vi.mock('./storage', () => ({ storage: { getUserSettings: mocks.getUserSettings } }));
vi.mock('./step-executor', () => ({ executeStep: mocks.executeStep }));
vi.mock('./login-state', () => ({ loadLoginState: vi.fn(), saveLoginState: vi.fn() }));
vi.mock('./websocket', () => ({ getWsEmitter: () => ({ emitExecutionLog: vi.fn() }) }));
vi.mock('./playwright-reporter', () => ({
  PlaywrightReporter: class {
    lastActionHealed = false;
    lastActionRca = undefined;
    setContext() {}
    resetStepState() {}
  },
}));

const { playwrightService } = await import('./playwright-service');

const oneStepTest = (): Test =>
  ({
    id: 1,
    userId: 1,
    organizationId: 1,
    name: 'One step',
    url: 'https://example.test',
    sequence: [{ id: 's1', action: { id: 'click', name: 'Click' } }],
    elements: [],
    dataset: null,
  }) as unknown as Test;

const runtime = (overrides: Partial<StepRuntime> = {}): StepRuntime => ({
  pageLoadTimeoutMs: 45_000,
  elementTimeoutMs: 12_000,
  screenshots: 'on_failed_steps',
  retryFailedStep: false,
  ...overrides,
});

const run = (options?: { runtime?: StepRuntime }) =>
  playwrightService.executeTestSequence(oneStepTest(), 1, undefined, undefined, {}, undefined, options);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserSettings.mockResolvedValue({ playwrightDefaultTimeout: 90_000, playwrightHeadless: true });
  mocks.screenshot.mockResolvedValue(Buffer.from('png'));
  mocks.executeStep.mockResolvedValue({ status: 'passed' });
});

describe('timeouts', () => {
  it("gives the page the plan's element and page-load timeouts", async () => {
    await run({ runtime: runtime() });
    expect(mocks.setDefaultTimeout).toHaveBeenCalledWith(12_000);
    expect(mocks.setDefaultNavigationTimeout).toHaveBeenCalledWith(45_000);
  });

  it("keeps the user's own timeout for a run no plan drives", async () => {
    await run();
    expect(mocks.setDefaultTimeout).toHaveBeenCalledWith(90_000);
    expect(mocks.setDefaultNavigationTimeout).not.toHaveBeenCalled();
  });
});

describe('screenshots', () => {
  it('keeps none of a passing test under "on failed steps"', async () => {
    const result = await run({ runtime: runtime() });
    expect(result.success).toBe(true);
    expect(result.steps?.every((step) => step.screenshot === undefined)).toBe(true);
    expect(mocks.screenshot).not.toHaveBeenCalled();
  });

  it('keeps the failed step\'s', async () => {
    mocks.executeStep.mockResolvedValue({ status: 'failed', error: 'Button not found' });
    const result = await run({ runtime: runtime() });
    expect(result.steps?.[1]).toMatchObject({ status: 'failed', screenshot: 'data:image/png;base64,cG5n' });
  });

  it('keeps every one under "always", and without a plan, as it always has', async () => {
    for (const options of [{ runtime: runtime({ screenshots: 'always' }) }, undefined]) {
      mocks.screenshot.mockClear();
      const result = await run(options);
      expect(result.steps?.map((step) => step.screenshot)).toEqual(['data:image/png;base64,cG5n', 'data:image/png;base64,cG5n']);
    }
  });

  it('keeps none under "never", failed or not', async () => {
    mocks.executeStep.mockResolvedValue({ status: 'failed', error: 'Button not found' });
    const result = await run({ runtime: runtime({ screenshots: 'never' }) });
    expect(result.steps?.every((step) => step.screenshot === undefined)).toBe(true);
  });
});

describe('"Retry Step"', () => {
  it('tries a failed step once more, and a pass on the second try is a pass', async () => {
    mocks.executeStep.mockResolvedValueOnce({ status: 'failed', error: 'not yet' }).mockResolvedValueOnce({ status: 'passed' });

    const result = await run({ runtime: runtime({ retryFailedStep: true }) });

    expect(mocks.executeStep).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
  });

  it('retries a step that threw, and reports the second failure', async () => {
    mocks.executeStep
      .mockRejectedValueOnce(new Error('first throw'))
      .mockResolvedValueOnce({ status: 'failed', error: 'second outcome failed' });

    const result = await run({ runtime: runtime({ retryFailedStep: true }) });

    expect(mocks.executeStep).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.steps?.[1]).toMatchObject({ status: 'failed', error: 'second outcome failed' });
  });

  it('does not retry without the setting', async () => {
    mocks.executeStep.mockResolvedValue({ status: 'failed', error: 'no' });
    await run({ runtime: runtime() });
    expect(mocks.executeStep).toHaveBeenCalledTimes(1);
  });
});

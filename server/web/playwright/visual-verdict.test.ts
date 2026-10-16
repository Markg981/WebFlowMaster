import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import type { Test } from '@shared/schema';
import type { ArtifactStore } from '../../tenancy/artifact-store';

/**
 * A visual comparison that could not be made (C09, P06).
 *
 * A corrupt baseline, an unreachable store or a screenshot that could not be taken used to come
 * back as "skipped" and leave the step, and the test, passed: a plan that asked for visual
 * testing got a green result for a page nobody compared. These run a real Chromium and check
 * that each of the three ends the test in error, with its cause, and is not counted as a visual
 * regression either.
 */

const mocks = vi.hoisted(() => ({ screenshotFails: false }));

vi.mock('../visual-testing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../visual-testing')>();
  return {
    ...actual,
    stableScreenshot: async (...args: Parameters<typeof actual.stableScreenshot>) => {
      if (mocks.screenshotFails) throw new Error('Target page, context or browser has been closed');
      return actual.stableScreenshot(...args);
    },
  };
});
vi.mock('../../identity/storage', () => ({ storage: { getUserSettings: vi.fn() } }));
vi.mock('../../http/websocket', () => ({
  getWsEmitter: () => ({ emitExecutionLog: () => {} }),
}));

const { TestRunner } = await import('./test-runner');
const { sequenceStatus, stepVisualOf } = await import('./visual-verdict');
const { baselineKeyFor, visualError } = await import('../visual-testing');
const { setArtifactStoreForTest } = await import('../../tenancy/artifact-store');

const blobs = new Map<string, Buffer>();
const memoryStore = (overrides: Partial<ArtifactStore> = {}): ArtifactStore => ({
  kind: 's3',
  read: async (key) => blobs.get(key) ?? null,
  write: async (key, data) => {
    blobs.set(key, Buffer.from(data));
  },
  open: async () => null,
  publishDirectory: async () => 0,
  deletePrefix: async () => 0,
  ...overrides,
});

const visual = { testId: 41, organizationId: 1, browser: 'chromium' };

function pageTest(): Test {
  return {
    id: 41,
    userId: 1,
    organizationId: 1,
    name: 'Home looks right',
    url: null,
    sequence: [
      {
        id: 's1',
        action: { id: 'executeScript', name: 'Draw the page' },
        value: 'document.body.innerHTML = "<h1>Hello</h1>"; return 1;',
      },
    ],
    elements: [],
    dataset: null,
  } as unknown as Test;
}

const run = () =>
  new TestRunner().executeTestSequence(pageTest(), null, undefined, 'exec-visual', {}, undefined, {
    visual,
  });

/** The test's own step: the runner reports an "Initial State" row before it. */
const drawn = (result: Awaited<ReturnType<typeof run>>) =>
  result.steps?.find((step) => step.stepId === 's1');

beforeEach(() => {
  blobs.clear();
  mocks.screenshotFails = false;
  setArtifactStoreForTest(memoryStore());
});
afterEach(() => setArtifactStoreForTest(undefined));
afterAll(() => setArtifactStoreForTest(undefined));

describe('the verdict of a test whose visual comparison could not run', () => {
  it('is an error, not a pass, when the baseline is corrupt', async () => {
    blobs.set(baselineKeyFor(visual, 0), Buffer.from('not a png'));

    const result = await run();

    expect(result.success).toBe(false);
    expect(drawn(result)).toMatchObject({
      status: 'failed',
      visual: { outcome: 'error', cause: 'baseline-corrupt' },
    });
    expect(drawn(result).error).toMatch(/^Visual comparison could not run \(baseline-corrupt\)/);
    expect(sequenceStatus(result)).toBe('error');
    // Not silently replaced either.
    expect(blobs.get(baselineKeyFor(visual, 0))!.toString()).toBe('not a png');
  }, 60_000);

  it('is an error when the baseline store cannot be reached', async () => {
    setArtifactStoreForTest(
      memoryStore({
        read: async () => {
          throw new Error('getaddrinfo ENOTFOUND bucket');
        },
      }),
    );

    const result = await run();

    expect(drawn(result).visual).toMatchObject({
      outcome: 'error',
      cause: 'storage-unavailable',
    });
    expect(sequenceStatus(result)).toBe('error');
  }, 60_000);

  it('is an error when the screenshot to compare cannot be taken', async () => {
    mocks.screenshotFails = true;

    const result = await run();

    expect(drawn(result).visual).toMatchObject({
      outcome: 'error',
      cause: 'screenshot-unavailable',
    });
    expect(drawn(result).visual?.detail).toContain('has been closed');
    expect(sequenceStatus(result)).toBe('error');
  }, 60_000);

  it('still passes on a first run, which records the baseline as documented', async () => {
    const result = await run();

    expect(drawn(result).visual?.outcome).toBe('baseline-created');
    expect(sequenceStatus(result)).toBe('passed');
    // And the next run compares against it.
    const again = await run();
    expect(drawn(again).visual?.outcome).toBe('match');
    expect(sequenceStatus(again)).toBe('passed');
  }, 60_000);

  it('fails, as a regression, when the page really changed', async () => {
    const image = new PNG({ width: 4, height: 4 });
    image.data.fill(0);
    blobs.set(baselineKeyFor(visual, 0), PNG.sync.write(image));

    const result = await run();

    expect(drawn(result).visual?.outcome).toBe('diff');
    expect(sequenceStatus(result)).toBe('failed');
  }, 60_000);
});

describe('sequenceStatus', () => {
  const errorStep = {
    status: 'failed' as const,
    visual: stepVisualOf(visualError('storage-unavailable', 'x')),
  };

  it('keeps a failure of the application a failure, even beside a visual error', () => {
    expect(sequenceStatus({ success: false, steps: [errorStep, { status: 'failed' }] })).toBe(
      'failed',
    );
  });

  it('never lets an unverified comparison pass, and never calls it a regression', () => {
    expect(sequenceStatus({ success: false, steps: [{ status: 'passed' }, errorStep] })).toBe(
      'error',
    );
  });

  it('reads results recorded before the distinction as they were', () => {
    expect(
      sequenceStatus({
        success: true,
        steps: [{ status: 'passed', visual: { outcome: 'skipped', detail: 'old' } }],
      }),
    ).toBe('passed');
    expect(sequenceStatus({ success: false, steps: [] })).toBe('failed');
  });
});

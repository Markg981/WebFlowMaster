import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import {
  captureRunEvidence,
  shouldKeep,
  shouldRecord,
  startTrace,
  videoContextOptions,
  videoScratchDir,
} from './run-evidence';

/**
 * A failed run used to leave one picture per step and a sentence. These are the rules for the
 * video and the trace — and the ordering they need, which is the part that is easy to get
 * wrong: tracing stops before the context closes, and a video exists only once it has.
 */

const workDir = path.join(os.tmpdir(), `run-evidence-test-${process.pid}`);

afterEach(async () => {
  await fs.remove(workDir);
});

describe('shouldRecord and shouldKeep', () => {
  it("records for 'on_failure' too, because a video cannot be asked for after the fact", () => {
    expect(shouldRecord('on_failure')).toBe(true);
    expect(shouldRecord('always')).toBe(true);
    expect(shouldRecord('never')).toBe(false);
    expect(shouldRecord(undefined)).toBe(false);
  });

  it('keeps what the setting asked to keep', () => {
    expect(shouldKeep('always', true)).toBe(true);
    expect(shouldKeep('always', false)).toBe(true);
    expect(shouldKeep('on_failure', false)).toBe(true);
    expect(shouldKeep('on_failure', true)).toBe(false);
    expect(shouldKeep('never', false)).toBe(false);
  });
});

describe('videoContextOptions', () => {
  it('asks for no recording when none was wanted, so a run that records nothing pays nothing', async () => {
    expect(await videoContextOptions(undefined)).toEqual({});
    expect(await videoContextOptions({ video: 'never' })).toEqual({});
  });

  it('points the recording at a scratch directory inside the run', async () => {
    const options = await videoContextOptions({ video: 'always', artifactDir: workDir });

    expect(options.recordVideo?.dir).toBe(videoScratchDir(workDir));
    expect(await fs.pathExists(options.recordVideo!.dir)).toBe(true);
  });
});

describe('startTrace', () => {
  it('starts one only when asked, and never lets a failure to start stop the run', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const context = { tracing: { start } } as any;

    expect(await startTrace(context, { trace: 'never' })).toBe(false);
    expect(start).not.toHaveBeenCalled();

    expect(await startTrace(context, { trace: 'always' })).toBe(true);
    expect(start).toHaveBeenCalledWith({ screenshots: true, snapshots: true, sources: false });

    start.mockRejectedValueOnce(new Error('tracing unavailable'));
    expect(await startTrace(context, { trace: 'always' })).toBe(false);
  });
});

describe('captureRunEvidence', () => {
  function fakes() {
    const saved: string[] = [];
    const video = {
      saveAs: vi.fn(async (target: string) => {
        await fs.ensureDir(path.dirname(target));
        await fs.writeFile(target, 'video-bytes');
        saved.push(target);
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const order: string[] = [];
    const context = {
      tracing: {
        stop: vi.fn(async (options?: { path?: string }) => {
          order.push(options?.path ? 'trace-saved' : 'trace-discarded');
          if (options?.path) {
            await fs.ensureDir(path.dirname(options.path));
            await fs.writeFile(options.path, 'trace-bytes');
          }
        }),
      },
      close: vi.fn(async () => {
        order.push('context-closed');
      }),
    } as any;
    const page = {
      video: () => video,
      close: vi.fn(async () => {
        order.push('page-closed');
      }),
    } as any;
    return { context, page, video, order, saved };
  }

  it('keeps both when the plan said always', async () => {
    const { context, page } = fakes();

    const captured = await captureRunEvidence({
      context,
      page,
      options: { video: 'always', trace: 'always', artifactDir: workDir },
      tracing: true,
      passed: true,
      label: 'Login works',
    });

    expect(await fs.pathExists(captured.videoPath!)).toBe(true);
    expect(await fs.pathExists(captured.tracePath!)).toBe(true);
  });

  it('keeps nothing from a run that passed when the plan said on failure', async () => {
    const { context, page, video } = fakes();

    const captured = await captureRunEvidence({
      context,
      page,
      options: { video: 'on_failure', trace: 'on_failure', artifactDir: workDir },
      tracing: true,
      passed: true,
      label: 'Login works',
    });

    expect(captured.videoPath).toBeUndefined();
    expect(captured.tracePath).toBeUndefined();
    expect(context.tracing.stop).toHaveBeenCalledWith();
    // Recorded, then thrown away — which is the only way "on failure" can work.
    expect(video.delete).toHaveBeenCalled();
  });

  it('keeps both from a run that failed when the plan said on failure', async () => {
    const { context, page } = fakes();

    const captured = await captureRunEvidence({
      context,
      page,
      options: { video: 'on_failure', trace: 'on_failure', artifactDir: workDir },
      tracing: true,
      passed: false,
      label: 'Login works',
    });

    expect(await fs.pathExists(captured.videoPath!)).toBe(true);
    expect(await fs.pathExists(captured.tracePath!)).toBe(true);
  });

  it('stops the trace before the context closes, and saves the video after', async () => {
    const { context, page, order, video } = fakes();

    await captureRunEvidence({
      context,
      page,
      options: { video: 'always', trace: 'always', artifactDir: workDir },
      tracing: true,
      passed: false,
      label: 'ordering',
    });

    expect(order).toEqual(['trace-saved', 'page-closed', 'context-closed']);
    // The handle was taken before the page closed, and used after the context did.
    expect(video.saveAs).toHaveBeenCalled();
  });

  it('gives one test’s files a name another test will not overwrite', async () => {
    const first = await captureRunEvidence({
      context: fakes().context,
      page: fakes().page,
      options: { video: 'always', trace: 'always', artifactDir: workDir },
      tracing: true,
      passed: false,
      label: 'Login works',
    });
    const second = await captureRunEvidence({
      context: fakes().context,
      page: fakes().page,
      options: { video: 'always', trace: 'always', artifactDir: workDir },
      tracing: true,
      passed: false,
      label: 'Checkout works',
    });

    expect(first.videoPath).not.toBe(second.videoPath);
    expect(first.tracePath).not.toBe(second.tracePath);
  });

  it('closes everything and keeps nothing when no evidence was asked for', async () => {
    const { context, page } = fakes();

    const captured = await captureRunEvidence({
      context,
      page,
      options: undefined,
      tracing: false,
      passed: false,
      label: 'plain run',
    });

    expect(captured).toEqual({});
    expect(page.close).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
    expect(context.tracing.stop).not.toHaveBeenCalled();
  });

  it('does not let a failed save cost the run its verdict', async () => {
    const { context, page, video } = fakes();
    video.saveAs.mockRejectedValueOnce(new Error('disk full'));
    context.tracing.stop.mockRejectedValueOnce(new Error('disk full'));

    const captured = await captureRunEvidence({
      context,
      page,
      options: { video: 'always', trace: 'always', artifactDir: workDir },
      tracing: true,
      passed: false,
      label: 'unlucky',
    });

    expect(captured.videoPath).toBeUndefined();
    expect(captured.tracePath).toBeUndefined();
    expect(context.close).toHaveBeenCalled();
  });
});

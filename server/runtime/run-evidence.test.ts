import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import {
  captureRunEvidence,
  isSensitiveFlow,
  prudentEvidence,
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

    expect(path.dirname(options.recordVideo!.dir)).toBe(path.join(workDir, '_video'));
    expect(await fs.pathExists(options.recordVideo!.dir)).toBe(true);
  });

  it('gives every context its own scratch directory, even in one evidence directory (P08)', async () => {
    const dirs = new Set(Array.from({ length: 20 }, () => videoScratchDir(workDir)));
    expect(dirs.size).toBe(20);
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

  it('cleans up only its own recording when two contexts share an evidence directory (P08)', async () => {
    // Two languages of one test from a worker without units: one directory, two recordings at once.
    const [first, second] = await Promise.all([
      videoContextOptions({ video: 'always', artifactDir: workDir }),
      videoContextOptions({ video: 'always', artifactDir: workDir }),
    ]);
    const secondRecording = path.join(second.recordVideo!.dir, 'in-progress.webm');
    await fs.writeFile(secondRecording, 'still recording');

    const { context, page } = fakes();
    await captureRunEvidence({
      context,
      page,
      options: { video: 'always', artifactDir: workDir },
      tracing: false,
      passed: false,
      label: 'first',
      scratchDir: first.recordVideo!.dir,
    });

    expect(await fs.pathExists(first.recordVideo!.dir)).toBe(false);
    expect(await fs.readFile(secondRecording, 'utf8')).toBe('still recording');
  });

  it('leaves another context’s HAR being written alone (P08)', async () => {
    const harDir = path.join(workDir, '_har');
    await fs.ensureDir(harDir);
    const mine = path.join(harDir, 'mine.har');
    const theirs = path.join(harDir, 'theirs.har');
    await fs.writeFile(mine, JSON.stringify({ log: { entries: [] } }));
    await fs.writeFile(theirs, 'being written');

    const { context, page } = fakes();
    const captured = await captureRunEvidence({
      context,
      page,
      options: { network: 'always', artifactDir: workDir },
      tracing: false,
      passed: false,
      label: 'first',
      harScratchPath: mine,
    });

    expect(captured.harPath).toBe(path.join(workDir, 'first_network.har'));
    expect(await fs.pathExists(mine)).toBe(false);
    expect(await fs.readFile(theirs, 'utf8')).toBe('being written');
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

describe('prudent capture for sensitive flows (P03)', () => {
  const login = [
    { type: 'navigate', value: 'https://shop.test/login' },
    { type: 'fill', selector: '#user', value: 'mario' },
    { type: 'fill', selector: 'input[type=password]', value: '{{secret_password}}' },
  ];

  it('calls a flow sensitive when it types a secret or touches a password field', () => {
    expect(isSensitiveFlow(login)).toBe(true);
    expect(isSensitiveFlow([{ type: 'fill', selector: '#pin', value: '{{ secrets.PIN }}' }])).toBe(
      true,
    );
    expect(isSensitiveFlow([{ type: 'fill', selector: '#pwd', value: 'x' }])).toBe(true);
    expect(isSensitiveFlow([{ type: 'click', selector: '#search' }])).toBe(false);
    expect(isSensitiveFlow(null)).toBe(false);
  });

  it('looks inside step groups, including nested ones (C-09)', () => {
    const call = (id: string) => ({ action: { id: 'callGroup' }, value: id });
    const groups = [
      { id: 'g1', sequence: login },
      { id: 'outer', sequence: [call('inner')] },
      { id: 'inner', sequence: login },
      { id: 'clean', sequence: [{ type: 'click', selector: '#search' }] },
      { id: 'loop', sequence: [call('loop')] },
    ];
    expect(isSensitiveFlow([call('g1')], groups)).toBe(true);
    expect(isSensitiveFlow([call('outer')], groups)).toBe(true);
    expect(isSensitiveFlow([call('clean')], groups)).toBe(false);
    expect(isSensitiveFlow([call('loop')], groups)).toBe(false);
    // A group that cannot be loaded cannot be shown clean.
    expect(isSensitiveFlow([call('gone')], groups)).toBe(true);
  });

  it('records no trace for a sensitive flow, and keeps the rest as the plan asked', () => {
    const asked = {
      trace: 'always',
      video: 'on_failure',
      network: 'always',
      artifactDir: 'd',
    } as const;
    const prudent = prudentEvidence(asked, true);
    expect(prudent.traceWithheld).toBe(true);
    expect(prudent.options).toEqual({ ...asked, trace: 'never' });
    expect(shouldRecord(prudent.options!.trace)).toBe(false);
  });

  it('changes nothing for an ordinary flow, or when no trace was asked for', () => {
    const asked = { trace: 'on_failure', video: 'never' } as const;
    expect(prudentEvidence(asked, false)).toEqual({ options: asked, traceWithheld: false });
    const noTrace = { trace: 'never', video: 'always' } as const;
    expect(prudentEvidence(noTrace, true)).toEqual({ options: noTrace, traceWithheld: false });
    expect(prudentEvidence(undefined, true)).toEqual({ options: undefined, traceWithheld: false });
  });

  it('starts no tracing on a context for a sensitive flow', async () => {
    const start = vi.fn();
    const context = { tracing: { start } } as any;
    const { options } = prudentEvidence({ trace: 'always' }, true);
    expect(await startTrace(context, options)).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});

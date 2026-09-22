import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import type { BrowserContext, Page } from 'playwright';
import type { EvidenceCaptureMode } from '@shared/schema';

/**
 * What a run leaves behind besides a screenshot and a sentence.
 *
 * The report has always held one picture per step and the message the step died with, which
 * answers "the button was not there" and very little else. A test that failed because a
 * request was slow, because a dialog appeared and vanished, or because the page moved under
 * the click looks exactly like a test with a wrong selector — and the person reading it at
 * nine in the morning has only the picture of the aftermath.
 *
 * Playwright records both a video and a trace: the trace carries the DOM, the network and the
 * console at every step and opens in its own viewer. The context has always been able to do
 * this; nothing ever asked it to.
 */

export interface EvidenceOptions {
  video?: EvidenceCaptureMode;
  trace?: EvidenceCaptureMode;
  /** Where kept files go. Without one, nothing is kept — there is nowhere to put it. */
  artifactDir?: string;
}

export interface CapturedEvidence {
  videoPath?: string;
  tracePath?: string;
}

/**
 * Whether the run has to be recorded at all.
 *
 * 'on_failure' records: Playwright writes a video when the context closes and cannot be asked
 * for one after the fact, so the choice that is actually available is whether to keep it.
 */
export function shouldRecord(mode: EvidenceCaptureMode | undefined | null): boolean {
  return mode === 'always' || mode === 'on_failure';
}

/** Whether what was recorded survives the run. */
export function shouldKeep(mode: EvidenceCaptureMode | undefined | null, passed: boolean): boolean {
  if (mode === 'always') return true;
  if (mode === 'on_failure') return !passed;
  return false;
}

/** The directory a context writes video into while the test runs. */
export function videoScratchDir(artifactDir?: string): string {
  return artifactDir
    ? path.join(artifactDir, '_video')
    : path.join(os.tmpdir(), 'webflowmaster-video', `${process.pid}-${Date.now()}`);
}

/**
 * The `newContext` options this evidence setting implies.
 *
 * Returns nothing at all when no video is wanted, so a run that records nothing pays nothing —
 * which is every run today, and the reason the default is 'never'.
 */
export async function videoContextOptions(
  options: EvidenceOptions | undefined,
): Promise<{ recordVideo?: { dir: string } }> {
  if (!shouldRecord(options?.video)) return {};
  const dir = videoScratchDir(options?.artifactDir);
  await fs.ensureDir(dir);
  return { recordVideo: { dir } };
}

/** Starts tracing when the plan asked for one. Never throws: evidence is not the run. */
export async function startTrace(context: BrowserContext, options: EvidenceOptions | undefined): Promise<boolean> {
  if (!shouldRecord(options?.trace)) return false;
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Closes the page and the context in the order the evidence needs, and keeps what was asked for.
 *
 * The ordering is the whole reason this is one function rather than three calls at a call
 * site: tracing must be stopped before the context closes, and a video only exists once it
 * has. Getting that wrong produces an empty file and a report that promises a recording
 * nobody can play.
 */
export async function captureRunEvidence(input: {
  context: BrowserContext | null;
  page: Page | null;
  options: EvidenceOptions | undefined;
  tracing: boolean;
  passed: boolean;
  /** Distinguishes one test's files from another's inside a shared run directory. */
  label: string;
  /**
   * The directory the context was recording into.
   *
   * Passed rather than recomputed: without an artifact directory the scratch path carries a
   * timestamp, so working it out again would name a directory that never existed and leave
   * the real one behind.
   */
  scratchDir?: string;
}): Promise<CapturedEvidence> {
  const { context, page, options, tracing, passed, label, scratchDir } = input;
  const captured: CapturedEvidence = {};
  const artifactDir = options?.artifactDir;
  const stem = safeStem(label);

  if (context && tracing) {
    try {
      if (artifactDir && shouldKeep(options?.trace, passed)) {
        await fs.ensureDir(artifactDir);
        const target = path.join(artifactDir, `${stem}_trace.zip`);
        await context.tracing.stop({ path: target });
        captured.tracePath = target;
      } else {
        // Stopped without a path, which discards it. Leaving tracing running would hold the
        // recording open for as long as the context lives.
        await context.tracing.stop();
      }
    } catch {
      /* A trace that could not be written is not a reason to fail a run that already ran. */
    }
  }

  // Taken before anything closes: after `page.close()` the handle is the only way back to it.
  const video = shouldRecord(options?.video) ? page?.video() ?? null : null;

  if (page) await page.close().catch(() => {});
  if (context) await context.close().catch(() => {});

  if (video) {
    try {
      if (artifactDir && shouldKeep(options?.video, passed)) {
        await fs.ensureDir(artifactDir);
        const target = path.join(artifactDir, `${stem}_run.webm`);
        // Waits for the recording to be finalised, which is why this happens after the close.
        await video.saveAs(target);
        captured.videoPath = target;
      }
    } catch {
      /* As above: the run's verdict does not depend on its souvenirs. */
    }
    // Either way the scratch copy goes, including when it was saved elsewhere.
    await video.delete().catch(() => {});
  }

  await fs.remove(scratchDir ?? videoScratchDir(artifactDir)).catch(() => {});
  return captured;
}

function safeStem(label: string): string {
  return label.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 40) || 'run';
}

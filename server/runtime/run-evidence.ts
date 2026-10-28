import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import type { BrowserContext, Page } from 'playwright';
import { STEP_GROUP_ACTION_ID } from '@shared/recording';
import type { EvidenceCaptureMode } from '@shared/schema';
import { sanitiseHar, summariseHar, type HarLike, type NetworkSummary } from '@shared/network';

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
  /** A HAR of the page's requests, and the summary the report reads from it (shared/network.ts). */
  network?: EvidenceCaptureMode;
  /** Where kept files go. Without one, nothing is kept — there is nowhere to put it. */
  artifactDir?: string;
}

export interface CapturedEvidence {
  videoPath?: string;
  tracePath?: string;
  harPath?: string;
  /**
   * What the page asked the network for. Present whenever the network was recorded, kept file or
   * not: under "on failure" a passing test's HAR is dropped, and its summary costs nothing to keep.
   */
  network?: NetworkSummary;
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

/**
 * Whether a test's steps visibly handle a credential: a `{{secret…}}` placeholder (what the
 * recorder stores a typed password as) or anything named password — a field, a selector, a value.
 * Errs towards "sensitive": a "Forgot password?" link costs that test its trace, nothing more.
 *
 * A heuristic, and meant as one. It cannot see a secret behind an ordinary variable name, so it narrows what is recorded for the flows that are obviously sensitive; it does not
 * make any recording safe. Access control on the stored files (server/tenancy/artifact-access.ts) is
 * what protects the rest.
 */
function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function isSensitiveFlow(
  steps: unknown,
  groups: ReadonlyArray<{ id: string; sequence: unknown }> = [],
  seen: Set<string> = new Set(),
): boolean {
  let text: string;
  try {
    text = JSON.stringify(steps ?? null);
  } catch {
    return true;
  }
  if (/\{\{\s*secrets?[._]/i.test(text) || /pass(word|wd)|\bpwd\b/i.test(text)) return true;

  // A group call holds only a reference: look into the group it names, and into the groups that
  // one calls, so a login kept in a step group is as sensitive as one written in the test.
  const byId = new Map(groups.map((group) => [group.id, group]));
  const list = typeof steps === 'string' ? safeParse(steps) : steps;
  for (const step of Array.isArray(list) ? list : []) {
    if (step?.action?.id !== STEP_GROUP_ACTION_ID) continue;
    const id = typeof step.value === 'string' ? step.value.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const group = byId.get(id);
    // A group that cannot be read cannot be shown clean: err towards sensitive.
    if (!group || isSensitiveFlow(group.sequence, groups, seen)) return true;
  }
  return false;
}

/**
 * The evidence settings for one test: as the plan asked, except that a sensitive flow records no
 * trace.
 *
 * A Playwright trace keeps the DOM snapshots — input values included — and every request with its
 * body, so a login recorded in a trace holds the password in clear, and nothing can clean a trace
 * afterwards without breaking it. The video and screenshots are kept as asked: a browser draws a
 * password field as dots, though nothing guarantees what an application draws elsewhere. The HAR
 * is kept as asked too: it never records bodies, and its headers are cleaned (shared/network.ts).
 */
export function prudentEvidence(
  options: EvidenceOptions | undefined,
  sensitive: boolean,
): { options: EvidenceOptions | undefined; traceWithheld: boolean } {
  if (!options || !sensitive || !shouldRecord(options.trace)) {
    return { options, traceWithheld: false };
  }
  return { options: { ...options, trace: 'never' }, traceWithheld: true };
}

/** A name no other context of this process, or of another, picks at the same moment. */
const scratchName = () => `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The directory a context writes video into while the test runs: its own, below the evidence
 * directory's `_video`. Two contexts recording into one evidence directory (two languages of a
 * test from a worker without units, or any two that share a directory) each clean up their own and
 * never the other's recording in progress.
 */
export function videoScratchDir(artifactDir?: string): string {
  return artifactDir
    ? path.join(artifactDir, '_video', scratchName())
    : path.join(os.tmpdir(), 'webflowmaster-video', scratchName());
}

/** Removes a scratch directory's parent too, but only once nothing else is recording in it. */
async function removeScratch(dir: string, parent?: string): Promise<void> {
  await fs.remove(dir).catch(() => {});
  // rmdir refuses a directory that is not empty: another context's scratch stays.
  if (parent) await fs.rmdir(parent).catch(() => {});
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

/**
 * The `newContext` options for recording the network, and where the recording goes.
 *
 * Like a video, a HAR has to be asked for when the context is made and is written when it closes.
 * Bodies are never recorded: they are the largest part of a HAR, and the part most likely to hold
 * somebody's personal data.
 */
export async function harContextOptions(
  options: EvidenceOptions | undefined,
): Promise<{ recordHar?: { path: string; content: 'omit' } }> {
  if (!shouldRecord(options?.network)) return {};
  const dir = options?.artifactDir
    ? path.join(options.artifactDir, '_har')
    : path.join(os.tmpdir(), 'webflowmaster-har');
  await fs.ensureDir(dir);
  return { recordHar: { path: path.join(dir, `${scratchName()}.har`), content: 'omit' } };
}

/**
 * Reads the HAR a closed context wrote, cleans it, summarises it and keeps it if asked.
 *
 * Cleaned before anything else happens to it: the summary is read from the cleaned file, so no
 * credential reaches the report by that route either.
 */
async function collectHar(
  scratchPath: string,
  input: { keep: boolean; artifactDir?: string; stem: string },
): Promise<{ harPath?: string; network?: NetworkSummary }> {
  try {
    const har = sanitiseHar(JSON.parse(await fs.readFile(scratchPath, 'utf8')) as HarLike);
    const network = summariseHar(har);
    if (input.keep && input.artifactDir) {
      await fs.ensureDir(input.artifactDir);
      const target = path.join(input.artifactDir, `${input.stem}_network.har`);
      await fs.writeFile(target, JSON.stringify(har));
      return { harPath: target, network };
    }
    return { network };
  } catch {
    return {};
  } finally {
    await fs.remove(scratchPath).catch(() => {});
  }
}

/** Starts tracing when the plan asked for one. Never throws: evidence is not the run. */
export async function startTrace(
  context: BrowserContext,
  options: EvidenceOptions | undefined,
): Promise<boolean> {
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
  /** Where the context was writing its HAR, when it was recording one. */
  harScratchPath?: string;
}): Promise<CapturedEvidence> {
  const { context, page, options, tracing, passed, label, scratchDir, harScratchPath } = input;
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
  const video = shouldRecord(options?.video) ? (page?.video() ?? null) : null;

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

  // Written when the context closed, above.
  if (harScratchPath) {
    Object.assign(
      captured,
      await collectHar(harScratchPath, {
        keep: shouldKeep(options?.network, passed),
        artifactDir,
        stem,
      }),
    );
    // Its own file went with collectHar; the directory only once no other HAR is being written.
    if (artifactDir) await fs.rmdir(path.join(artifactDir, '_har')).catch(() => {});
  }

  // Only the directory this context recorded into: a recomputed one would name a fresh directory
  // and leave the real one behind, and the whole `_video` would take another context's with it.
  if (scratchDir)
    await removeScratch(scratchDir, artifactDir ? path.join(artifactDir, '_video') : undefined);
  return captured;
}

function safeStem(label: string): string {
  return label.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 40) || 'run';
}

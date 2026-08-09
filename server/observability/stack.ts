import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncidentOrigin, StackFrame } from '../../shared/observability';

/** Lines of context shown either side of the failing line. */
const CONTEXT_LINES = 5;

/**
 * `at fn (file:line:col)` or `at file:line:col`, with an optional `async` marker.
 *
 * The path is matched lazily so the final two `:number` groups win. That matters on
 * Windows, where the path itself contains a colon (`C:\...\x.ts:742:31`) — a greedy path
 * match would swallow the line number.
 */
const FRAME_RE = /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;

function toAbsolutePath(raw: string): string {
  if (raw.startsWith('file://')) {
    try {
      return fileURLToPath(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/**
 * Vite serves everything under the app's `src/` directory at the URL path `/src/...`, so a
 * browser stack trace names files that way — not as a filesystem path. Rewriting it to the
 * real absolute path under `browserSrcRoot` before classification means every downstream
 * function (isAppFile, toRepoRelative) keeps working exactly as it does for server stacks,
 * with no special case anywhere else.
 *
 * The containment check is load-bearing, not defensive style: this string arrives in a
 * browser-supplied incident report, and `path.resolve` collapses `..` segments — so
 * without the check, a forged frame like `/src/../../.env` would name a file OUTSIDE
 * client/src, be classified as an app frame, and resolveOrigin would read its contents
 * into the incident artifact. An escaped path is returned raw instead: raw bundler paths
 * match nothing on disk, so the frame classifies as vendor and nothing is ever read.
 */
function rewriteBrowserPath(raw: string, browserSrcRoot: string | undefined): string {
  if (!browserSrcRoot || !raw.startsWith('/src/')) return raw;
  const joined = path.resolve(browserSrcRoot, raw.slice('/src/'.length));
  const root = path.resolve(browserSrcRoot) + path.sep;
  return joined.toLowerCase().startsWith(root.toLowerCase()) ? joined : raw;
}

function isAppFile(absolute: string, repoRoot: string): boolean {
  const normalised = path.resolve(absolute);
  // The trailing separator is the boundary: without it, a sibling directory that merely
  // starts with the repo's name (`WebFlowMaster-secrets`) would pass as inside the repo.
  const root = path.resolve(repoRoot) + path.sep;
  // Case-insensitive because Windows reports drive letters inconsistently between the
  // stack trace and process.cwd().
  if (!normalised.toLowerCase().startsWith(root.toLowerCase())) return false;
  return !normalised.split(path.sep).includes('node_modules');
}

/** Repo-relative and forward-slashed: stable across machines, readable in an artifact. */
function toRepoRelative(absolute: string, repoRoot: string): string {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(absolute));
  return relative.split(path.sep).join('/');
}

/**
 * Turns a raw `error.stack` into structured frames, tagging the ones that belong to this
 * repository. Lines that are not frames (the leading message, `Caused by:`, blank lines)
 * are skipped rather than producing junk entries.
 */
export function parseStack(
  stack: string | undefined,
  repoRoot: string,
  browserSrcRoot?: string,
): StackFrame[] {
  if (!stack) return [];

  const frames: StackFrame[] = [];
  for (const rawLine of stack.split('\n')) {
    const match = FRAME_RE.exec(rawLine);
    if (!match) continue;

    const [, functionName, rawFile, line, column] = match;
    const rewritten = rewriteBrowserPath(rawFile.trim(), browserSrcRoot);
    const absolute = toAbsolutePath(rewritten);
    const app = isAppFile(absolute, repoRoot);

    frames.push({
      functionName: functionName ? functionName.trim() : null,
      file: app ? toRepoRelative(absolute, repoRoot) : absolute,
      line: Number(line),
      column: Number(column),
      app,
    });
  }
  return frames;
}

/**
 * Locates the first frame belonging to this project and reads the code around it, so the
 * incident carries the failing line itself instead of a coordinate to look up.
 *
 * Returns null when the stack contains no project frame at all — a crash entirely inside a
 * dependency has no origin here to point at.
 */
export function resolveOrigin(frames: StackFrame[], repoRoot: string): IncidentOrigin | null {
  const frame = frames.find((f) => f.app);
  if (!frame) return null;

  const base: IncidentOrigin = {
    file: frame.file,
    line: frame.line,
    column: frame.column,
    functionName: frame.functionName,
    source: [],
  };

  const absolute = path.join(repoRoot, frame.file);
  let content: string;
  try {
    content = fs.readFileSync(absolute, 'utf8');
  } catch (error) {
    // Better to admit we cannot show the code than to show the wrong lines because the
    // working tree moved after the error was thrown.
    return { ...base, unresolved: `could not read ${frame.file}: ${(error as Error).message}` };
  }

  const lines = content.split('\n');
  if (frame.line < 1 || frame.line > lines.length) {
    return {
      ...base,
      unresolved: `line ${frame.line} is outside ${frame.file} (${lines.length} lines)`,
    };
  }

  const from = Math.max(1, frame.line - CONTEXT_LINES);
  const to = Math.min(lines.length, frame.line + CONTEXT_LINES);
  const width = String(to).length;

  const source: string[] = [];
  for (let n = from; n <= to; n++) {
    const marker = n === frame.line ? '>' : '|';
    source.push(`${String(n).padStart(width + 3, ' ')} ${marker} ${lines[n - 1]}`);
  }

  return { ...base, source };
}

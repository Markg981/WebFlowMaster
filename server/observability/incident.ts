import { execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Incident, IncidentKind, IncidentOccurrence } from '../../shared/observability';
import { CURRENT_INCIDENT_SCHEMA_VERSION } from '../../shared/observability';
import { fingerprintError, incidentIdFromFingerprint } from './fingerprint';
import { parseStack, resolveOrigin } from './stack';
import { IncidentStore } from './store';
import { serverBreadcrumbs } from './breadcrumbs';
import { redactObject, redactString } from '../utils/log-redactor';
import { generateRepro } from './repro';

export interface IncidentLogger {
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface RecordIncidentInput {
  kind: IncidentKind;
  error: Error;
  trigger: Record<string, unknown>;
  correlationId?: string;
  sessionId?: string;
  userId?: number;
  /** Overrides the breadcrumbs looked up by correlation id (used by client reports). */
  breadcrumbs?: Record<string, unknown>[];
}

const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.observability',
);
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** One recorded occurrence per fingerprint per second; a hot loop is counted, not written. */
const RATE_LIMIT_MS = 1000;
/**
 * Cap on distinct fingerprints tracked at once, with LRU eviction — same rule
 * BreadcrumbRing follows: every in-memory collection here has a bound and an eviction rule,
 * because a live server runs indefinitely and a Map keyed by "every fingerprint ever seen"
 * does not.
 */
const MAX_TRACKED_FINGERPRINTS = 1000;

let rootDir = DEFAULT_ROOT;
let repoRoot = DEFAULT_REPO_ROOT;
let logger: IncidentLogger = { error: (message, meta) => console.error(message, meta ?? '') };
let store = new IncidentStore(rootDir);

interface FingerprintState {
  /** Set once this fingerprint has actually been persisted; undefined means "never yet". */
  lastRecordedAt?: number;
  /**
   * Occurrences the rate limiter dropped since the last persisted write for this
   * fingerprint. Folded into `count` on the next successful write so a suppressed storm is
   * still visible in the total even though only a bounded sample of `occurrences` survives.
   */
  suppressedCount: number;
}

/** Per-fingerprint rate-limit + suppressed-count state. Bounded and LRU-evicted below. */
const fingerprintState = new Map<string, FingerprintState>();

/**
 * Looks up (creating if needed) the state for a fingerprint and marks it most-recently-used.
 * Eviction here is the same trade-off BreadcrumbRing makes: a fingerprint pushed out loses
 * its suppressed-count tally, but that only happens once 1000 *distinct* bugs are live at
 * once, which is already a bigger problem than one undercount.
 */
function touchFingerprint(fingerprint: string): FingerprintState {
  let state = fingerprintState.get(fingerprint);
  if (state) {
    fingerprintState.delete(fingerprint);
  } else {
    state = { suppressedCount: 0 };
  }
  fingerprintState.set(fingerprint, state);

  while (fingerprintState.size > MAX_TRACKED_FINGERPRINTS) {
    const oldest = fingerprintState.keys().next();
    if (oldest.done) break;
    fingerprintState.delete(oldest.value);
  }

  return state;
}

/**
 * Scopes the recursion guard to one recording operation's async call chain instead of the
 * whole process. A nested recordIncident call reachable from inside this one (e.g. the
 * logger.error call below itself failing and re-entering) sees this store set and is
 * refused. An unrelated, concurrent recordIncident call — a second failure arriving before
 * this one reaches its first await — runs in its own context and is unaffected: mirrors the
 * AsyncLocalStorage pattern in server/middleware/correlation.ts.
 */
const recordingStore = new AsyncLocalStorage<true>();

export function configureIncidents(options: {
  rootDir?: string;
  repoRoot?: string;
  logger?: IncidentLogger;
}): void {
  if (options.rootDir) {
    rootDir = options.rootDir;
    store = new IncidentStore(rootDir);
  }
  if (options.repoRoot) repoRoot = options.repoRoot;
  if (options.logger) logger = options.logger;
  fingerprintState.clear();
}

// Local git plumbing commands (rev-parse, status --porcelain) normally return in single-digit
// milliseconds. 2s is generous headroom for a slow disk while still bounding the worst case:
// Node is single-threaded, so an untimed execFileSync blocking on lock contention or a stuck
// credential prompt would stall this request — and everything else the process is doing —
// indefinitely. recordIncident is documented to never throw; a timeout here must fail the
// same way the existing catch already does (return null for the field), not hang instead.
const GIT_COMMAND_TIMEOUT_MS = 2000;

/**
 * Git state is cached because collecting it costs three synchronous subprocess calls —
 * measured at ~185ms on this machine — and `recordIncident`'s body runs synchronously up
 * to its first await. Uncached, every caller that believes it is fire-and-forget (the
 * Express error handler, the runner tap) actually blocks for that long: the handler would
 * delay every 500 response by it, on a single-threaded process.
 *
 * The TTL is short so a commit or branch switch mid-session is still picked up, while a
 * burst of incidents from one bug pays the cost once.
 */
const GIT_INFO_TTL_MS = 30_000;
let gitInfoCache: { at: number; value: Record<string, unknown> } | null = null;

function gitInfo(): Record<string, unknown> {
  const now = Date.now();
  if (gitInfoCache && now - gitInfoCache.at < GIT_INFO_TTL_MS) {
    return gitInfoCache.value;
  }

  const run = (args: string[]): string | null => {
    try {
      return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GIT_COMMAND_TIMEOUT_MS,
      }).trim();
    } catch {
      // Covers both a real git failure and a timeout kill (execFileSync throws either way) —
      // both are "we don't have this field", not an incident-recording failure.
      return null;
    }
  };
  const value = {
    gitCommit: run(['rev-parse', '--short', 'HEAD']),
    gitBranch: run(['rev-parse', '--abbrev-ref', 'HEAD']),
    workingTreeDirty: run(['status', '--porcelain']) !== '',
  };
  gitInfoCache = { at: now, value };
  return value;
}

/**
 * Records one failure. Returns the persisted incident, or null when nothing was written
 * (rate-limited, recursive, or the write failed).
 *
 * Never throws: an observability failure must not become an application failure.
 */
export async function recordIncident(input: RecordIncidentInput): Promise<Incident | null> {
  if (recordingStore.getStore()) return null;
  return recordingStore.run(true, () => doRecordIncident(input));
}

async function doRecordIncident(input: RecordIncidentInput): Promise<Incident | null> {
  // Declared outside the try so the catch can hand a failed write's suppressed tally back.
  let fingerprint: string | undefined;
  let suppressedSinceLastWrite = 0;

  try {
    // Browser stack frames name files as Vite serves them (`/src/...`), not as filesystem
    // paths, so only client-runtime incidents opt into the rewrite. Server stacks never
    // pass a browserSrcRoot at all, so the rewrite cannot reach them. What the rewrite
    // does have to survive is a forged `/src/` frame from a browser-supplied report —
    // rewriteBrowserPath contains that, see its comment.
    const browserSrcRoot =
      input.kind === 'client-runtime' ? path.join(repoRoot, 'client', 'src') : undefined;
    const frames = parseStack(input.error.stack, repoRoot, browserSrcRoot);
    fingerprint = fingerprintError({
      kind: input.kind,
      message: input.error.message,
      frames,
    });

    const now = Date.now();
    const state = touchFingerprint(fingerprint);
    if (state.lastRecordedAt !== undefined && now - state.lastRecordedAt < RATE_LIMIT_MS) {
      // Still counted, just not written yet — folded into the next successful write below.
      state.suppressedCount += 1;
      return null;
    }
    state.lastRecordedAt = now;
    suppressedSinceLastWrite = state.suppressedCount;
    state.suppressedCount = 0;

    const id = incidentIdFromFingerprint(fingerprint);
    const nowIso = new Date(now).toISOString();
    const occurrence: IncidentOccurrence = {
      ts: nowIso,
      correlationId: input.correlationId,
      sessionId: input.sessionId,
      userId: input.userId,
    };

    // title/message are free text — redactObject's key-based matching can't reach them, so
    // they go through the string scrubber instead. See log-redactor.ts for its limits.
    const redactedMessage = redactString(input.error.message);
    const rawBreadcrumbs =
      input.breadcrumbs ??
      (input.correlationId ? serverBreadcrumbs.take(input.correlationId) : []);

    const incident: Incident = {
      schemaVersion: CURRENT_INCIDENT_SCHEMA_VERSION,
      id,
      fingerprint,
      kind: input.kind,
      status: 'open',
      // +suppressedSinceLastWrite so a rate-limited storm is still reflected in the total,
      // even though only a bounded sample of occurrences (below) is ever retained.
      count: 1 + suppressedSinceLastWrite,
      firstSeen: nowIso,
      lastSeen: nowIso,
      title: `${input.error.name}: ${redactedMessage}`.slice(0, 300),
      origin: resolveOrigin(frames, repoRoot),
      error: { name: input.error.name, message: redactedMessage, frames },
      trigger: redactObject(input.trigger) as Record<string, unknown>,
      state: {
        ...gitInfo(),
        nodeVersion: process.version,
        platform: process.platform,
        nodeEnv: process.env.NODE_ENV ?? 'development',
      },
      breadcrumbs: redactObject(rawBreadcrumbs) as unknown[],
      occurrences: [occurrence],
    };

    // Written before persisting so the artifact records where its reproduction lives.
    incident.repro = await generateRepro(incident, repoRoot);
    const persisted = await store.upsert(incident);
    await store.prune();

    logger.error(`[incident] ${persisted.title} incidentId=${persisted.id}`, {
      incidentId: persisted.id,
      kind: persisted.kind,
      origin: persisted.origin ? `${persisted.origin.file}:${persisted.origin.line}` : null,
      correlationId: input.correlationId,
    });

    return persisted;
  } catch (failure) {
    // The suppressed tally was zeroed before the write on the assumption it would land.
    // It didn't, so give those occurrences back to the next attempt rather than losing
    // them — otherwise a transient disk error quietly undercounts a storm.
    if (fingerprint !== undefined && suppressedSinceLastWrite > 0) {
      const state = fingerprintState.get(fingerprint);
      if (state) state.suppressedCount += suppressedSinceLastWrite;
    }
    // Deliberately console, not the logger: the logger may be what is broken.
    console.error('[observability] failed to record incident:', failure);
    return null;
  }
}

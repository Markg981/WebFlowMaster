import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Incident, IncidentKind, IncidentOccurrence } from '../../shared/observability';
import { fingerprintError, incidentIdFromFingerprint } from './fingerprint';
import { parseStack, resolveOrigin } from './stack';
import { IncidentStore } from './store';
import { serverBreadcrumbs } from './breadcrumbs';
import { redactObject } from '../utils/log-redactor';

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

let rootDir = DEFAULT_ROOT;
let repoRoot = DEFAULT_REPO_ROOT;
let logger: IncidentLogger = { error: (message, meta) => console.error(message, meta ?? '') };
let store = new IncidentStore(rootDir);

const lastRecordedAt = new Map<string, number>();
/** Guards against an incident being recorded about the incident recorder. */
let recording = false;

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
  lastRecordedAt.clear();
}

function gitInfo(): Record<string, unknown> {
  const run = (args: string[]): string | null => {
    try {
      return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  return {
    gitCommit: run(['rev-parse', '--short', 'HEAD']),
    gitBranch: run(['rev-parse', '--abbrev-ref', 'HEAD']),
    workingTreeDirty: run(['status', '--porcelain']) !== '',
  };
}

/**
 * Records one failure. Returns the persisted incident, or null when nothing was written
 * (rate-limited, recursive, or the write failed).
 *
 * Never throws: an observability failure must not become an application failure.
 */
export async function recordIncident(input: RecordIncidentInput): Promise<Incident | null> {
  if (recording) return null;
  recording = true;
  try {
    const frames = parseStack(input.error.stack, repoRoot);
    const fingerprint = fingerprintError({
      kind: input.kind,
      message: input.error.message,
      frames,
    });

    const now = Date.now();
    const previous = lastRecordedAt.get(fingerprint);
    if (previous !== undefined && now - previous < RATE_LIMIT_MS) return null;
    lastRecordedAt.set(fingerprint, now);

    const id = incidentIdFromFingerprint(fingerprint);
    const nowIso = new Date(now).toISOString();
    const occurrence: IncidentOccurrence = {
      ts: nowIso,
      correlationId: input.correlationId,
      sessionId: input.sessionId,
      userId: input.userId,
    };

    const incident: Incident = {
      id,
      fingerprint,
      kind: input.kind,
      status: 'open',
      count: 1,
      firstSeen: nowIso,
      lastSeen: nowIso,
      title: `${input.error.name}: ${input.error.message}`.slice(0, 300),
      origin: resolveOrigin(frames, repoRoot),
      error: { name: input.error.name, message: input.error.message, frames },
      trigger: redactObject(input.trigger) as Record<string, unknown>,
      state: {
        ...gitInfo(),
        nodeVersion: process.version,
        platform: process.platform,
        nodeEnv: process.env.NODE_ENV ?? 'development',
      },
      breadcrumbs:
        input.breadcrumbs ??
        (input.correlationId ? serverBreadcrumbs.take(input.correlationId) : []),
      occurrences: [occurrence],
    };

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
    // Deliberately console, not the logger: the logger may be what is broken.
    console.error('[observability] failed to record incident:', failure);
    return null;
  } finally {
    recording = false;
  }
}

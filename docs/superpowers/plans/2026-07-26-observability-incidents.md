# Observability & Incidents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give WebFlowMaster a memory of its own failures — one correlated log stream covering server *and* browser, plus structured incident files an agent can read to reproduce and fix a bug without being told what it was.

**Architecture:** A pure core (`fingerprint` → `stack` → `store`) with no I/O beyond the filesystem, wrapped by `recordIncident()`, fed by four thin taps (Express, client, BullMQ job, Playwright runner). The browser gets a buffered logger that batches into an ingest endpoint, so client lines land in the same winston file as server lines, joined by a client-generated correlation id.

**Tech Stack:** TypeScript, Node 20, Express 4, winston, zod, vitest 3 (server: `node` env; client: `jsdom`), supertest, React 18, wouter, TanStack Query.

## Global Constraints

- **Development only.** No source-map resolution, no production ingest. Guard anything risky with `process.env.NODE_ENV`.
- **`.observability/` is gitignored.** Incident triggers contain request bodies.
- **Redaction is not reimplemented.** Reuse `redactSensitiveData()` / the `SENSITIVE_KEYS` regex from `server/utils/log-redactor.ts`.
- **Generated reproductions use the `.repro.ts` extension** so neither vitest config collects them.
- **Every in-memory collection is bounded.** Max size + eviction, always.
- **Observability must never break the product.** Every public entry point is wrapped in `try/catch`; a failure degrades to `console.error` once and is swallowed.
- **The logger must never log its own failures through itself.** Bounded retries, then drop.
- **No read endpoint for incidents.** The agent reads files directly.
- Server tests live in `server/**/*.test.ts`, run with `npm test` (which resets `data/test.db` first). Client tests live under `client/src/`, run with `npm test --prefix client`.
- Commit after every task. Never use `--no-verify`.

---

## File Structure

**Created — shared**
- `shared/observability.ts` — wire types and zod schemas shared by client and server (client log entries, client incident reports, incident file shape).

**Created — server**
- `server/observability/fingerprint.ts` — message normalisation and stable hashing.
- `server/observability/stack.ts` — V8 stack parsing, app-vs-vendor classification, source snippet extraction.
- `server/observability/store.ts` — incident file read/merge/write, index maintenance, pruning.
- `server/observability/breadcrumbs.ts` — bounded per-correlation ring buffer (server side).
- `server/observability/incident.ts` — `recordIncident()` orchestrator: guard, rate limit, assemble, persist, log.
- `server/observability/repro.ts` — generates `.repro.ts` reproduction files.
- `server/observability/taps/express.ts` — Express error-handler tap.
- `server/observability/taps/jobs.ts` — BullMQ handler wrapper.
- `server/observability/taps/runner.ts` — Playwright infrastructure-failure helper.
- `server/routes/observability.routes.ts` — `POST /api/client-logs`, `POST /api/incidents`.

**Created — client**
- `client/src/observability/session.ts` — `sessionId` (per tab) and `newCorrelationId()`.
- `client/src/observability/logger.ts` — levels, buffer, batched flush, transport.
- `client/src/observability/breadcrumbs.ts` — bounded ring of user actions.
- `client/src/observability/error-boundary.tsx` — React error boundary that reports.
- `client/src/observability/install.ts` — global handlers + route hook wiring.

**Modified**
- `.gitignore` — add `.observability/`.
- `server/index.ts:110-121` — error handler also records an incident.
- `server/routes.ts` — mount the observability router.
- `server/worker.ts:16-61` — wrap job handlers with the job tap.
- `server/playwright-service.ts` — report runner infrastructure failures.
- `client/src/lib/queryClient.ts` — send correlation headers, log every call.
- `client/src/App.tsx` — install handlers, wrap the router in the error boundary.

---

### Task 1: Wire types and fingerprinting

**Files:**
- Create: `shared/observability.ts`
- Create: `server/observability/fingerprint.ts`
- Test: `server/observability/fingerprint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `IncidentKind`, `IncidentStatus`, `StackFrame`, `IncidentOrigin`, `Incident`, `IncidentIndexEntry`, `ClientLogEntrySchema`, `ClientLogBatchSchema`, `ClientIncidentReportSchema` (all from `@shared/observability`); `normaliseMessage(message: string): string`, `fingerprintError(input: { kind: IncidentKind; message: string; frames: StackFrame[] }): string`, `incidentIdFromFingerprint(fingerprint: string): string` (from `server/observability/fingerprint`).

- [ ] **Step 1: Write the shared types**

Create `shared/observability.ts`:

```ts
import { z } from "zod";

/** Which layer produced the failure. Drives the trigger shape and the repro strategy. */
export const INCIDENT_KINDS = ["server-api", "client-runtime", "job", "runner"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_STATUSES = ["open", "fixed", "ignored"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export type ReproConfidence = "high" | "medium" | "best-effort" | "none";

/** One parsed stack frame. `app` marks frames belonging to this repository. */
export interface StackFrame {
  functionName: string | null;
  file: string;
  line: number;
  column: number;
  app: boolean;
}

/** The first app-owned frame, with the surrounding source read from disk. */
export interface IncidentOrigin {
  file: string;
  line: number;
  column: number;
  functionName: string | null;
  /** Formatted source lines; the failing one is prefixed with `>` instead of `|`. */
  source: string[];
  /** Set when the file could not be read, e.g. the commit moved underneath us. */
  unresolved?: string;
}

export interface IncidentOccurrence {
  ts: string;
  correlationId?: string;
  sessionId?: string;
  userId?: number;
}

export interface IncidentRepro {
  path: string;
  command: string;
  confidence: ReproConfidence;
  notes?: string;
}

export interface Incident {
  id: string;
  fingerprint: string;
  kind: IncidentKind;
  status: IncidentStatus;
  count: number;
  firstSeen: string;
  lastSeen: string;
  title: string;
  origin: IncidentOrigin | null;
  error: { name: string; message: string; frames: StackFrame[] };
  trigger: Record<string, unknown>;
  state: Record<string, unknown>;
  breadcrumbs: unknown[];
  occurrences: IncidentOccurrence[];
  repro?: IncidentRepro;
}

/** Compact row in `.observability/index.json`. */
export interface IncidentIndexEntry {
  id: string;
  kind: IncidentKind;
  status: IncidentStatus;
  title: string;
  count: number;
  lastSeen: string;
  file: string;
  reproPath?: string;
  reproConfidence?: ReproConfidence;
}

export const CLIENT_LOG_LEVELS = ["error", "warn", "info", "http", "debug"] as const;
export type ClientLogLevel = (typeof CLIENT_LOG_LEVELS)[number];

export const ClientLogEntrySchema = z.object({
  level: z.enum(CLIENT_LOG_LEVELS),
  message: z.string().max(2000),
  /** Browser clock, kept alongside the server's own so skew is visible. */
  clientTs: z.string(),
  correlationId: z.string().max(100).optional(),
  route: z.string().max(500).optional(),
  meta: z.record(z.unknown()).optional(),
});
export type ClientLogEntry = z.infer<typeof ClientLogEntrySchema>;

export const ClientLogBatchSchema = z.object({
  sessionId: z.string().min(1).max(100),
  entries: z.array(ClientLogEntrySchema).min(1).max(100),
  /** Entries the browser had to drop because its buffer was full. */
  dropped: z.number().int().nonnegative().optional(),
});
export type ClientLogBatch = z.infer<typeof ClientLogBatchSchema>;

export const ClientIncidentReportSchema = z.object({
  sessionId: z.string().min(1).max(100),
  correlationId: z.string().max(100).optional(),
  route: z.string().max(500).optional(),
  name: z.string().max(200),
  message: z.string().max(2000),
  stack: z.string().max(20000).optional(),
  componentStack: z.string().max(20000).optional(),
  /** Serialisable props captured by the error boundary, when it has them. */
  props: z.record(z.unknown()).optional(),
  breadcrumbs: z.array(z.record(z.unknown())).max(50).optional(),
});
export type ClientIncidentReport = z.infer<typeof ClientIncidentReportSchema>;
```

- [ ] **Step 2: Write the failing test**

Create `server/observability/fingerprint.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normaliseMessage, fingerprintError, incidentIdFromFingerprint } from './fingerprint';
import type { StackFrame } from '../../shared/observability';

const frame = (file: string, line: number): StackFrame => ({
  functionName: 'doThing', file, line, column: 1, app: true,
});

describe('normaliseMessage', () => {
  it('strips uuids, numbers and quoted values so variants collapse', () => {
    const a = normaliseMessage('Session 4f2a8c11-1d3e-4b7a-9f10-0c2e5a7b1234 failed after 1523ms');
    const b = normaliseMessage('Session 9a1b7c33-2e4f-4c8b-8a20-1d3f6b8c2345 failed after 87ms');
    expect(a).toBe(b);
  });

  it('strips absolute paths', () => {
    const a = normaliseMessage('ENOENT: no such file, open /home/ci/app/data/x.json');
    const b = normaliseMessage('ENOENT: no such file, open C:\\Users\\marco\\app\\data\\x.json');
    expect(a).toBe(b);
  });

  it('keeps genuinely different messages different', () => {
    expect(normaliseMessage('Cannot read selector')).not.toBe(normaliseMessage('Cannot read value'));
  });
});

describe('fingerprintError', () => {
  it('is stable for the same error', () => {
    const input = { kind: 'server-api' as const, message: 'boom', frames: [frame('server/a.ts', 10)] };
    expect(fingerprintError(input)).toBe(fingerprintError(input));
  });

  it('ignores vendor frames', () => {
    const appOnly = { kind: 'server-api' as const, message: 'boom', frames: [frame('server/a.ts', 10)] };
    const withVendor = {
      kind: 'server-api' as const,
      message: 'boom',
      frames: [
        frame('server/a.ts', 10),
        { functionName: 'x', file: 'node_modules/express/lib/router.js', line: 99, column: 1, app: false },
      ],
    };
    expect(fingerprintError(withVendor)).toBe(fingerprintError(appOnly));
  });

  it('separates different kinds with the same error', () => {
    const frames = [frame('server/a.ts', 10)];
    expect(fingerprintError({ kind: 'server-api', message: 'boom', frames }))
      .not.toBe(fingerprintError({ kind: 'job', message: 'boom', frames }));
  });

  it('separates different origin lines', () => {
    expect(fingerprintError({ kind: 'job', message: 'boom', frames: [frame('server/a.ts', 10)] }))
      .not.toBe(fingerprintError({ kind: 'job', message: 'boom', frames: [frame('server/a.ts', 20)] }));
  });
});

describe('incidentIdFromFingerprint', () => {
  it('is the inc_ prefix plus six hex characters', () => {
    const id = incidentIdFromFingerprint('abcdef0123456789');
    expect(id).toBe('inc_abcdef');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- server/observability/fingerprint.test.ts`
Expected: FAIL — `Cannot find module './fingerprint'`.

- [ ] **Step 4: Write the implementation**

Create `server/observability/fingerprint.ts`:

```ts
import { createHash } from 'node:crypto';
import type { IncidentKind, StackFrame } from '../../shared/observability';

/** How many leading app frames take part in the fingerprint. */
const FRAMES_IN_FINGERPRINT = 3;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_HEX = /\b[0-9a-f]{12,}\b/gi;
const ABSOLUTE_PATH = /(?:[A-Za-z]:\\|\/)[^\s"')]+/g;
const NUMBER = /\b\d+\b/g;

/**
 * Collapses the parts of a message that vary between occurrences of the same bug —
 * ids, timings, paths — so fifty occurrences share one fingerprint instead of
 * producing fifty near-identical incident files.
 */
export function normaliseMessage(message: string): string {
  return message
    .replace(UUID, '<uuid>')
    .replace(ABSOLUTE_PATH, '<path>')
    .replace(LONG_HEX, '<hex>')
    .replace(NUMBER, '<n>')
    .trim();
}

export function fingerprintError(input: {
  kind: IncidentKind;
  message: string;
  frames: StackFrame[];
}): string {
  const appFrames = input.frames
    .filter((f) => f.app)
    .slice(0, FRAMES_IN_FINGERPRINT)
    .map((f) => `${f.file}:${f.line}`);

  const material = [input.kind, normaliseMessage(input.message), ...appFrames].join('|');
  return createHash('sha256').update(material).digest('hex');
}

/** Incident ids are short on purpose: they appear in log lines and filenames. */
export function incidentIdFromFingerprint(fingerprint: string): string {
  return `inc_${fingerprint.slice(0, 6)}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- server/observability/fingerprint.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add shared/observability.ts server/observability/fingerprint.ts server/observability/fingerprint.test.ts
git commit -m "feat(observability): shared incident types and error fingerprinting"
```

---

### Task 2: Stack parsing and source snippets

**Files:**
- Create: `server/observability/stack.ts`
- Test: `server/observability/stack.test.ts`

**Interfaces:**
- Consumes: `StackFrame`, `IncidentOrigin` from `@shared/observability`.
- Produces: `parseStack(stack: string | undefined, repoRoot: string): StackFrame[]`, `resolveOrigin(frames: StackFrame[], repoRoot: string): IncidentOrigin | null`.

- [ ] **Step 1: Write the failing test**

Create `server/observability/stack.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseStack, resolveOrigin } from './stack';

let repoRoot: string;

beforeAll(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-stack-'));
  fs.mkdirSync(path.join(repoRoot, 'server'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'server', 'sample.ts'),
    Array.from({ length: 20 }, (_unused, i) => `const line${i + 1} = ${i + 1};`).join('\n'),
    'utf8',
  );
});

afterAll(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe('parseStack', () => {
  it('parses named frames and marks project files as app frames', () => {
    const stack = [
      'TypeError: boom',
      `    at PlaywrightService.run (${path.join(repoRoot, 'server', 'sample.ts')}:10:5)`,
      `    at Layer.handle (${path.join(repoRoot, 'node_modules', 'express', 'lib', 'layer.js')}:95:5)`,
    ].join('\n');

    const frames = parseStack(stack, repoRoot);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      functionName: 'PlaywrightService.run',
      line: 10,
      column: 5,
      app: true,
    });
    expect(frames[0].file).toBe('server/sample.ts');
    expect(frames[1].app).toBe(false);
  });

  it('parses anonymous and async frames', () => {
    const stack = [
      'Error: boom',
      `    at ${path.join(repoRoot, 'server', 'sample.ts')}:3:1`,
      `    at async ${path.join(repoRoot, 'server', 'sample.ts')}:4:2`,
    ].join('\n');

    const frames = parseStack(stack, repoRoot);

    expect(frames).toHaveLength(2);
    expect(frames[0].functionName).toBeNull();
    expect(frames[1].line).toBe(4);
  });

  it('parses file:// URLs', () => {
    const fileUrl = new URL(`file:///${path.join(repoRoot, 'server', 'sample.ts').replace(/\\/g, '/')}`).href;
    const frames = parseStack(`Error: boom\n    at run (${fileUrl}:7:3)`, repoRoot);

    expect(frames[0].file).toBe('server/sample.ts');
    expect(frames[0].line).toBe(7);
  });

  it('returns an empty array for a missing stack', () => {
    expect(parseStack(undefined, repoRoot)).toEqual([]);
  });
});

describe('resolveOrigin', () => {
  it('picks the first app frame and reads the surrounding source', () => {
    const frames = parseStack(
      `Error: boom\n    at run (${path.join(repoRoot, 'node_modules', 'x', 'i.js')}:1:1)\n    at run (${path.join(repoRoot, 'server', 'sample.ts')}:10:5)`,
      repoRoot,
    );

    const origin = resolveOrigin(frames, repoRoot);

    expect(origin?.file).toBe('server/sample.ts');
    expect(origin?.line).toBe(10);
    expect(origin?.source).toContain('  10 > const line10 = 10;');
    expect(origin?.source).toContain('   9 | const line9 = 9;');
    expect(origin?.unresolved).toBeUndefined();
  });

  it('clamps the window at the start of the file', () => {
    const frames = parseStack(`Error: boom\n    at run (${path.join(repoRoot, 'server', 'sample.ts')}:2:1)`, repoRoot);
    const origin = resolveOrigin(frames, repoRoot);

    expect(origin?.source[0]).toBe('   1 | const line1 = 1;');
  });

  it('marks the origin unresolved when the file no longer exists', () => {
    const frames = parseStack(`Error: boom\n    at run (${path.join(repoRoot, 'server', 'gone.ts')}:5:1)`, repoRoot);
    const origin = resolveOrigin(frames, repoRoot);

    expect(origin?.unresolved).toBeTruthy();
    expect(origin?.source).toEqual([]);
  });

  it('returns null when there is no app frame at all', () => {
    const frames = parseStack(`Error: boom\n    at x (${path.join(repoRoot, 'node_modules', 'y', 'z.js')}:1:1)`, repoRoot);
    expect(resolveOrigin(frames, repoRoot)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- server/observability/stack.test.ts`
Expected: FAIL — `Cannot find module './stack'`.

- [ ] **Step 3: Write the implementation**

Create `server/observability/stack.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncidentOrigin, StackFrame } from '../../shared/observability';

/** Lines of context shown either side of the failing line. */
const CONTEXT_LINES = 5;

/**
 * `at fn (file:line:col)` or `at file:line:col`, with an optional `async` marker.
 * The path is matched lazily so the final two `:number` groups win — which matters on
 * Windows, where the path itself contains a colon (`C:\...`).
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

function isAppFile(absolute: string, repoRoot: string): boolean {
  const normalised = path.resolve(absolute);
  const root = path.resolve(repoRoot);
  if (!normalised.toLowerCase().startsWith(root.toLowerCase())) return false;
  return !normalised.split(path.sep).includes('node_modules');
}

/** Repo-relative, forward-slashed — stable across machines and readable in an artifact. */
function toRepoRelative(absolute: string, repoRoot: string): string {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(absolute));
  return relative.split(path.sep).join('/');
}

export function parseStack(stack: string | undefined, repoRoot: string): StackFrame[] {
  if (!stack) return [];

  const frames: StackFrame[] = [];
  for (const rawLine of stack.split('\n')) {
    const match = FRAME_RE.exec(rawLine);
    if (!match) continue;

    const [, functionName, rawFile, line, column] = match;
    const absolute = toAbsolutePath(rawFile.trim());
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
    // Better to admit we cannot show the code than to show the wrong lines because
    // the working tree moved after the error was thrown.
    return { ...base, unresolved: `could not read ${frame.file}: ${(error as Error).message}` };
  }

  const lines = content.split('\n');
  if (frame.line < 1 || frame.line > lines.length) {
    return { ...base, unresolved: `line ${frame.line} is outside ${frame.file} (${lines.length} lines)` };
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- server/observability/stack.test.ts`
Expected: PASS, 9 tests.

If the padding assertions fail, print the actual `origin.source` and align the expected
strings in the test to the real output — the format is `padStart(width + 3)` where `width`
is the digit count of the last line number shown.

- [ ] **Step 5: Commit**

```bash
git add server/observability/stack.ts server/observability/stack.test.ts
git commit -m "feat(observability): stack parsing with app-frame detection and source snippets"
```

---

### Task 3: Incident store

**Files:**
- Create: `server/observability/store.ts`
- Test: `server/observability/store.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `Incident`, `IncidentIndexEntry` from `@shared/observability`.
- Produces: `IncidentStore` class with `constructor(rootDir: string)`, `upsert(incident: Incident): Promise<Incident>`, `read(id: string): Promise<Incident | null>`, `readIndex(): Promise<IncidentIndexEntry[]>`, `prune(options?: { maxFiles?: number; maxAgeDays?: number }): Promise<number>`; constants `MAX_INCIDENT_FILES = 200`, `MAX_INCIDENT_AGE_DAYS = 30`, `MAX_OCCURRENCES = 10`.

- [ ] **Step 1: Write the failing test**

Create `server/observability/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IncidentStore, MAX_OCCURRENCES } from './store';
import type { Incident } from '../../shared/observability';

let root: string;
let store: IncidentStore;

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'inc_aaaaaa',
  fingerprint: 'aaaaaa0000',
  kind: 'server-api',
  status: 'open',
  count: 1,
  firstSeen: '2026-07-26T10:00:00.000Z',
  lastSeen: '2026-07-26T10:00:00.000Z',
  title: 'TypeError: boom',
  origin: null,
  error: { name: 'TypeError', message: 'boom', frames: [] },
  trigger: { method: 'POST', path: '/api/x' },
  state: { gitCommit: 'abc1234' },
  breadcrumbs: [],
  occurrences: [{ ts: '2026-07-26T10:00:00.000Z', correlationId: 'c-1' }],
  ...overrides,
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-store-'));
  store = new IncidentStore(root);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('IncidentStore.upsert', () => {
  it('writes a new incident and indexes it', async () => {
    await store.upsert(incident());

    const onDisk = await store.read('inc_aaaaaa');
    expect(onDisk?.count).toBe(1);

    const index = await store.readIndex();
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ id: 'inc_aaaaaa', title: 'TypeError: boom', count: 1 });
  });

  it('merges a recurrence instead of creating a second file', async () => {
    await store.upsert(incident());
    const merged = await store.upsert(
      incident({
        lastSeen: '2026-07-26T11:00:00.000Z',
        occurrences: [{ ts: '2026-07-26T11:00:00.000Z', correlationId: 'c-2' }],
      }),
    );

    expect(merged.count).toBe(2);
    expect(merged.firstSeen).toBe('2026-07-26T10:00:00.000Z');
    expect(merged.lastSeen).toBe('2026-07-26T11:00:00.000Z');
    expect(fs.readdirSync(path.join(root, 'incidents'))).toHaveLength(1);
    expect(await store.readIndex()).toHaveLength(1);
  });

  it('caps retained occurrences', async () => {
    await store.upsert(incident());
    for (let i = 0; i < MAX_OCCURRENCES + 5; i++) {
      await store.upsert(incident({ occurrences: [{ ts: new Date().toISOString(), correlationId: `c-${i}` }] }));
    }

    const onDisk = await store.read('inc_aaaaaa');
    expect(onDisk!.occurrences.length).toBeLessThanOrEqual(MAX_OCCURRENCES);
    expect(onDisk!.count).toBe(MAX_OCCURRENCES + 6);
  });

  it('keeps a manually set status across recurrences', async () => {
    await store.upsert(incident());
    const stored = await store.read('inc_aaaaaa');
    await store.upsert({ ...stored!, status: 'ignored' });

    const reoccurred = await store.upsert(incident());
    expect(reoccurred.status).toBe('ignored');
  });
});

describe('IncidentStore.prune', () => {
  it('drops the oldest beyond the file cap, fixed ones first', async () => {
    await store.upsert(incident({ id: 'inc_old001', fingerprint: 'old001', lastSeen: '2026-07-01T00:00:00.000Z' }));
    await store.upsert(incident({ id: 'inc_fix001', fingerprint: 'fix001', status: 'fixed', lastSeen: '2026-07-25T00:00:00.000Z' }));
    await store.upsert(incident({ id: 'inc_new001', fingerprint: 'new001', lastSeen: '2026-07-26T00:00:00.000Z' }));

    const removed = await store.prune({ maxFiles: 2, maxAgeDays: 3650 });

    expect(removed).toBe(1);
    const ids = (await store.readIndex()).map((e) => e.id).sort();
    expect(ids).toEqual(['inc_new001', 'inc_old001']);
  });

  it('drops incidents older than the age cap', async () => {
    const old = new Date(Date.now() - 40 * 24 * 3600_000).toISOString();
    await store.upsert(incident({ id: 'inc_old002', fingerprint: 'old002', lastSeen: old }));
    await store.upsert(incident({ id: 'inc_new002', fingerprint: 'new002', lastSeen: new Date().toISOString() }));

    const removed = await store.prune({ maxFiles: 500, maxAgeDays: 30 });

    expect(removed).toBe(1);
    expect((await store.readIndex()).map((e) => e.id)).toEqual(['inc_new002']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- server/observability/store.test.ts`
Expected: FAIL — `Cannot find module './store'`.

- [ ] **Step 3: Write the implementation**

Create `server/observability/store.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Incident, IncidentIndexEntry } from '../../shared/observability';

export const MAX_INCIDENT_FILES = 200;
export const MAX_INCIDENT_AGE_DAYS = 30;
/** Occurrences kept per incident. The count keeps rising; the list does not. */
export const MAX_OCCURRENCES = 10;

/**
 * Filesystem-backed incident storage.
 *
 * One file per fingerprint, so a recurrence updates a file rather than adding one, plus a
 * compact index so the whole picture is one read away.
 */
export class IncidentStore {
  private readonly incidentsDir: string;
  private readonly indexPath: string;
  /** Serialises writes: concurrent requests must not interleave index read-modify-write. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly rootDir: string) {
    this.incidentsDir = path.join(rootDir, 'incidents');
    this.indexPath = path.join(rootDir, 'index.json');
  }

  private serialise<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private filePath(id: string): string {
    return path.join(this.incidentsDir, `${id}.json`);
  }

  private async writeJson(target: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Write-then-rename so a reader never sees a half-written file.
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temp, target);
  }

  async read(id: string): Promise<Incident | null> {
    try {
      return JSON.parse(await fs.readFile(this.filePath(id), 'utf8')) as Incident;
    } catch {
      return null;
    }
  }

  async readIndex(): Promise<IncidentIndexEntry[]> {
    try {
      return JSON.parse(await fs.readFile(this.indexPath, 'utf8')) as IncidentIndexEntry[];
    } catch {
      return [];
    }
  }

  async upsert(incoming: Incident): Promise<Incident> {
    return this.serialise(async () => {
      const existing = await this.read(incoming.id);

      const merged: Incident = existing
        ? {
            ...incoming,
            firstSeen: existing.firstSeen,
            count: existing.count + incoming.count,
            // A status set by hand (fixed / ignored) outlives a recurrence.
            status: existing.status === 'open' ? incoming.status : existing.status,
            occurrences: [...existing.occurrences, ...incoming.occurrences].slice(-MAX_OCCURRENCES),
            repro: incoming.repro ?? existing.repro,
          }
        : incoming;

      await this.writeJson(this.filePath(merged.id), merged);
      await this.reindex(merged);
      return merged;
    });
  }

  private async reindex(incident: Incident): Promise<void> {
    const index = (await this.readIndex()).filter((entry) => entry.id !== incident.id);
    index.push({
      id: incident.id,
      kind: incident.kind,
      status: incident.status,
      title: incident.title,
      count: incident.count,
      lastSeen: incident.lastSeen,
      file: `incidents/${incident.id}.json`,
      reproPath: incident.repro?.path,
      reproConfidence: incident.repro?.confidence,
    });
    index.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    await this.writeJson(this.indexPath, index);
  }

  /** Returns how many incidents were removed. */
  async prune(options: { maxFiles?: number; maxAgeDays?: number } = {}): Promise<number> {
    const maxFiles = options.maxFiles ?? MAX_INCIDENT_FILES;
    const maxAgeDays = options.maxAgeDays ?? MAX_INCIDENT_AGE_DAYS;

    return this.serialise(async () => {
      const index = await this.readIndex();
      const cutoff = Date.now() - maxAgeDays * 24 * 3600_000;

      const tooOld = new Set(
        index.filter((e) => Date.parse(e.lastSeen) < cutoff).map((e) => e.id),
      );

      // Over the cap: fixed incidents go first, then the least recently seen.
      const survivors = index.filter((e) => !tooOld.has(e.id));
      const ranked = [...survivors].sort((a, b) => {
        const aFixed = a.status === 'fixed' ? 1 : 0;
        const bFixed = b.status === 'fixed' ? 1 : 0;
        if (aFixed !== bFixed) return bFixed - aFixed;
        return Date.parse(a.lastSeen) - Date.parse(b.lastSeen);
      });
      const overflow = new Set(ranked.slice(0, Math.max(0, survivors.length - maxFiles)).map((e) => e.id));

      const doomed = [...tooOld, ...overflow];
      for (const id of doomed) {
        await fs.rm(this.filePath(id), { force: true });
      }

      if (doomed.length > 0) {
        await this.writeJson(this.indexPath, index.filter((e) => !doomed.includes(e.id)));
      }
      return doomed.length;
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- server/observability/store.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Gitignore the artifact directory**

Add to `.gitignore`, immediately after the existing `logs/` line:

```gitignore
.observability/
```

- [ ] **Step 6: Commit**

```bash
git add server/observability/store.ts server/observability/store.test.ts .gitignore
git commit -m "feat(observability): incident store with dedupe, index and pruning"
```

---

### Task 4: Breadcrumbs and the recordIncident orchestrator

**Files:**
- Create: `server/observability/breadcrumbs.ts`
- Create: `server/observability/incident.ts`
- Test: `server/observability/breadcrumbs.test.ts`
- Test: `server/observability/incident.test.ts`

**Interfaces:**
- Consumes: `fingerprintError`, `incidentIdFromFingerprint`, `parseStack`, `resolveOrigin`, `IncidentStore`.
- Produces: `BreadcrumbRing` class with `constructor(options?: { maxCorrelations?: number; maxPerCorrelation?: number; ttlMs?: number })`, `push(correlationId: string, crumb: Record<string, unknown>): void`, `take(correlationId: string): Record<string, unknown>[]`, `size(): number`; `serverBreadcrumbs` singleton. From `incident.ts`: `recordIncident(input: RecordIncidentInput): Promise<Incident | null>`, `configureIncidents(options: { rootDir?: string; repoRoot?: string; logger?: IncidentLogger }): void`, `type RecordIncidentInput`, `type IncidentLogger`.

- [ ] **Step 1: Write the failing breadcrumbs test**

Create `server/observability/breadcrumbs.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BreadcrumbRing } from './breadcrumbs';

afterEach(() => vi.useRealTimers());

describe('BreadcrumbRing', () => {
  it('returns crumbs for a correlation id in order', () => {
    const ring = new BreadcrumbRing();
    ring.push('c-1', { message: 'first' });
    ring.push('c-1', { message: 'second' });

    expect(ring.take('c-1').map((c) => c.message)).toEqual(['first', 'second']);
  });

  it('keeps correlations separate', () => {
    const ring = new BreadcrumbRing();
    ring.push('c-1', { message: 'a' });
    ring.push('c-2', { message: 'b' });

    expect(ring.take('c-1')).toHaveLength(1);
    expect(ring.take('c-2')).toHaveLength(1);
  });

  it('caps crumbs per correlation, dropping the oldest', () => {
    const ring = new BreadcrumbRing({ maxPerCorrelation: 3 });
    for (const n of [1, 2, 3, 4, 5]) ring.push('c-1', { n });

    expect(ring.take('c-1').map((c) => c.n)).toEqual([3, 4, 5]);
  });

  it('evicts the least recently used correlation beyond the cap', () => {
    const ring = new BreadcrumbRing({ maxCorrelations: 2 });
    ring.push('c-1', { n: 1 });
    ring.push('c-2', { n: 2 });
    ring.push('c-3', { n: 3 });

    expect(ring.size()).toBe(2);
    expect(ring.take('c-1')).toEqual([]);
    expect(ring.take('c-3')).toHaveLength(1);
  });

  it('drops entries past their TTL', () => {
    vi.useFakeTimers();
    const ring = new BreadcrumbRing({ ttlMs: 1000 });
    ring.push('c-1', { n: 1 });

    vi.advanceTimersByTime(1500);
    ring.push('c-2', { n: 2 }); // any write sweeps expired entries

    expect(ring.take('c-1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- server/observability/breadcrumbs.test.ts`
Expected: FAIL — `Cannot find module './breadcrumbs'`.

- [ ] **Step 3: Implement the ring**

Create `server/observability/breadcrumbs.ts`:

```ts
const DEFAULT_MAX_CORRELATIONS = 500;
const DEFAULT_MAX_PER_CORRELATION = 50;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface Bucket {
  crumbs: Record<string, unknown>[];
  touchedAt: number;
}

/**
 * Bounded per-correlation trail of what happened before a failure.
 *
 * Every dimension is capped — number of correlations, crumbs per correlation, and age —
 * because an unbounded, non-expiring Map keyed by request id is a memory leak that only
 * shows up under load.
 */
export class BreadcrumbRing {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxCorrelations: number;
  private readonly maxPerCorrelation: number;
  private readonly ttlMs: number;

  constructor(options: { maxCorrelations?: number; maxPerCorrelation?: number; ttlMs?: number } = {}) {
    this.maxCorrelations = options.maxCorrelations ?? DEFAULT_MAX_CORRELATIONS;
    this.maxPerCorrelation = options.maxPerCorrelation ?? DEFAULT_MAX_PER_CORRELATION;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  push(correlationId: string, crumb: Record<string, unknown>): void {
    this.sweep();

    let bucket = this.buckets.get(correlationId);
    if (bucket) {
      // Re-insert so Map iteration order tracks recency, making the first key the LRU.
      this.buckets.delete(correlationId);
    } else {
      bucket = { crumbs: [], touchedAt: 0 };
    }

    bucket.crumbs.push(crumb);
    if (bucket.crumbs.length > this.maxPerCorrelation) {
      bucket.crumbs = bucket.crumbs.slice(-this.maxPerCorrelation);
    }
    bucket.touchedAt = Date.now();
    this.buckets.set(correlationId, bucket);

    while (this.buckets.size > this.maxCorrelations) {
      const oldest = this.buckets.keys().next();
      if (oldest.done) break;
      this.buckets.delete(oldest.value);
    }
  }

  take(correlationId: string): Record<string, unknown>[] {
    this.sweep();
    return [...(this.buckets.get(correlationId)?.crumbs ?? [])];
  }

  size(): number {
    return this.buckets.size;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.touchedAt < cutoff) this.buckets.delete(key);
    }
  }
}

/** Shared instance used by the taps. */
export const serverBreadcrumbs = new BreadcrumbRing();
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- server/observability/breadcrumbs.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing incident test**

Create `server/observability/incident.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordIncident, configureIncidents } from './incident';
import { IncidentStore } from './store';
import { serverBreadcrumbs } from './breadcrumbs';

let root: string;
let repoRoot: string;
const logged: { level: string; message: string; meta?: unknown }[] = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-inc-'));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-repo-'));
  fs.mkdirSync(path.join(repoRoot, 'server'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'server', 'thing.ts'), 'a\nb\nc\nd\ne\nf\ng\n', 'utf8');
  logged.length = 0;

  configureIncidents({
    rootDir: root,
    repoRoot,
    logger: { error: (message, meta) => logged.push({ level: 'error', message, meta }) },
  });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
  vi.useRealTimers();
});

const errorFrom = (file: string, line: number) => {
  const error = new Error('Cannot read properties of undefined (reading \'selector\')');
  error.stack = `TypeError: ${error.message}\n    at run (${path.join(repoRoot, file)}:${line}:5)`;
  return error;
};

describe('recordIncident', () => {
  it('writes an incident with a resolved origin and returns it', async () => {
    const incident = await recordIncident({
      kind: 'server-api',
      error: errorFrom('server/thing.ts', 3),
      trigger: { method: 'POST', path: '/api/x' },
      correlationId: 'c-1',
    });

    expect(incident).not.toBeNull();
    expect(incident!.origin?.file).toBe('server/thing.ts');
    expect(incident!.origin?.line).toBe(3);
    expect(incident!.trigger).toMatchObject({ method: 'POST', path: '/api/x' });
    expect(incident!.state).toHaveProperty('nodeVersion');

    const store = new IncidentStore(root);
    expect(await store.read(incident!.id)).not.toBeNull();
  });

  it('logs a line carrying the incident id so the log leads to the file', async () => {
    const incident = await recordIncident({
      kind: 'server-api',
      error: errorFrom('server/thing.ts', 3),
      trigger: {},
      correlationId: 'c-1',
    });

    expect(logged.some((l) => l.message.includes(incident!.id))).toBe(true);
  });

  it('attaches the breadcrumbs recorded for that correlation id', async () => {
    serverBreadcrumbs.push('c-crumbs', { message: 'loaded settings' });

    const incident = await recordIncident({
      kind: 'server-api',
      error: errorFrom('server/thing.ts', 3),
      trigger: {},
      correlationId: 'c-crumbs',
    });

    expect(incident!.breadcrumbs).toEqual([{ message: 'loaded settings' }]);
  });

  it('redacts secrets in the trigger', async () => {
    const incident = await recordIncident({
      kind: 'server-api',
      error: errorFrom('server/thing.ts', 3),
      trigger: { body: { username: 'marco', password: 'hunter2-super-secret' } },
      correlationId: 'c-1',
    });

    expect(JSON.stringify(incident!.trigger)).not.toContain('hunter2-super-secret');
    expect(JSON.stringify(incident!.trigger)).toContain('marco');
  });

  it('rate-limits repeats of the same fingerprint within a second', async () => {
    const first = await recordIncident({ kind: 'job', error: errorFrom('server/thing.ts', 3), trigger: {} });
    const second = await recordIncident({ kind: 'job', error: errorFrom('server/thing.ts', 3), trigger: {} });

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const store = new IncidentStore(root);
    expect((await store.read(first!.id))!.count).toBe(1);
  });

  it('never throws when the store cannot be written', async () => {
    configureIncidents({ rootDir: path.join(root, 'nested\0invalid'), repoRoot });

    await expect(
      recordIncident({ kind: 'runner', error: errorFrom('server/thing.ts', 3), trigger: {} }),
    ).resolves.toBeNull();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- server/observability/incident.test.ts`
Expected: FAIL — `Cannot find module './incident'`.

- [ ] **Step 7: Implement the orchestrator**

Create `server/observability/incident.ts`:

```ts
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
```

- [ ] **Step 8: Export `redactObject` from the existing redactor**

`server/utils/log-redactor.ts` currently exposes only the winston format. Add a plain
export next to it so the incident recorder reuses the same rules rather than duplicating
the key list. Append to the file:

```ts
/**
 * Redacts an arbitrary object with the same rules the winston format uses.
 * Exported so incident triggers go through one implementation, not a second copy.
 */
export function redactObject(value: unknown): unknown {
  return redactValue(value, 0);
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test -- server/observability/incident.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 10: Commit**

```bash
git add server/observability/breadcrumbs.ts server/observability/breadcrumbs.test.ts \
        server/observability/incident.ts server/observability/incident.test.ts \
        server/utils/log-redactor.ts
git commit -m "feat(observability): bounded breadcrumbs and the recordIncident orchestrator"
```

---

### Task 5: Express tap

**Files:**
- Create: `server/observability/taps/express.ts`
- Test: `server/observability/taps/express.test.ts`
- Modify: `server/index.ts:110-121`

**Interfaces:**
- Consumes: `recordIncident` from `server/observability/incident`.
- Produces: `incidentErrorHandler(logger: IncidentLogger): ErrorRequestHandler`, `buildServerApiTrigger(req: Request): Record<string, unknown>`.

- [ ] **Step 1: Write the failing test**

Create `server/observability/taps/express.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { incidentErrorHandler, buildServerApiTrigger } from './express';
import { configureIncidents } from '../incident';
import { IncidentStore } from '../store';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-tap-'));
  configureIncidents({ rootDir: root, logger: { error: () => {} } });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const appThatThrows = () => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: unknown }).user = { id: 42 };
    next();
  });
  app.post('/api/boom', () => {
    throw new TypeError('Cannot read properties of undefined (reading \'selector\')');
  });
  app.use(incidentErrorHandler({ error: () => {} }));
  return app;
};

describe('incidentErrorHandler', () => {
  it('records an incident and still answers the request', async () => {
    const response = await request(appThatThrows()).post('/api/boom').send({ url: 'https://x.test' });

    expect(response.status).toBe(500);

    const index = await new IncidentStore(root).readIndex();
    expect(index).toHaveLength(1);
    expect(index[0].kind).toBe('server-api');
  });

  it('captures the request as the trigger', async () => {
    await request(appThatThrows()).post('/api/boom?debug=1').send({ url: 'https://x.test' });

    const store = new IncidentStore(root);
    const [entry] = await store.readIndex();
    const incident = await store.read(entry.id);

    expect(incident!.trigger).toMatchObject({
      method: 'POST',
      path: '/api/boom',
      query: { debug: '1' },
      body: { url: 'https://x.test' },
      userId: 42,
    });
  });

  it('still responds when recording the incident fails', async () => {
    configureIncidents({ rootDir: path.join(root, 'nope\0bad') });

    const response = await request(appThatThrows()).post('/api/boom').send({});

    expect(response.status).toBe(500);
  });
});

describe('buildServerApiTrigger', () => {
  it('keeps only allowlisted headers', () => {
    const req = {
      method: 'GET',
      path: '/api/x',
      query: {},
      body: undefined,
      headers: { 'content-type': 'application/json', cookie: 'session=abc', 'x-correlation-id': 'c-1' },
    } as unknown as Request;

    const trigger = buildServerApiTrigger(req);

    expect(trigger.headers).toEqual({ 'content-type': 'application/json', 'x-correlation-id': 'c-1' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- server/observability/taps/express.test.ts`
Expected: FAIL — `Cannot find module './express'`.

- [ ] **Step 3: Implement the tap**

Create `server/observability/taps/express.ts`:

```ts
import type { ErrorRequestHandler, Request } from 'express';
import { getCorrelationId } from '../../middleware/correlation';
import { recordIncident, type IncidentLogger } from '../incident';

/** Headers worth keeping. Everything else is either noise or a credential. */
const HEADER_ALLOWLIST = ['content-type', 'accept', 'user-agent', 'x-correlation-id', 'x-session-id'];

export function buildServerApiTrigger(req: Request): Record<string, unknown> {
  const headers: Record<string, unknown> = {};
  for (const name of HEADER_ALLOWLIST) {
    const value = req.headers[name];
    if (value !== undefined) headers[name] = value;
  }

  return {
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body,
    headers,
    userId: (req as Request & { user?: { id?: number } }).user?.id,
  };
}

/**
 * Express error handler that records an incident and then behaves exactly like the
 * previous one. Mounted last, after every route.
 */
export function incidentErrorHandler(logger: IncidentLogger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const status = err?.status || err?.statusCode || 500;
    const message = err?.message || 'Internal Server Error';

    // Fire and forget: the response must not wait on disk I/O.
    void recordIncident({
      kind: 'server-api',
      error: err instanceof Error ? err : new Error(String(message)),
      trigger: buildServerApiTrigger(req),
      correlationId: getCorrelationId(),
      userId: (req as Request & { user?: { id?: number } }).user?.id,
    });

    logger.error('Unhandled request error', { status, message, stack: err?.stack });

    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- server/observability/taps/express.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Replace the handler in `server/index.ts`**

Replace lines 110-121 of `server/index.ts` (the existing `app.use((err: any, ...))` block)
with:

```ts
  // Records an incident for every unhandled error, then answers as before.
  const { incidentErrorHandler } = await import('./observability/taps/express');
  app.use(incidentErrorHandler(logger));
```

- [ ] **Step 6: Verify the server still boots and the suite is green**

Run: `npx tsc -b && npm test`
Expected: `tsc` silent; all suites pass.

- [ ] **Step 7: Commit**

```bash
git add server/observability/taps/express.ts server/observability/taps/express.test.ts server/index.ts
git commit -m "feat(observability): record an incident for every unhandled Express error"
```

---

### Task 6: Client log ingest endpoint

**Files:**
- Create: `server/routes/observability.routes.ts`
- Test: `server/routes/observability.routes.test.ts`
- Modify: `server/routes.ts`
- Modify: `server/index.ts` (default `clientLogLevel` system setting)

**Interfaces:**
- Consumes: `ClientLogBatchSchema`, `ClientIncidentReportSchema` from `@shared/observability`; `recordIncident`.
- Produces: default-exported `router` mounted at the app root, serving `POST /api/client-logs` and `POST /api/incidents`.

- [ ] **Step 1: Write the failing test**

Create `server/routes/observability.routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { configureIncidents } from '../observability/incident';
import { IncidentStore } from '../observability/store';

const logged: { level: string; message: string; meta: Record<string, unknown> }[] = [];

vi.mock('../logger', () => {
  const record = (level: string) => (message: string, meta: Record<string, unknown> = {}) =>
    logged.push({ level, message, meta });
  return {
    default: Promise.resolve({
      error: record('error'), warn: record('warn'), info: record('info'),
      http: record('http'), debug: record('debug'), verbose: record('verbose'),
      log: (level: string, message: string, meta: Record<string, unknown> = {}) =>
        logged.push({ level, message, meta }),
    }),
    updateLogLevel: vi.fn(),
  };
});

let root: string;
let app: express.Application;
let authenticated = true;

beforeEach(async () => {
  logged.length = 0;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-ingest-'));
  configureIncidents({ rootDir: root, logger: { error: () => {} } });

  app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: unknown }).user = authenticated ? { id: 7 } : undefined;
    req.isAuthenticated = (() => authenticated) as never;
    next();
  });
  const { default: router } = await import('./observability.routes');
  app.use(router);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  authenticated = true;
});

describe('POST /api/client-logs', () => {
  it('re-emits each entry through the server logger', async () => {
    const response = await request(app).post('/api/client-logs').send({
      sessionId: 's-1',
      entries: [
        { level: 'info', message: 'navigation', clientTs: '2026-07-26T10:00:00.000Z', correlationId: 'c-1', meta: { to: '/dashboard' } },
        { level: 'error', message: 'mutation failed', clientTs: '2026-07-26T10:00:01.000Z', correlationId: 'c-1' },
      ],
    });

    expect(response.status).toBe(202);
    expect(logged.filter((l) => l.message.startsWith('[client]'))).toHaveLength(2);
    expect(logged[0].meta).toMatchObject({ sessionId: 's-1', correlationId: 'c-1', source: 'client' });
  });

  it('reports dropped entries so loss is visible', async () => {
    await request(app).post('/api/client-logs').send({
      sessionId: 's-1',
      dropped: 12,
      entries: [{ level: 'warn', message: 'x', clientTs: '2026-07-26T10:00:00.000Z' }],
    });

    expect(logged.some((l) => l.message.includes('dropped 12'))).toBe(true);
  });

  it('rejects a malformed batch', async () => {
    const response = await request(app).post('/api/client-logs').send({ sessionId: 's-1', entries: [] });
    expect(response.status).toBe(400);
  });

  it('rejects an oversized batch', async () => {
    const entries = Array.from({ length: 101 }, () => ({
      level: 'info' as const, message: 'x', clientTs: '2026-07-26T10:00:00.000Z',
    }));
    const response = await request(app).post('/api/client-logs').send({ sessionId: 's-1', entries });
    expect(response.status).toBe(400);
  });

  it('accepts anonymous requests outside production so the login page is not blind', async () => {
    authenticated = false;
    const response = await request(app).post('/api/client-logs').send({
      sessionId: 's-1',
      entries: [{ level: 'error', message: 'login blew up', clientTs: '2026-07-26T10:00:00.000Z' }],
    });

    expect(response.status).toBe(202);
  });
});

describe('POST /api/incidents', () => {
  it('records a client-runtime incident carrying the component stack', async () => {
    const response = await request(app).post('/api/incidents').send({
      sessionId: 's-1',
      correlationId: 'c-9',
      route: '/dashboard/create-test',
      name: 'TypeError',
      message: 'Cannot read properties of undefined (reading \'map\')',
      stack: 'TypeError: Cannot read properties of undefined\n    at Toaster (/src/components/ui/toaster.tsx:16:15)',
      componentStack: '\n    at Toaster\n    at App',
      breadcrumbs: [{ type: 'click', target: '#execute' }],
    });

    expect(response.status).toBe(202);
    expect(response.body.incidentId).toMatch(/^inc_/);

    const store = new IncidentStore(root);
    const incident = await store.read(response.body.incidentId);
    expect(incident!.kind).toBe('client-runtime');
    expect(incident!.trigger).toMatchObject({ route: '/dashboard/create-test' });
    expect(incident!.breadcrumbs).toEqual([{ type: 'click', target: '#execute' }]);
  });

  it('rejects a malformed report', async () => {
    const response = await request(app).post('/api/incidents').send({ sessionId: 's-1' });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- server/routes/observability.routes.test.ts`
Expected: FAIL — `Cannot find module './observability.routes'`.

- [ ] **Step 3: Implement the router**

Create `server/routes/observability.routes.ts`:

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import loggerPromise from '../logger';
import { ClientLogBatchSchema, ClientIncidentReportSchema } from '@shared/observability';
import { recordIncident } from '../observability/incident';

const router = Router();
const logger = await loggerPromise;

const isProduction = process.env.NODE_ENV === 'production';

/**
 * The login page is the one screen a user can be on while unauthenticated, and it is
 * exactly where a broken build shows up first. Outside production the endpoints accept
 * anonymous reports; in production they stay closed, because an open disk-writing
 * endpoint is a disk-exhaustion and log-injection vector.
 */
function allowAnonymousOutsideProduction(req: Request, res: Response, next: NextFunction): void {
  if (!isProduction) return next();
  if (req.isAuthenticated?.() && req.user) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 100000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many log batches, slow down.' },
});

router.post(
  '/api/client-logs',
  allowAnonymousOutsideProduction,
  ingestLimiter,
  (req: Request, res: Response) => {
    const parsed = ClientLogBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid log batch', details: parsed.error.flatten() });
    }

    const { sessionId, entries, dropped } = parsed.data;
    const userId = (req as Request & { user?: { id?: number } }).user?.id;

    for (const entry of entries) {
      // Re-emitted at the browser's own level so the file reads as one interleaved stream.
      logger.log(entry.level, `[client] ${entry.message}`, {
        source: 'client',
        sessionId,
        userId,
        correlationId: entry.correlationId,
        route: entry.route,
        clientTs: entry.clientTs,
        ...entry.meta,
      });
    }

    if (dropped && dropped > 0) {
      logger.warn(`[client] buffer overflow, dropped ${dropped} entries`, { source: 'client', sessionId });
    }

    res.status(202).json({ accepted: entries.length });
  },
);

router.post(
  '/api/incidents',
  allowAnonymousOutsideProduction,
  ingestLimiter,
  async (req: Request, res: Response) => {
    const parsed = ClientIncidentReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid incident report', details: parsed.error.flatten() });
    }

    const report = parsed.data;
    const error = new Error(report.message);
    error.name = report.name;
    error.stack = report.stack ?? `${report.name}: ${report.message}`;

    const incident = await recordIncident({
      kind: 'client-runtime',
      error,
      trigger: {
        route: report.route,
        componentStack: report.componentStack,
        props: report.props,
      },
      correlationId: report.correlationId,
      sessionId: report.sessionId,
      userId: (req as Request & { user?: { id?: number } }).user?.id,
      breadcrumbs: report.breadcrumbs,
    });

    res.status(202).json({ incidentId: incident?.id ?? null });
  },
);

export default router;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- server/routes/observability.routes.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Mount the router**

In `server/routes.ts`, next to the other `app.use(...)` router registrations (around line
77, after `app.use(authRoutes)`), add the import at the top with the other route imports:

```ts
import observabilityRoutes from "./routes/observability.routes";
```

and the registration alongside the others:

```ts
    app.use(observabilityRoutes);
```

- [ ] **Step 6: Add the `clientLogLevel` default setting**

In `server/index.ts`, inside `ensureDefaultSystemSettings`, extend `settingsToEnsure`:

```ts
    const settingsToEnsure = [
      { key: 'logRetentionDays', value: process.env.LOG_RETENTION_DAYS || '7' },
      { key: 'logLevel', value: process.env.LOG_LEVEL || 'info' },
      // Separate from logLevel on purpose: turning the server up to debug should not also
      // flood the ingest endpoint with browser traffic.
      { key: 'clientLogLevel', value: process.env.CLIENT_LOG_LEVEL || 'info' },
    ];
```

- [ ] **Step 7: Verify**

Run: `npx tsc -b && npm test`
Expected: `tsc` silent; all suites pass.

- [ ] **Step 8: Commit**

```bash
git add server/routes/observability.routes.ts server/routes/observability.routes.test.ts \
        server/routes.ts server/index.ts
git commit -m "feat(observability): client log and incident ingest endpoints"
```

---

### Task 7: Client logger and correlation headers

**Files:**
- Create: `client/src/observability/session.ts`
- Create: `client/src/observability/logger.ts`
- Test: `client/src/observability/logger.test.ts`
- Modify: `client/src/lib/queryClient.ts`

**Interfaces:**
- Consumes: `ClientLogEntry`, `ClientLogLevel` from `@shared/observability`.
- Produces: from `session.ts` — `getSessionId(): string`, `newCorrelationId(): string`; from `logger.ts` — `clientLogger` object with `error/warn/info/http/debug(message: string, meta?: Record<string, unknown>): void`, plus `setLogLevel(level: ClientLogLevel): void`, `setCurrentRoute(route: string): void`, `setCurrentCorrelationId(correlationId: string | undefined): void`, `flushNow(): Promise<void>`, `__resetForTests(): void`.

- [ ] **Step 1: Write the session helper**

Create `client/src/observability/session.ts`:

```ts
const SESSION_KEY = 'wfm:sessionId';

const randomId = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * One id per browser tab, surviving reloads within the tab. Used to stitch a whole user
 * journey together across separate actions.
 */
export function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = randomId('s');
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    // Private mode or storage disabled: an in-memory id is still better than none.
    return randomId('s');
  }
}

/** One id per user action / API call. Sent as X-Correlation-Id and adopted by the server. */
export function newCorrelationId(): string {
  return randomId('c');
}
```

- [ ] **Step 2: Write the failing logger test**

Create `client/src/observability/logger.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clientLogger, setLogLevel, flushNow, __resetForTests } from './logger';

const postedBatches = () =>
  vi.mocked(globalThis.fetch).mock.calls
    .filter(([url]) => String(url) === '/api/client-logs')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

beforeEach(() => {
  __resetForTests();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 202 })));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('clientLogger', () => {
  it('flushes an error immediately', async () => {
    clientLogger.error('mutation failed', { key: 'startRecording' });
    await flushNow();

    const [batch] = postedBatches();
    expect(batch.entries).toHaveLength(1);
    expect(batch.entries[0]).toMatchObject({ level: 'error', message: 'mutation failed' });
    expect(batch.sessionId).toBeTruthy();
  });

  it('buffers below the level threshold instead of sending', async () => {
    setLogLevel('warn');
    clientLogger.debug('noisy');
    clientLogger.info('also noisy');
    await flushNow();

    expect(postedBatches()).toHaveLength(0);
  });

  it('flushes on the timer', async () => {
    vi.useFakeTimers();
    __resetForTests();
    clientLogger.info('navigation');

    await vi.advanceTimersByTimeAsync(3100);

    expect(postedBatches()[0].entries[0].message).toBe('navigation');
  });

  it('flushes once the batch size is reached', async () => {
    for (let i = 0; i < 25; i++) clientLogger.info(`entry ${i}`);
    await flushNow();

    expect(postedBatches()[0].entries).toHaveLength(25);
  });

  it('drops the oldest past the buffer cap and reports the count', async () => {
    setLogLevel('debug');
    for (let i = 0; i < 250; i++) clientLogger.debug(`entry ${i}`);
    await flushNow();

    const batches = postedBatches();
    const total = batches.reduce((sum, b) => sum + b.entries.length, 0);
    expect(total).toBeLessThanOrEqual(200);
    expect(batches.some((b) => (b.dropped ?? 0) > 0)).toBe(true);
  });

  it('never recurses when the transport keeps failing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    clientLogger.error('first failure');
    await flushNow();
    await flushNow();
    await flushNow();
    await flushNow();

    // Bounded retries, then the batch is abandoned — never an ever-growing storm.
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('sends the buffer with sendBeacon on page dismissal', () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });

    clientLogger.info('about to leave');
    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledWith('/api/client-logs', expect.anything());
  });

  it('never throws out of a log call', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => clientLogger.info('still fine')).not.toThrow();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --prefix client -- src/observability/logger.test.ts`
Expected: FAIL — cannot resolve `./logger`.

- [ ] **Step 4: Implement the logger**

Create `client/src/observability/logger.ts`:

```ts
import type { ClientLogEntry, ClientLogLevel } from '@shared/observability';
import { getSessionId } from './session';

const LEVEL_ORDER: Record<ClientLogLevel, number> = {
  error: 0, warn: 1, info: 2, http: 3, debug: 4,
};

const INGEST_URL = '/api/client-logs';
const FLUSH_INTERVAL_MS = 3000;
const FLUSH_AT_ENTRIES = 25;
const MAX_BUFFER = 200;
const MAX_RETRIES = 3;

let level: ClientLogLevel = 'info';
let buffer: ClientLogEntry[] = [];
let dropped = 0;
let retries = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let currentRoute = '';
let currentCorrelationId: string | undefined;

export function setLogLevel(next: ClientLogLevel): void {
  level = next;
}

/** Called by the router hook so every entry carries the page it came from. */
export function setCurrentRoute(route: string): void {
  currentRoute = route;
}

/** Called by the request wrapper so log lines join the server trace. */
export function setCurrentCorrelationId(correlationId: string | undefined): void {
  currentCorrelationId = correlationId;
}

function payload(): string {
  return JSON.stringify({ sessionId: getSessionId(), entries: buffer, dropped });
}

function ensureTimer(): void {
  if (timer !== null) return;
  timer = setInterval(() => { void flushNow(); }, FLUSH_INTERVAL_MS);
  // Do not hold a Node test process open.
  (timer as unknown as { unref?: () => void }).unref?.();
}

/**
 * Sends whatever is buffered. Errors here go to the console, never back through the
 * logger — a failing transport that logs its own failure is an infinite loop.
 */
export async function flushNow(): Promise<void> {
  if (buffer.length === 0) return;
  if (typeof fetch !== 'function') return;

  const body = payload();
  const sent = buffer;
  buffer = [];
  const sentDropped = dropped;
  dropped = 0;

  try {
    await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'include',
      keepalive: true,
    });
    retries = 0;
  } catch (error) {
    retries += 1;
    if (retries <= MAX_RETRIES) {
      buffer = [...sent, ...buffer].slice(-MAX_BUFFER);
      dropped += sentDropped;
    } else {
      // Give up rather than accumulate forever.
      console.warn('[observability] dropping client log batch after repeated failures', error);
      retries = 0;
    }
  }
}

function enqueue(entryLevel: ClientLogLevel, message: string, meta?: Record<string, unknown>): void {
  try {
    if (LEVEL_ORDER[entryLevel] > LEVEL_ORDER[level]) return;

    buffer.push({
      level: entryLevel,
      message: String(message).slice(0, 2000),
      clientTs: new Date().toISOString(),
      correlationId: currentCorrelationId,
      route: currentRoute || undefined,
      meta,
    });

    if (buffer.length > MAX_BUFFER) {
      dropped += buffer.length - MAX_BUFFER;
      buffer = buffer.slice(-MAX_BUFFER);
    }

    ensureTimer();
    if (entryLevel === 'error' || buffer.length >= FLUSH_AT_ENTRIES) void flushNow();
  } catch (error) {
    console.warn('[observability] client logger failed', error);
  }
}

export const clientLogger = {
  error: (message: string, meta?: Record<string, unknown>) => enqueue('error', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => enqueue('warn', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => enqueue('info', message, meta),
  http: (message: string, meta?: Record<string, unknown>) => enqueue('http', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => enqueue('debug', message, meta),
};

/**
 * `fetch` is cancelled during page dismissal; sendBeacon is the only transport the browser
 * guarantees, and dismissal is exactly when the interesting error would otherwise be lost.
 */
function flushWithBeacon(): void {
  try {
    if (buffer.length === 0 || typeof navigator?.sendBeacon !== 'function') return;
    const blob = new Blob([payload()], { type: 'application/json' });
    navigator.sendBeacon(INGEST_URL, blob);
    buffer = [];
    dropped = 0;
  } catch {
    // Nothing useful can be done while the page is going away.
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushWithBeacon);
}

/** Test seam: clears module state between cases. */
export function __resetForTests(): void {
  buffer = [];
  dropped = 0;
  retries = 0;
  level = 'info';
  currentRoute = '';
  currentCorrelationId = undefined;
  if (timer !== null) { clearInterval(timer); timer = null; }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm test --prefix client -- src/observability/logger.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Send correlation headers and log every call**

Replace the body of `apiRequest` and `getQueryFn` in `client/src/lib/queryClient.ts` with:

```ts
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { clientLogger, setCurrentCorrelationId } from "@/observability/logger";
import { getSessionId, newCorrelationId } from "@/observability/session";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

/** Correlation headers let a UI action and the server work it triggers share one id. */
function tracingHeaders(correlationId: string): Record<string, string> {
  return { "X-Correlation-Id": correlationId, "X-Session-Id": getSessionId() };
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const correlationId = newCorrelationId();
  setCurrentCorrelationId(correlationId);
  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...tracingHeaders(correlationId),
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    clientLogger.http(`${method} ${url}`, {
      status: res.status,
      durationMs: Date.now() - startedAt,
    });

    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    clientLogger.error(`${method} ${url} failed`, {
      durationMs: Date.now() - startedAt,
      message: (error as Error).message,
    });
    throw error;
  } finally {
    setCurrentCorrelationId(undefined);
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey[0] as string;
    const correlationId = newCorrelationId();
    setCurrentCorrelationId(correlationId);
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: tracingHeaders(correlationId),
      });

      clientLogger.http(`GET ${url}`, { status: res.status, durationMs: Date.now() - startedAt });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error) {
      // A failed query is an error-level event, not just an http line with a 5xx status.
      clientLogger.error(`GET ${url} failed`, {
        durationMs: Date.now() - startedAt,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      setCurrentCorrelationId(undefined);
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
```

- [ ] **Step 7: Verify the whole client suite still passes**

Run: `npm test --prefix client`
Expected: all files pass. Existing tests that mock `@/lib/queryClient` are unaffected;
`SaveTestModal.test.tsx` and `dashboard-page-new.test.tsx` mock `apiRequest` directly, so
the new headers do not reach them.

- [ ] **Step 8: Commit**

```bash
git add client/src/observability/session.ts client/src/observability/logger.ts \
        client/src/observability/logger.test.ts client/src/lib/queryClient.ts
git commit -m "feat(observability): buffered client logger and correlation headers"
```

---

### Task 8: Error boundary, global handlers and client breadcrumbs

**Files:**
- Create: `client/src/observability/breadcrumbs.ts`
- Create: `client/src/observability/error-boundary.tsx`
- Create: `client/src/observability/install.ts`
- Test: `client/src/observability/error-boundary.test.tsx`
- Test: `client/src/observability/install.test.ts`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `clientLogger`, `setCurrentRoute`, `getSessionId`, `newCorrelationId`.
- Produces: from `breadcrumbs.ts` — `pushBreadcrumb(crumb: Record<string, unknown>): void`, `takeBreadcrumbs(): Record<string, unknown>[]`, `__resetBreadcrumbs(): void`; from `error-boundary.tsx` — `ObservabilityErrorBoundary` React component with props `{ children: React.ReactNode }`; from `install.ts` — `installObservability(): void`, `reportClientIncident(input: { name: string; message: string; stack?: string; componentStack?: string; props?: Record<string, unknown> }): void`.

- [ ] **Step 1: Implement client breadcrumbs**

Create `client/src/observability/breadcrumbs.ts`:

```ts
const MAX_BREADCRUMBS = 50;

let ring: Record<string, unknown>[] = [];

/** Bounded trail of what the user did; attached to an incident, never streamed. */
export function pushBreadcrumb(crumb: Record<string, unknown>): void {
  try {
    ring.push({ ts: new Date().toISOString(), ...crumb });
    if (ring.length > MAX_BREADCRUMBS) ring = ring.slice(-MAX_BREADCRUMBS);
  } catch {
    // A breadcrumb is never worth an exception.
  }
}

export function takeBreadcrumbs(): Record<string, unknown>[] {
  return [...ring];
}

export function __resetBreadcrumbs(): void {
  ring = [];
}
```

- [ ] **Step 2: Write the failing error-boundary test**

Create `client/src/observability/error-boundary.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObservabilityErrorBoundary } from './error-boundary';

const mockReport = vi.fn();
vi.mock('./install', () => ({
  reportClientIncident: (...args: unknown[]) => mockReport(...args),
  installObservability: vi.fn(),
}));

const Boom: React.FC = () => {
  throw new TypeError("Cannot read properties of undefined (reading 'map')");
};

beforeEach(() => {
  mockReport.mockClear();
  // React logs the caught error; silence it so the run stays readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('ObservabilityErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ObservabilityErrorBoundary>
        <p>all good</p>
      </ObservabilityErrorBoundary>,
    );

    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('reports the error with its component stack and shows a fallback', () => {
    render(
      <ObservabilityErrorBoundary>
        <Boom />
      </ObservabilityErrorBoundary>,
    );

    expect(mockReport).toHaveBeenCalledTimes(1);
    const report = mockReport.mock.calls[0][0];
    expect(report.name).toBe('TypeError');
    expect(report.componentStack).toContain('Boom');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --prefix client -- src/observability/error-boundary.test.tsx`
Expected: FAIL — cannot resolve `./error-boundary`.

- [ ] **Step 4: Implement the error boundary**

Create `client/src/observability/error-boundary.tsx`:

```tsx
import React from 'react';
import { reportClientIncident } from './install';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes, reports them as incidents, and shows a plain fallback.
 *
 * Without this a thrown render unmounts the whole tree and leaves a blank page with no
 * trace anywhere — the single largest blind spot in the app today.
 */
export class ObservabilityErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportClientIncident({
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    });
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="m-6 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive">
        <p className="font-semibold">Something went wrong on this page.</p>
        <p className="mt-1 text-sm">
          The error has been recorded. Reload the page to continue.
        </p>
        <pre className="mt-3 max-h-40 overflow-auto text-xs opacity-80">{this.state.error.message}</pre>
      </div>
    );
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm test --prefix client -- src/observability/error-boundary.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Write the failing install test**

Create `client/src/observability/install.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installObservability, reportClientIncident } from './install';
import { pushBreadcrumb, takeBreadcrumbs, __resetBreadcrumbs } from './breadcrumbs';

const posted = () =>
  vi.mocked(globalThis.fetch).mock.calls
    .filter(([url]) => String(url) === '/api/incidents')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

beforeEach(() => {
  __resetBreadcrumbs();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incidentId: 'inc_abc123' }), { status: 202 })));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reportClientIncident', () => {
  it('posts the report with session, breadcrumbs and route', async () => {
    pushBreadcrumb({ type: 'click', target: '#execute' });

    reportClientIncident({ name: 'TypeError', message: 'boom', stack: 'TypeError: boom\n    at x' });
    await vi.waitFor(() => expect(posted()).toHaveLength(1));

    const [report] = posted();
    expect(report).toMatchObject({ name: 'TypeError', message: 'boom' });
    expect(report.sessionId).toBeTruthy();
    expect(report.breadcrumbs).toEqual([expect.objectContaining({ type: 'click', target: '#execute' })]);
  });

  it('never throws when the transport is unavailable', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => reportClientIncident({ name: 'Error', message: 'x' })).not.toThrow();
  });
});

describe('installObservability', () => {
  it('reports an unhandled rejection', async () => {
    installObservability();

    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('promise blew up') }),
    );

    await vi.waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].message).toBe('promise blew up');
  });

  it('records a click breadcrumb carrying a usable target', () => {
    installObservability();
    const button = document.createElement('button');
    button.id = 'execute';
    document.body.appendChild(button);

    button.click();

    expect(takeBreadcrumbs()).toContainEqual(expect.objectContaining({ type: 'click', target: '#execute' }));
    button.remove();
  });

  it('is idempotent', () => {
    installObservability();
    installObservability();
    const button = document.createElement('button');
    button.id = 'once';
    document.body.appendChild(button);

    button.click();

    expect(takeBreadcrumbs().filter((c) => c.type === 'click')).toHaveLength(1);
    button.remove();
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm test --prefix client -- src/observability/install.test.ts`
Expected: FAIL — cannot resolve `./install`.

- [ ] **Step 8: Implement install**

Create `client/src/observability/install.ts`:

```ts
import type { ClientIncidentReport } from '@shared/observability';
import { clientLogger, setLogLevel } from './logger';
import { getSessionId, newCorrelationId } from './session';
import { pushBreadcrumb, takeBreadcrumbs } from './breadcrumbs';
import type { ClientLogLevel } from '@shared/observability';

const INCIDENT_URL = '/api/incidents';

let installed = false;

/** A short, stable-ish description of what was clicked. Never captures field values. */
function describeTarget(element: Element | null): string | undefined {
  if (!element) return undefined;
  if (element.id) return `#${element.id}`;
  const testId = element.getAttribute('data-testid');
  if (testId) return `[data-testid="${testId}"]`;
  const label = element.getAttribute('aria-label');
  if (label) return `${element.tagName.toLowerCase()}[aria-label="${label}"]`;
  const text = (element.textContent ?? '').trim().slice(0, 40);
  return text ? `${element.tagName.toLowerCase()}:"${text}"` : element.tagName.toLowerCase();
}

export function reportClientIncident(input: {
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  props?: Record<string, unknown>;
}): void {
  try {
    if (typeof fetch !== 'function') return;

    const report: ClientIncidentReport = {
      sessionId: getSessionId(),
      correlationId: newCorrelationId(),
      route: typeof location !== 'undefined' ? location.pathname : undefined,
      name: input.name,
      message: input.message,
      stack: input.stack,
      componentStack: input.componentStack,
      props: input.props,
      breadcrumbs: takeBreadcrumbs(),
    };

    // Logged too, so the log file itself shows the failure and not just the artifact.
    clientLogger.error(`${input.name}: ${input.message}`, { componentStack: input.componentStack });

    void fetch(INCIDENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      credentials: 'include',
      keepalive: true,
    }).catch((error) => {
      console.warn('[observability] failed to report incident', error);
    });
  } catch (error) {
    console.warn('[observability] failed to build incident report', error);
  }
}

/** Reads the configured client level; falls back silently to the compiled default. */
async function applyConfiguredLevel(): Promise<void> {
  try {
    const override = localStorage.getItem('wfm:logLevel') as ClientLogLevel | null;
    if (override) {
      setLogLevel(override);
      return;
    }
    const res = await fetch('/api/system-settings/clientLogLevel', { credentials: 'include' });
    if (!res.ok) return;
    const setting = (await res.json()) as { value?: string } | null;
    if (setting?.value) setLogLevel(setting.value as ClientLogLevel);
  } catch {
    // Keep the default; the level is a convenience, not a requirement.
  }
}

/** Idempotent: safe to call from a component that may remount. */
export function installObservability(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  try {
    window.addEventListener('error', (event: ErrorEvent) => {
      reportClientIncident({
        name: event.error?.name ?? 'Error',
        message: event.message,
        stack: event.error?.stack,
      });
    });

    window.addEventListener('unhandledrejection', (event: Event) => {
      const reason = (event as PromiseRejectionEvent).reason;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      reportClientIncident({ name: error.name, message: error.message, stack: error.stack });
    });

    document.addEventListener(
      'click',
      (event) => {
        pushBreadcrumb({ type: 'click', target: describeTarget(event.target as Element) });
      },
      true,
    );

    document.addEventListener(
      'focusin',
      (event) => {
        // Field identity only — never the value.
        pushBreadcrumb({ type: 'focus', target: describeTarget(event.target as Element) });
      },
      true,
    );

    void applyConfiguredLevel();
  } catch (error) {
    console.warn('[observability] install failed; continuing without it', error);
  }
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npm test --prefix client -- src/observability/install.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 10: Wire into the app**

In `client/src/App.tsx`, add the imports:

```tsx
import { ObservabilityErrorBoundary } from "@/observability/error-boundary";
import { installObservability } from "@/observability/install";
import { setCurrentRoute } from "@/observability/logger";
import { pushBreadcrumb } from "@/observability/breadcrumbs";
```

Add a route-tracking component next to `SettingsEffectLoader`:

```tsx
/** Keeps the client logger's route field current and drops a breadcrumb per navigation. */
const RouteTracker = () => {
  const [location] = useLocation();

  useEffect(() => {
    setCurrentRoute(location);
    pushBreadcrumb({ type: 'navigation', to: location });
  }, [location]);

  return null;
};
```

Replace the body of `App` with:

```tsx
function App() {
  useEffect(() => {
    installObservability();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SettingsEffectLoader />
        <RouteTracker />
        <TooltipProvider>
          <DragDropProvider>
            <Toaster />
            <ObservabilityErrorBoundary>
              <Router />
            </ObservabilityErrorBoundary>
          </DragDropProvider>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 11: Verify**

Run: `npx tsc -b && npm test --prefix client`
Expected: `tsc` silent; all client suites pass.

- [ ] **Step 12: Commit**

```bash
git add client/src/observability/ client/src/App.tsx
git commit -m "feat(observability): error boundary, global handlers and client breadcrumbs"
```

---

### Task 9: Job and runner taps

**Files:**
- Create: `server/observability/taps/jobs.ts`
- Create: `server/observability/taps/runner.ts`
- Test: `server/observability/taps/jobs.test.ts`
- Test: `server/observability/taps/runner.test.ts`
- Modify: `server/worker.ts:18-59`
- Modify: `server/playwright-service.ts` (recording-session and ad-hoc catch blocks)

**Interfaces:**
- Consumes: `recordIncident`.
- Produces: `withJobIncidents<T>(handler: (job: T) => Promise<void>): (job: T) => Promise<void>` where `T` is structurally `{ id?: string | number; name: string; data: unknown; attemptsMade?: number }`; `recordRunnerFailure(input: { phase: string; error: unknown; context: Record<string, unknown>; correlationId?: string; userId?: number }): void`.

- [ ] **Step 1: Write the failing tests**

Create `server/observability/taps/jobs.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withJobIncidents } from './jobs';
import { configureIncidents } from '../incident';
import { IncidentStore } from '../store';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-jobs-'));
  configureIncidents({ rootDir: root, logger: { error: () => {} } });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('withJobIncidents', () => {
  it('passes a successful job through untouched', async () => {
    const seen: string[] = [];
    const wrapped = withJobIncidents(async (job: { id: string; name: string; data: unknown }) => {
      seen.push(job.name);
    });

    await wrapped({ id: '1', name: 'execute-plan', data: {} });

    expect(seen).toEqual(['execute-plan']);
    expect(await new IncidentStore(root).readIndex()).toHaveLength(0);
  });

  it('records an incident and rethrows so BullMQ still fails the job', async () => {
    const wrapped = withJobIncidents(async () => {
      throw new Error('processTestPlanJob exploded');
    });

    await expect(
      wrapped({ id: '9', name: 'execute-plan', data: { planId: 'p1' }, attemptsMade: 2 }),
    ).rejects.toThrow('processTestPlanJob exploded');

    const store = new IncidentStore(root);
    const [entry] = await store.readIndex();
    const incident = await store.read(entry.id);

    expect(incident!.kind).toBe('job');
    expect(incident!.trigger).toMatchObject({ jobName: 'execute-plan', jobData: { planId: 'p1' }, attemptsMade: 2 });
  });
});
```

Create `server/observability/taps/runner.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordRunnerFailure } from './runner';
import { configureIncidents } from '../incident';
import { IncidentStore } from '../store';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-runner-'));
  configureIncidents({ rootDir: root, logger: { error: () => {} } });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('recordRunnerFailure', () => {
  it('records the phase and context', async () => {
    recordRunnerFailure({
      phase: 'browser-launch',
      error: new Error('Failed to launch browser for recording.'),
      context: { browserType: 'chromium', url: 'https://app.test' },
    });
    await settle();

    const store = new IncidentStore(root);
    const [entry] = await store.readIndex();
    const incident = await store.read(entry.id);

    expect(incident!.kind).toBe('runner');
    expect(incident!.trigger).toMatchObject({ phase: 'browser-launch', browserType: 'chromium' });
  });

  it('accepts a non-Error rejection without throwing', async () => {
    expect(() =>
      recordRunnerFailure({ phase: 'goto', error: 'string failure', context: {} }),
    ).not.toThrow();
    await settle();

    const [entry] = await new IncidentStore(root).readIndex();
    expect(entry.title).toContain('string failure');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- server/observability/taps/jobs.test.ts server/observability/taps/runner.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both taps**

Create `server/observability/taps/jobs.ts`:

```ts
import { getCorrelationId } from '../../middleware/correlation';
import { recordIncident } from '../incident';

interface JobLike {
  id?: string | number;
  name: string;
  data: unknown;
  attemptsMade?: number;
}

/**
 * Wraps a BullMQ handler so a failure produces an incident and still propagates —
 * swallowing it here would make BullMQ think the job succeeded.
 */
export function withJobIncidents<T extends JobLike>(
  handler: (job: T) => Promise<void>,
): (job: T) => Promise<void> {
  return async (job: T) => {
    try {
      await handler(job);
    } catch (error) {
      await recordIncident({
        kind: 'job',
        error: error instanceof Error ? error : new Error(String(error)),
        trigger: {
          jobId: job.id,
          jobName: job.name,
          jobData: job.data,
          attemptsMade: job.attemptsMade,
        },
        correlationId: getCorrelationId(),
      });
      throw error;
    }
  };
}
```

Create `server/observability/taps/runner.ts`:

```ts
import { getCorrelationId } from '../../middleware/correlation';
import { recordIncident } from '../incident';

/**
 * Reports an infrastructure failure of the test runner — a browser that will not launch, a
 * dead recording session, an unreachable precondition.
 *
 * Deliberately NOT called for a UI test that fails its assertions: that is a normal product
 * outcome, and recording it would bury the real defects.
 */
export function recordRunnerFailure(input: {
  phase: string;
  error: unknown;
  context: Record<string, unknown>;
  correlationId?: string;
  userId?: number;
}): void {
  void recordIncident({
    kind: 'runner',
    error: input.error instanceof Error ? input.error : new Error(String(input.error)),
    trigger: { phase: input.phase, ...input.context },
    correlationId: input.correlationId ?? getCorrelationId(),
    userId: input.userId,
  });
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npm test -- server/observability/taps/jobs.test.ts server/observability/taps/runner.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wrap the worker handler**

In `server/worker.ts`, add the import after the existing imports:

```ts
import { withJobIncidents } from './observability/taps/jobs';
```

Then wrap the handler passed to `new Worker(...)`. The handler currently begins
`async (job: Job) => {` on line 18 and ends with `}` before `{ connection, concurrency: 1 }`.
Change the opening to:

```ts
    withJobIncidents(async (job: Job) => {
```

and the closing to:

```ts
    }),
    { connection, concurrency: 1 } // concurrency: 1 for safety with Playwright initially
```

- [ ] **Step 6: Report runner infrastructure failures**

In `server/playwright-service.ts`, add the import next to the other local imports:

```ts
import { recordRunnerFailure } from './observability/taps/runner';
```

In the `catch` block of `startRecordingSession`, immediately after the existing
`resolvedLogger.error({ message: "PS:startRecordingSession - CRITICAL ERROR during session setup", ... })`
call, add:

```ts
      recordRunnerFailure({
        phase: `recording:${stage}`,
        error,
        context: { sessionId, url, browserType },
        userId,
      });
```

In the outer `catch` block of `executeAdhocSequence`, immediately after the existing
`resolvedLogger.error({ message: "PS:executeAdhocSequence - CRITICAL ERROR in executeAdhocSequence", ... })`
call, add:

```ts
      recordRunnerFailure({
        phase: 'adhoc-execution',
        error,
        context: { testName, url: payload.url, stepCount: payload.sequence?.length ?? 0 },
        userId,
      });
```

- [ ] **Step 7: Verify**

Run: `npx tsc -b && npm test`
Expected: `tsc` silent; all server suites pass, including the recorder browser test.

- [ ] **Step 8: Commit**

```bash
git add server/observability/taps/jobs.ts server/observability/taps/jobs.test.ts \
        server/observability/taps/runner.ts server/observability/taps/runner.test.ts \
        server/worker.ts server/playwright-service.ts
git commit -m "feat(observability): job and runner infrastructure taps"
```

---

### Task 10: Reproduction generator

**Files:**
- Create: `server/observability/repro.ts`
- Test: `server/observability/repro.test.ts`
- Modify: `server/observability/incident.ts`

**Interfaces:**
- Consumes: `Incident`, `IncidentRepro` from `@shared/observability`.
- Produces: `generateRepro(incident: Incident, repoRoot: string): Promise<IncidentRepro>`; `REPRO_COMMAND = "npx vitest run --include '**/*.repro.ts'"`.

- [ ] **Step 1: Write the failing test**

Create `server/observability/repro.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateRepro, REPRO_COMMAND } from './repro';
import type { Incident } from '../../shared/observability';

let repoRoot: string;

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'inc_aaaaaa',
  fingerprint: 'aaaaaa',
  kind: 'server-api',
  status: 'open',
  count: 1,
  firstSeen: '2026-07-26T10:00:00.000Z',
  lastSeen: '2026-07-26T10:00:00.000Z',
  title: 'TypeError: boom',
  origin: { file: 'server/x.ts', line: 10, column: 1, functionName: 'run', source: [] },
  error: { name: 'TypeError', message: 'boom', frames: [] },
  trigger: { method: 'POST', path: '/api/execute-test-direct', body: { url: 'https://x.test' }, userId: 7 },
  state: {},
  breadcrumbs: [],
  occurrences: [],
  ...overrides,
});

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-repro-'));
});

afterEach(() => fs.rmSync(repoRoot, { recursive: true, force: true }));

const contentOf = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

describe('generateRepro', () => {
  it('writes a high-confidence supertest reproduction for a server-api incident', async () => {
    const repro = await generateRepro(incident(), repoRoot);

    expect(repro.confidence).toBe('high');
    expect(repro.path).toBe('server/__repro__/inc_aaaaaa.repro.ts');
    expect(repro.command).toBe(REPRO_COMMAND);

    const content = contentOf(repro.path);
    expect(content).toContain("'/api/execute-test-direct'");
    expect(content).toContain('registerRoutes');
    expect(content).toContain('expect(response.status).toBeLessThan(500)');
    expect(content).toContain('inc_aaaaaa');
  });

  it('writes a job reproduction calling the handler with the captured data', async () => {
    const repro = await generateRepro(
      incident({ kind: 'job', trigger: { jobName: 'execute-plan', jobData: { planId: 'p1' } } }),
      repoRoot,
    );

    expect(repro.confidence).toBe('high');
    expect(contentOf(repro.path)).toContain('"planId": "p1"');
  });

  it('marks a client-runtime reproduction as best-effort and puts it under client/', async () => {
    const repro = await generateRepro(
      incident({ kind: 'client-runtime', trigger: { route: '/dashboard', componentStack: '\n    at Toaster' } }),
      repoRoot,
    );

    expect(repro.confidence).toBe('best-effort');
    expect(repro.path).toBe('client/src/__repro__/inc_aaaaaa.repro.ts');
    expect(contentOf(repro.path)).toContain('it.todo');
    expect(contentOf(repro.path)).toContain('at Toaster');
  });

  it('marks a runner reproduction as medium', async () => {
    const repro = await generateRepro(
      incident({ kind: 'runner', trigger: { phase: 'browser-launch', browserType: 'chromium' } }),
      repoRoot,
    );

    expect(repro.confidence).toBe('medium');
    expect(contentOf(repro.path)).toContain('browser-launch');
  });

  it('does not overwrite a reproduction that has been edited by hand', async () => {
    const first = await generateRepro(incident(), repoRoot);
    fs.writeFileSync(path.join(repoRoot, first.path), '// hand written\n', 'utf8');

    await generateRepro(incident(), repoRoot);

    expect(contentOf(first.path)).toBe('// hand written\n');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- server/observability/repro.test.ts`
Expected: FAIL — `Cannot find module './repro'`.

- [ ] **Step 3: Implement the generator**

Create `server/observability/repro.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Incident, IncidentRepro, ReproConfidence } from '../../shared/observability';

/** `.repro.ts` is matched by neither vitest config, so pending reproductions stay out of CI. */
export const REPRO_COMMAND = "npx vitest run --include '**/*.repro.ts'";

const json = (value: unknown): string => JSON.stringify(value ?? null, null, 2);

function header(incident: Incident): string {
  const origin = incident.origin
    ? `${incident.origin.file}:${incident.origin.line}`
    : 'unresolved';
  return `/**
 * Reproduction for ${incident.id} — ${incident.title}
 *
 * Origin:  ${origin}
 * Kind:    ${incident.kind}
 * Seen:    ${incident.count}x, last ${incident.lastSeen}
 *
 * Generated from .observability/incidents/${incident.id}.json.
 * Once the bug is fixed and this passes, rename it to .test.ts to keep it as a
 * permanent regression test.
 */`;
}

function serverApiRepro(incident: Incident): string {
  const trigger = incident.trigger as {
    method?: string; path?: string; body?: unknown; query?: unknown; userId?: number;
  };
  const method = (trigger.method ?? 'GET').toLowerCase();

  return `${header(incident)}
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';

let app: Application;
const mockUser = { id: ${trigger.userId ?? 1}, username: 'repro-user' };

beforeAll(async () => {
  const tempApp = express();
  tempApp.use(express.json());
  tempApp.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = mockUser as never;
    req.isAuthenticated = (() => true) as never;
    next();
  });
  const { registerRoutes } = await import('../routes');
  await registerRoutes(tempApp);
  app = tempApp;
});

describe('${incident.id}: ${incident.title}', () => {
  it('does not fail with a server error', async () => {
    const response = await request(app)
      .${method}('${trigger.path ?? '/'}')
      .send(${json(trigger.body)});

    expect(response.status).toBeLessThan(500);
  });
});
`;
}

function jobRepro(incident: Incident): string {
  const trigger = incident.trigger as { jobName?: string; jobData?: unknown };

  return `${header(incident)}
import { describe, it, expect } from 'vitest';

const jobName = ${json(trigger.jobName)};
const jobData = ${json(trigger.jobData)};

describe('${incident.id}: ${incident.title}', () => {
  it('processes the captured job without throwing', async () => {
    // The worker dispatches on job.name; call the same handler this job reached.
    const { processTestPlanJob } = await import('../test-execution-service');
    const data = jobData as { planId: string; testPlanRunId: string; userId: number };

    await expect(
      processTestPlanJob(data.planId, data.testPlanRunId, data.userId),
    ).resolves.not.toThrow();

    expect(jobName).toBeTruthy();
  });
});
`;
}

function runnerRepro(incident: Incident): string {
  const trigger = incident.trigger as Record<string, unknown>;

  return `${header(incident)}
import { describe, it, expect } from 'vitest';

/**
 * Confidence: medium. The captured phase is "${String(trigger.phase)}"; this may need a
 * real browser, in which case run it on a machine with a display.
 */
const context = ${json(trigger)};

describe('${incident.id}: ${incident.title}', () => {
  // The entry point depends on which phase failed, so the call is left to be written:
  // a generated body that always threw would fail for the wrong reason and tell us nothing.
  it.todo('completes the runner phase that failed');

  it('keeps the captured context available while the reproduction is written', async () => {
    const { PlaywrightService } = await import('../playwright-service');

    expect(new PlaywrightService()).toBeDefined();
    expect(context.phase).toBeTruthy();
  });
});
`;
}

function clientRuntimeRepro(incident: Incident): string {
  const trigger = incident.trigger as { route?: string; componentStack?: string; props?: unknown };
  const crumbs = incident.breadcrumbs
    .map((crumb) => ` *   ${JSON.stringify(crumb)}`)
    .join('\n');

  return `${header(incident)}
/**
 * Confidence: best-effort. A React render crash depends on props, state and hook history,
 * which cannot be fully captured. What is known:
 *
 * Route: ${trigger.route ?? 'unknown'}
 *
 * Component stack:${(trigger.componentStack ?? '').split('\n').map((l) => `\n *   ${l}`).join('')}
 *
 * Breadcrumbs before the crash:
${crumbs || ' *   (none captured)'}
 */
import { describe, it, expect } from 'vitest';

const capturedProps = ${json(trigger.props)};

describe('${incident.id}: ${incident.title}', () => {
  it.todo('renders the failing component with the captured props');

  it('keeps the captured context available while the reproduction is written', () => {
    expect(capturedProps !== undefined).toBe(true);
  });
});
`;
}

/**
 * Writes a reproduction file for an incident and returns where it went.
 *
 * An existing file is never overwritten: once a human or agent has edited a reproduction,
 * a later recurrence must not silently discard that work.
 */
export async function generateRepro(incident: Incident, repoRoot: string): Promise<IncidentRepro> {
  const isClient = incident.kind === 'client-runtime';
  const relativePath = isClient
    ? `client/src/__repro__/${incident.id}.repro.ts`
    : `server/__repro__/${incident.id}.repro.ts`;

  const confidence: ReproConfidence =
    incident.kind === 'client-runtime' ? 'best-effort'
    : incident.kind === 'runner' ? 'medium'
    : 'high';

  const content =
    incident.kind === 'server-api' ? serverApiRepro(incident)
    : incident.kind === 'job' ? jobRepro(incident)
    : incident.kind === 'runner' ? runnerRepro(incident)
    : clientRuntimeRepro(incident);

  const absolute = path.join(repoRoot, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });

  try {
    await fs.access(absolute);
    // Already there — leave it alone.
  } catch {
    await fs.writeFile(absolute, content, 'utf8');
  }

  return { path: relativePath, command: REPRO_COMMAND, confidence };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- server/observability/repro.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Attach reproduction generation to recordIncident**

In `server/observability/incident.ts`, add the import:

```ts
import { generateRepro } from './repro';
```

and inside `recordIncident`, replace `const persisted = await store.upsert(incident);` with:

```ts
    incident.repro = await generateRepro(incident, repoRoot);
    const persisted = await store.upsert(incident);
```

- [ ] **Step 6: Assert the wiring in the incident test**

Append to `server/observability/incident.test.ts`, inside the existing
`describe('recordIncident', ...)`:

```ts
  it('generates a reproduction alongside the incident', async () => {
    const incident = await recordIncident({
      kind: 'server-api',
      error: errorFrom('server/thing.ts', 3),
      trigger: { method: 'POST', path: '/api/x', body: {} },
    });

    expect(incident!.repro?.confidence).toBe('high');
    expect(fs.existsSync(path.join(repoRoot, incident!.repro!.path))).toBe(true);
  });
```

- [ ] **Step 7: Verify**

Run: `npm test -- server/observability/`
Expected: all observability suites pass.

- [ ] **Step 8: Commit**

```bash
git add server/observability/repro.ts server/observability/repro.test.ts \
        server/observability/incident.ts server/observability/incident.test.ts
git commit -m "feat(observability): generate .repro.ts reproductions per incident kind"
```

---

### Task 11: End-to-end proof of the loop

**Files:**
- Test: `server/observability/loop.test.ts`

**Interfaces:**
- Consumes: everything built so far.
- Produces: nothing consumed by later tasks — this is the acceptance test.

- [ ] **Step 1: Write the end-to-end test**

Create `server/observability/loop.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { configureIncidents, recordIncident } from './incident';
import { incidentErrorHandler } from './taps/express';
import { IncidentStore } from './store';

/**
 * The acceptance test for the whole mechanism: a real failure must produce an artifact
 * that contains everything needed to find, understand and reproduce it — without anyone
 * describing the bug.
 */

let root: string;
let repoRoot: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-loop-'));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-looprepo-'));
  fs.mkdirSync(path.join(repoRoot, 'server'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'server', 'broken.ts'),
    [
      'export function readSelector(step: { targetElement?: { selector: string } }) {',
      '  // The bug: targetElement is optional but dereferenced unconditionally.',
      '  return step.targetElement.selector;',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  configureIncidents({ rootDir: root, repoRoot, logger: { error: () => {} } });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe('the incident loop', () => {
  it('turns an unhandled API error into a complete, actionable artifact', async () => {
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user?: unknown }).user = { id: 7 };
      next();
    });
    app.post('/api/execute-test-direct', () => {
      const error = new TypeError("Cannot read properties of undefined (reading 'selector')");
      error.stack = `TypeError: ${error.message}\n    at readSelector (${path.join(repoRoot, 'server', 'broken.ts')}:3:26)`;
      throw error;
    });
    app.use(incidentErrorHandler({ error: () => {} }));

    await request(app)
      .post('/api/execute-test-direct')
      .send({ url: 'https://app.test', sequence: [{ id: 'step-1', action: { id: 'click' } }] });

    // The index alone must be enough to know what happened.
    const store = new IncidentStore(root);
    const index = await store.readIndex();
    expect(index).toHaveLength(1);
    expect(index[0].title).toContain('selector');

    const incident = await store.read(index[0].id);

    // 1. Where it broke, with the code in hand.
    expect(incident!.origin?.file).toBe('server/broken.ts');
    expect(incident!.origin?.line).toBe(3);
    expect(incident!.origin?.source.join('\n')).toContain('return step.targetElement.selector;');

    // 2. What caused it.
    expect(incident!.trigger).toMatchObject({
      method: 'POST',
      path: '/api/execute-test-direct',
      body: { url: 'https://app.test' },
      userId: 7,
    });

    // 3. Which code produced it.
    expect(incident!.state).toHaveProperty('nodeVersion');

    // 4. A reproduction on disk, runnable.
    expect(incident!.repro?.confidence).toBe('high');
    const reproFile = path.join(repoRoot, incident!.repro!.path);
    expect(fs.existsSync(reproFile)).toBe(true);
    expect(fs.readFileSync(reproFile, 'utf8')).toContain('/api/execute-test-direct');
  });

  it('collapses a storm of the same failure into one artifact', async () => {
    const makeError = () => {
      const error = new TypeError("Cannot read properties of undefined (reading 'selector')");
      error.stack = `TypeError: ${error.message}\n    at readSelector (${path.join(repoRoot, 'server', 'broken.ts')}:3:26)`;
      return error;
    };

    for (let i = 0; i < 20; i++) {
      await recordIncident({ kind: 'server-api', error: makeError(), trigger: { attempt: i } });
    }

    const index = await new IncidentStore(root).readIndex();
    expect(index).toHaveLength(1);
    expect(fs.readdirSync(path.join(root, 'incidents'))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- server/observability/loop.test.ts`
Expected: PASS, 2 tests.

If the first test fails on `origin.source`, print `incident.origin` and confirm the
generated stack string matches the platform's path separators — the fixture builds the
stack with `path.join`, which is already platform-correct.

- [ ] **Step 3: Full verification**

Run: `npx tsc -b && npm test && npm test --prefix client && npx eslint . --ext .ts,.tsx`
Expected: `tsc` silent, both suites green, eslint exit 0.

- [ ] **Step 4: Commit**

```bash
git add server/observability/loop.test.ts
git commit -m "test(observability): end-to-end proof that an error becomes an actionable artifact"
```

---

### Task 12: Document how to use it

**Files:**
- Modify: `docs/ARCHITECTURE.md`

The documentation goes here rather than into `.observability/README.md`, because that
directory is gitignored and the note would never reach anyone else.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Append the section to `docs/ARCHITECTURE.md`**

Add at the end of the file:

```markdown
## Observability and incidents

Two outputs from one pipeline, both development-only.

**Logs.** `logs/app-YYYY-MM-DD.log` carries server *and* browser lines in one stream.
Client lines are prefixed `[client]` and carry `sessionId`. Every line has a
`correlationId`, generated by the browser and adopted by the server, so
`grep c-9f3a logs/app-*.log` returns the whole chain from click to failure.

Levels: `logLevel` (server) and `clientLogLevel` (browser) are separate system settings.
For a single browser tab, `localStorage.setItem('wfm:logLevel', 'debug')` overrides it.

**Incidents.** Every unhandled failure writes `.observability/incidents/inc_XXXXXX.json`
(gitignored) with the stack resolved to a source file, line and surrounding code; the
request or job data that caused it; the git commit it happened on; and the last 50 events
before it. `.observability/index.json` lists them all.

Recurrences of the same bug merge into one file by fingerprint, so a storm produces a
count, not a thousand files.

**Reproductions.** Each incident writes a `*.repro.ts` next to the suite that will own it
(`server/__repro__/` or `client/src/__repro__/`). Neither vitest config collects that
extension, so pending reproductions never redden CI. Run them with:

    npx vitest run --include '**/*.repro.ts'

Once a bug is fixed and its reproduction passes, rename it to `.test.ts` to keep it as a
permanent regression test.
```

- [ ] **Step 2: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: how to read the observability logs and incidents"
```

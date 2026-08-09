# Client-Runtime Origin Resolution & Incident Schema Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the one verified gap in the incident-capture system that defeats its own purpose for the client: every `client-runtime` incident today has `origin: null`, because browser stack frames use Vite's bundler-relative paths (`/src/x.tsx`) which the resolver's filesystem logic can never match against `repoRoot`. This plan makes client stacks resolve to a real source file, line and code snippet — the same guarantee server stacks already have — and adds a `schemaVersion` field so the `Incident` JSON shape can change later without silently breaking files already on disk.

**Architecture:** One rewrite step inserted into `parseStack`, active only when the caller is resolving a `client-runtime` stack: a raw frame path starting with `/src/` is rewritten to the real absolute path under `client/src` before any of the existing repo-relative / app-frame logic runs. Every downstream function (`isAppFile`, `toRepoRelative`, `resolveOrigin`) is untouched and unaware anything changed — it receives what looks like an ordinary server-side absolute path. Server stacks pass no rewrite root and are byte-for-byte unaffected.

**Tech Stack:** TypeScript, Node, vitest (`server/**/*.test.ts`, run via `npm test` from the repo root, or `npx vitest run <path>` for a single file).

## Global Constraints

- Development-only feature. No production concerns, no source-map resolution.
- `.observability/` is gitignored; nothing in this plan writes outside a test's own temp directory.
- Every existing test must keep passing. This plan touches shared infrastructure (`stack.ts`, `incident.ts`) used by every incident kind — server-api, job, and runner stacks must resolve exactly as before.
- Reuse existing helpers (`isAppFile`, `toRepoRelative`) rather than duplicating their logic for the browser case.
- Commit after each task. Never use `git commit --no-verify`.
- No schema migration engine. `schemaVersion` is a single field added now so a future change has somewhere to branch on — building the machinery that reads old versions is out of scope until a version 2 actually exists.

---

## File Structure

**Modified:**
- `server/observability/stack.ts` — `parseStack` gains a third, optional parameter that rewrites bundler-relative browser paths before classification. `resolveOrigin` is unchanged: it already works generically off whatever `parseStack` produces.
- `server/observability/stack.test.ts` — new cases proving the rewrite works and that server stacks are unaffected when the parameter is omitted.
- `server/observability/incident.ts` — passes the browser source root to `parseStack` only when `input.kind === 'client-runtime'`; adds `schemaVersion: 1` to every incident it constructs.
- `server/observability/incident.test.ts` — a client-runtime incident now resolves `origin`; a constructed incident carries `schemaVersion: 1`.
- `shared/observability.ts` — `Incident.schemaVersion: number`.
- `server/observability/store.test.ts` — reading a legacy file written without `schemaVersion` does not throw.

---

### Task 1: Resolve browser-relative stack paths to real source files

**Files:**
- Modify: `server/observability/stack.ts`
- Test: `server/observability/stack.test.ts`
- Modify: `server/observability/incident.ts`
- Test: `server/observability/incident.test.ts`

**Interfaces:**
- Consumes: nothing new — `StackFrame`, `IncidentOrigin` from `@shared/observability` (already imported in `stack.ts`).
- Produces: `parseStack(stack: string | undefined, repoRoot: string, browserSrcRoot?: string): StackFrame[]` — the signature every other caller of `parseStack` already uses still works unchanged, since the new parameter is optional and appended last.

- [ ] **Step 1: Write the failing test for the rewrite**

Open `server/observability/stack.test.ts`. Extend the existing `beforeAll` (around line 9) to also create a client source file, so the fixture matches what Vite actually serves this incident's real frame path from:

```ts
beforeAll(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-stack-'));
  fs.mkdirSync(path.join(repoRoot, 'server'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'server', 'sample.ts'),
    Array.from({ length: 20 }, (_unused, i) => `const line${i + 1} = ${i + 1};`).join('\n'),
    'utf8',
  );

  fs.mkdirSync(path.join(repoRoot, 'client', 'src', 'components', 'ui'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'client', 'src', 'components', 'ui', 'toaster.tsx'),
    Array.from({ length: 20 }, (_unused, i) => `const line${i + 1} = ${i + 1};`).join('\n'),
    'utf8',
  );
});
```

Then add a new `describe` block after the existing `resolveOrigin` block (at the end of the file):

```ts
describe('parseStack browser-relative paths', () => {
  const browserSrcRoot = () => path.join(repoRoot, 'client', 'src');

  it('resolves a Vite-style /src/... frame to the real file under client/src', () => {
    const stack = `TypeError: boom\n    at Toaster (/src/components/ui/toaster.tsx:16:15)`;

    const frames = parseStack(stack, repoRoot, browserSrcRoot());

    expect(frames).toHaveLength(1);
    expect(frames[0].app).toBe(true);
    expect(frames[0].file).toBe('client/src/components/ui/toaster.tsx');
    expect(frames[0].line).toBe(16);
  });

  it('lets resolveOrigin read the source snippet for a rewritten browser frame', () => {
    const stack = `TypeError: boom\n    at Toaster (/src/components/ui/toaster.tsx:16:15)`;
    const frames = parseStack(stack, repoRoot, browserSrcRoot());

    const origin = resolveOrigin(frames, repoRoot);

    expect(origin?.file).toBe('client/src/components/ui/toaster.tsx');
    expect(origin?.line).toBe(16);
    expect(origin?.source.join('\n')).toContain('const line16 = 16;');
    expect(origin?.unresolved).toBeUndefined();
  });

  it('does not rewrite when no browserSrcRoot is given, matching today\'s server-only behaviour', () => {
    const stack = `TypeError: boom\n    at Toaster (/src/components/ui/toaster.tsx:16:15)`;

    const frames = parseStack(stack, repoRoot);

    expect(frames[0].app).toBe(false);
  });

  it('leaves a real server absolute path untouched even when browserSrcRoot is supplied', () => {
    const stack = `Error: boom\n    at run (${path.join(repoRoot, 'server', 'sample.ts')}:10:5)`;

    const frames = parseStack(stack, repoRoot, browserSrcRoot());

    expect(frames[0].file).toBe('server/sample.ts');
    expect(frames[0].app).toBe(true);
  });

  it('leaves a vendor path served under /src/ neighbours alone if it does not exist on disk', () => {
    const stack = `TypeError: boom\n    at x (/src/does/not/exist.tsx:1:1)`;

    const frames = parseStack(stack, repoRoot, browserSrcRoot());

    // It IS classified as an app path (the rewrite happens before the disk is checked —
    // resolveOrigin is what reports a missing file, not parseStack).
    expect(frames[0].app).toBe(true);
    const origin = resolveOrigin(frames, repoRoot);
    expect(origin?.unresolved).toContain('could not read');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/observability/stack.test.ts`
Expected: FAIL — the new tests fail because `parseStack` does not yet accept a third argument (frames come back with `app: false` for the `/src/...` case, since nothing rewrites it).

- [ ] **Step 3: Implement the rewrite in `parseStack`**

In `server/observability/stack.ts`, add a helper right after `toAbsolutePath` (after line 27):

```ts
/**
 * Vite serves everything under the app's `src/` directory at the URL path `/src/...`, so a
 * browser stack trace names files that way — not as a filesystem path. Rewriting it to the
 * real absolute path under `browserSrcRoot` before classification means every downstream
 * function (isAppFile, toRepoRelative) keeps working exactly as it does for server stacks,
 * with no special case anywhere else.
 */
function rewriteBrowserPath(raw: string, browserSrcRoot: string | undefined): string {
  if (!browserSrcRoot || !raw.startsWith('/src/')) return raw;
  return path.join(browserSrcRoot, raw.slice('/src/'.length));
}
```

Then update `parseStack` (currently lines 49-70) to accept and use the new parameter:

```ts
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
```

`resolveOrigin` needs no change: it already operates on `frame.file`/`frame.app` regardless of how they were produced.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/observability/stack.test.ts`
Expected: PASS, 14 tests (9 existing + 5 new).

- [ ] **Step 5: Wire it into `recordIncident` for client-runtime incidents**

Open `server/observability/incident.ts`. Find the line that calls `parseStack` (currently `const frames = parseStack(input.error.stack, repoRoot);`, around line 177) and replace it with:

```ts
    // Browser stack frames name files as Vite serves them (`/src/...`), not as filesystem
    // paths — only client-runtime incidents need the rewrite; a server stack that happened
    // to contain a literal "/src/" would not exist on this codebase's disk layout anyway.
    const browserSrcRoot =
      input.kind === 'client-runtime' ? path.join(repoRoot, 'client', 'src') : undefined;
    const frames = parseStack(input.error.stack, repoRoot, browserSrcRoot);
```

Check the top of `server/observability/incident.ts` for an existing `import path from 'node:path';` — if it is not already imported, add it alongside the other node: imports at the top of the file.

- [ ] **Step 6: Write the failing integration test**

Open `server/observability/incident.test.ts`. Find the `errorFrom` helper near the top (it builds a server-style stack for the existing tests) and add a sibling helper plus a new test in the `describe('recordIncident', ...)` block:

```ts
const clientErrorFrom = () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'map')");
  error.name = 'TypeError';
  error.stack = `TypeError: ${error.message}\n    at Toaster (/src/components/ui/toaster.tsx:16:15)`;
  return error;
};
```

Then, before that test file's `beforeEach` writes its `repoRoot` fixture files, make sure a client source file exists too — extend the existing `beforeEach` (the one that does `fs.mkdirSync(path.join(repoRoot, 'server'), ...)` and writes `thing.ts`) to also create:

```ts
  fs.mkdirSync(path.join(repoRoot, 'client', 'src', 'components', 'ui'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'client', 'src', 'components', 'ui', 'toaster.tsx'),
    Array.from({ length: 20 }, (_unused, i) => `const line${i + 1} = ${i + 1};`).join('\n'),
    'utf8',
  );
```

Then add the test itself:

```ts
  it('resolves origin for a client-runtime incident from a Vite-style stack', async () => {
    const incident = await recordIncident({
      kind: 'client-runtime',
      error: clientErrorFrom(),
      trigger: { route: '/dashboard/create-test' },
      correlationId: 'c-1',
    });

    expect(incident!.origin?.file).toBe('client/src/components/ui/toaster.tsx');
    expect(incident!.origin?.line).toBe(16);
    expect(incident!.origin?.unresolved).toBeUndefined();
  });
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run server/observability/incident.test.ts`
Expected: FAIL — `incident!.origin` is `null` (the exact bug this plan fixes).

- [ ] **Step 8: Run it to verify it passes**

Run: `npx vitest run server/observability/incident.test.ts`
Expected: PASS, 12 tests (11 existing + 1 new). (This also confirms Step 5's wiring is correct — the test only passes once both Step 3 and Step 5 are done.)

- [ ] **Step 9: Run the full server suite to confirm nothing else moved**

Run: `npm test`
Expected: all suites pass, same file/test counts as before this task plus the new cases above (34 files before this plan; still 34, with more tests inside `stack.test.ts` and `incident.test.ts`).

- [ ] **Step 10: Typecheck and lint**

Run: `npx tsc -b`
Expected: no output.

Run: `npx eslint server/`
Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add server/observability/stack.ts server/observability/stack.test.ts \
        server/observability/incident.ts server/observability/incident.test.ts
git commit -m "fix(observability): resolve client-runtime stack frames to real source files

Every client-runtime incident had origin: null. Browser stacks name files the
way Vite serves them (/src/x.tsx), not as filesystem paths, so isAppFile's
comparison against repoRoot never matched — verified against a real incident
captured on disk during development. parseStack now rewrites a /src/... frame
to the real path under client/src before classification, only when resolving a
client-runtime stack; every other caller and every other incident kind is
unaffected."
```

---

### Task 2: Add `schemaVersion` to the incident artifact

**Files:**
- Modify: `shared/observability.ts`
- Modify: `server/observability/incident.ts`
- Test: `server/observability/incident.test.ts`
- Test: `server/observability/store.test.ts`

**Interfaces:**
- Consumes: the `Incident` interface from Task 1's unchanged surface.
- Produces: `Incident.schemaVersion: number`. Every incident `recordIncident` constructs carries `schemaVersion: 1`. Nothing reads or branches on this value yet — that only becomes necessary the day the shape changes again, which is exactly the point of adding it now rather than then.

- [ ] **Step 1: Add the field to the shared type**

In `shared/observability.ts`, find the `Incident` interface (starts `export interface Incident {`) and add the new field as the first property:

```ts
export interface Incident {
  /**
   * Bumped only when the shape of this interface changes in a way an old file on disk
   * would not satisfy. Nothing branches on it yet; it exists so that day has somewhere to
   * check, instead of every incident ever written silently being assumed current-shape.
   */
  schemaVersion: number;
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
```

Add a constant for the current value directly below the interface:

```ts
/** The schemaVersion every incident written by this build of the code carries. */
export const CURRENT_INCIDENT_SCHEMA_VERSION = 1;
```

- [ ] **Step 2: Write the failing test for construction**

In `server/observability/incident.test.ts`, add this test inside the existing `describe('recordIncident', ...)` block:

```ts
  it('stamps every incident with the current schema version', async () => {
    const incident = await recordIncident({
      kind: 'server-api',
      error: errorFrom('server/thing.ts', 3),
      trigger: {},
    });

    expect(incident!.schemaVersion).toBe(1);
  });
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run server/observability/incident.test.ts`
Expected: FAIL — TypeScript will actually refuse to compile at this point too, since `recordIncident`'s internal object literal no longer satisfies the `Incident` type after Step 1. Confirm this with:

Run: `npx tsc -b`
Expected: error, `Property 'schemaVersion' is missing in type ... but required in type 'Incident'` pointing at `server/observability/incident.ts`.

- [ ] **Step 4: Add the field where incidents are constructed**

In `server/observability/incident.ts`, import the constant alongside the existing type import from `@shared/observability` (find the existing `import type { Incident, ... } from '../../shared/observability';` line and add `CURRENT_INCIDENT_SCHEMA_VERSION` as a value import next to it — it needs its own `import` since it is a value, not a type):

```ts
import { CURRENT_INCIDENT_SCHEMA_VERSION } from '../../shared/observability';
```

Then find where `recordIncident` builds the `Incident` object literal — the block starting `const incident: Incident = {` and ending at its matching `};`. **Do not retype or reproduce this block from a template.** It has been hardened since this plan was drafted (rate-limit-aware counting, message/breadcrumb redaction) and a stale copy would silently undo that work. Instead, insert exactly one line, immediately after the opening `{`:

```ts
      schemaVersion: CURRENT_INCIDENT_SCHEMA_VERSION,
```

So the block's first two lines become:

```ts
    const incident: Incident = {
      schemaVersion: CURRENT_INCIDENT_SCHEMA_VERSION,
```

with every line that already exists after that — `id,`, `fingerprint,`, and everything through the closing `};` — left completely untouched, in whatever form they are currently in.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsc -b`
Expected: no output.

Run: `npx vitest run server/observability/incident.test.ts`
Expected: PASS, 13 tests (12 from Task 1 + 1 new).

- [ ] **Step 6: Write the legacy-file tolerance test**

A file already exists on disk from before this change (the real one found during development, and potentially others in any long-running deployment). Reading it must not throw just because it predates this field. In `server/observability/store.test.ts`, add this test inside the existing `describe('IncidentStore.upsert', ...)` block:

```ts
  it('tolerates reading and merging a legacy file written before schemaVersion existed', async () => {
    const legacyPath = path.join(root, 'incidents', 'inc_legacy0.json');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    // Deliberately built by hand, NOT via the incident() helper above, and with no
    // schemaVersion key at all — this is what a file written by the previous version of
    // the code actually looks like on disk.
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        id: 'inc_legacy0',
        fingerprint: 'legacy0',
        kind: 'server-api',
        status: 'open',
        count: 1,
        firstSeen: '2026-07-01T00:00:00.000Z',
        lastSeen: '2026-07-01T00:00:00.000Z',
        title: 'Old incident',
        origin: null,
        error: { name: 'Error', message: 'old', frames: [] },
        trigger: {},
        state: {},
        breadcrumbs: [],
        occurrences: [],
      }),
      'utf8',
    );

    const read = await store.read('inc_legacy0');
    expect(read).not.toBeNull();
    expect(read!.schemaVersion).toBeUndefined(); // exactly what the file on disk says — no silent invention of data

    const merged = await store.upsert(incident({ id: 'inc_legacy0', fingerprint: 'legacy0' }));
    expect(merged.count).toBe(2); // still merges as a recurrence of the same incident
  });
```

- [ ] **Step 7: Run it to verify it passes without any store.ts change**

Run: `npx vitest run server/observability/store.test.ts`
Expected: PASS. This file has grown since this plan was drafted — confirm the count is one more than whatever `npx vitest run server/observability/store.test.ts` reports before this step (14 at time of writing, so 15 after). `IncidentStore` never inspects `schemaVersion`, so a file missing it round-trips exactly as any other field would — this test exists to pin that fact as a guarantee, not because a fix was needed.

- [ ] **Step 8: Run the full suite and lint**

Run: `npm test`
Expected: all suites pass.

Run: `npx eslint server/ shared/`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add shared/observability.ts server/observability/incident.ts \
        server/observability/incident.test.ts server/observability/store.test.ts
git commit -m "feat(observability): stamp incidents with a schemaVersion

No migration exists yet and none is being built — this is the field a future
shape change would need to branch on. Without it, a future change to the
Incident shape would silently disagree with whatever is already on disk, with
no field anywhere recording which shape a given file was written in. Pinned
with a test that a file written before this field existed still reads back and
still merges as a normal recurrence."
```

---

## Self-Review

**Spec coverage.** The self-correction analysis raised three concrete findings: (1) `origin: null` for every client-runtime incident, root-caused to Vite's `/src/...` paths — Task 1. (2) No `schemaVersion` field — Task 2. (3) Tasks 7-12 of the original observability plan were never given a task review because the agent budget ran out mid-Task-6. That third finding is not a code change — it is a pending step in `.superpowers/sdd/progress.md` (the final whole-branch review). It does not belong in a bite-sized coding plan and is called out below instead of being forced into a fake "task."

**Placeholder scan.** No TBD/TODO, no "add appropriate handling," every step carries the literal code to write, every test shown in full.

**Type consistency.** `parseStack`'s new third parameter (`browserSrcRoot?: string`) is named and typed identically everywhere it is declared (Task 1, Step 3) and called (Task 1, Step 5). `CURRENT_INCIDENT_SCHEMA_VERSION` is exported once (Task 2, Step 1) and imported by that exact name once (Task 2, Step 4). `Incident.schemaVersion: number` matches the literal `schemaVersion: CURRENT_INCIDENT_SCHEMA_VERSION` assignment.

## What this plan deliberately does not cover

The enterprise gap analysis named five other pillars — organizations & RBAC, worker scaling beyond `concurrency: 1`, a public API, OpenTelemetry & flaky-test detection, SSO, AI-driven root cause — none of which are plannable today without fabricating decisions nobody has made (which OIDC provider, exact role names, Kubernetes vs. more BullMQ workers, retry policy specifics). Per this skill's own scope check, a multi-subsystem spec should be decomposed and brainstormed one piece at a time rather than forced into one document with placeholders standing in for missing decisions. This plan covers only the item that was fully specified by investigation: the concrete bug and the concrete field.

After this plan lands, the standing next step recorded in `.superpowers/sdd/progress.md` is still the final whole-branch review of the observability feature (covering Tasks 7-12, which shipped without a task-level review) — that review should now also see these two commits, since they touch the same files.

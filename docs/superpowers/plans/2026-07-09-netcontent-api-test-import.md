# NetContent API Test Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the ~168 explicitly-routed ASP.NET endpoints from the DMO.NetContent controllers and insert them as WebFlowMaster `apiTests` under a "NetContent" project, grouped by controller module, via a repeatable, idempotent Node/TS importer.

**Architecture:** Three isolated units — a pure **parser** (`.cs` → endpoint objects), a pure **mapper** (endpoints → `InsertApiTest[]`), and an **importer** (Drizzle upsert into the DB, find-or-create project, idempotent re-run). A thin CLI orchestrates them and writes an inspectable manifest.

**Tech Stack:** TypeScript, tsx, Drizzle ORM, Vitest + PGlite (matching the existing suite), `uuid`.

## Global Constraints

- Node run via `tsx` (already a dependency); no new runtime deps except reuse of `uuid` (already present).
- DB writes via Drizzle only, using `InsertApiTest = typeof apiTests.$inferInsert`; do NOT go through the HTTP API.
- `apiTests.userId` is `NOT NULL`; every inserted row needs a resolved user id.
- Idempotency key for a test: `(projectId, method, url)`. Re-runs must preserve user-owned fields: `assertions`, filled `queryParams` values, `authType`/`authParams`. Never auto-delete.
- Default smoke assertion exactly: `{ id: <uuid>, source: "status_code", comparison: "less_than", targetValue: "500", enabled: true }`.
- `queryParams` stored as `KeyValuePair[]` = `{ id: string, key: string, value: string, enabled: boolean }`.
- Tests live in `scripts/netcontent/*.test.ts`; extend `vitest.config.ts` `include` to discover them.
- Controllers default dir: `C:\Users\marco.oliva\source\repos\DMO_3\DMO.NetContent\_NccNew\Controllers`.

---

## File Structure

- `scripts/netcontent/types.ts` — shared TS interfaces (`EndpointParam`, `Endpoint`, `ParseResult`, `ApiTestRecord`).
- `scripts/netcontent/parse-controllers.ts` — pure parser: source/dir → endpoints + warnings.
- `scripts/netcontent/map-to-apitests.ts` — pure mapper: endpoints + config → `InsertApiTest[]`.
- `scripts/netcontent/importer.ts` — DB layer: resolve user, find-or-create project, idempotent upsert, summary.
- `scripts/import-netcontent-api.ts` — CLI orchestrator (`--dry-run`, writes manifest, calls importer).
- `scripts/netcontent/parse-controllers.test.ts`, `map-to-apitests.test.ts`, `importer.test.ts` — tests.
- `vitest.config.ts` — modified: add `scripts/**/*.test.ts` to `include`.
- `package.json` — modified: add `import:netcontent` script.
- `.gitignore` — modified: ignore `scripts/netcontent/endpoints.manifest.json`.

---

## Task 1: Shared types + vitest discovery

**Files:**
- Create: `scripts/netcontent/types.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces: `EndpointParam`, `Endpoint`, `ParseResult` used by every later task.

- [ ] **Step 1: Create the types file**

`scripts/netcontent/types.ts`:
```ts
export interface EndpointParam {
  name: string;
  csType: string;        // raw C# type, e.g. "int", "double", "bool", "int?", "string"
  required: boolean;     // true when the signature has no default value
  defaultValue: string | null; // literal default text, e.g. "false", "null", "0"
}

export interface Endpoint {
  httpMethod: "GET" | "POST";
  route: string;         // verbatim from [Route("...")], e.g. "api/NetContentTareCheck/GetLastOpenTareCheck"
  controller: string;    // module/domain, e.g. "TareCheck"
  action: string;        // method name, e.g. "GetLastOpenTareCheck"
  params: EndpointParam[];
}

export interface ParseResult {
  endpoints: Endpoint[];
  warnings: string[];    // human-readable notes about skipped/odd actions
}
```

- [ ] **Step 2: Add scripts tests to vitest include**

In `vitest.config.ts`, change the `include` line:
```ts
include: ['server/**/*.test.ts', 'scripts/**/*.test.ts'],
```

- [ ] **Step 3: Verify vitest still green (no scripts tests yet)**

Run: `npx vitest run`
Expected: PASS (95 tests, unchanged — the new glob matches nothing yet).

- [ ] **Step 4: Commit**

```bash
git add scripts/netcontent/types.ts vitest.config.ts
git commit -m "chore(netcontent): shared types + vitest discovery for scripts tests"
```

---

## Task 2: Parser — single controller source

**Files:**
- Create: `scripts/netcontent/parse-controllers.ts`
- Test: `scripts/netcontent/parse-controllers.test.ts`

**Interfaces:**
- Consumes: `Endpoint`, `EndpointParam` from Task 1.
- Produces:
  - `parseControllerSource(source: string, controller: string): { endpoints: Endpoint[]; warnings: string[] }`
  - `parseParams(paramStr: string): EndpointParam[]`

- [ ] **Step 1: Write the failing test**

`scripts/netcontent/parse-controllers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseControllerSource, parseParams } from './parse-controllers';

const SAMPLE = `
using Microsoft.AspNetCore.Mvc;
namespace DMO.NetContent2.Controllers {
  [ApiController]
  public class NccTareCheckController : ControllerBase {
    [HttpGet]
    [Route("api/NetContentTareCheck/GetCorrectiveActions")]
    public object GetCorrectiveActions() { return null; }

    [HttpGet]
    [Route("api/NetContentTareCheck/GetLastOpenTareCheck")]
    public object GetLastOpenTareCheck(int equipmentRowId, bool isTrayWeightCapture = false) { return null; }

    [HttpPost]
    [Route("api/NetContentTareCheck/UpdateMeasurement")]
    public void UpdateMeasurement(int valueRowId, double value, string comment, bool isManual = false) { }
  }
}
`;

describe('parseParams', () => {
  it('extracts name, type, required flag and default', () => {
    expect(parseParams('int equipmentRowId, bool isTrayWeightCapture = false')).toEqual([
      { name: 'equipmentRowId', csType: 'int', required: true, defaultValue: null },
      { name: 'isTrayWeightCapture', csType: 'bool', required: false, defaultValue: 'false' },
    ]);
  });

  it('returns [] for an empty signature', () => {
    expect(parseParams('')).toEqual([]);
    expect(parseParams('   ')).toEqual([]);
  });
});

describe('parseControllerSource', () => {
  it('extracts every routed action with method, route and params', () => {
    const { endpoints } = parseControllerSource(SAMPLE, 'TareCheck');
    expect(endpoints).toHaveLength(3);

    expect(endpoints[0]).toEqual({
      httpMethod: 'GET',
      route: 'api/NetContentTareCheck/GetCorrectiveActions',
      controller: 'TareCheck',
      action: 'GetCorrectiveActions',
      params: [],
    });

    expect(endpoints[1].httpMethod).toBe('GET');
    expect(endpoints[1].action).toBe('GetLastOpenTareCheck');
    expect(endpoints[1].params).toEqual([
      { name: 'equipmentRowId', csType: 'int', required: true, defaultValue: null },
      { name: 'isTrayWeightCapture', csType: 'bool', required: false, defaultValue: 'false' },
    ]);

    expect(endpoints[2].httpMethod).toBe('POST');
    expect(endpoints[2].action).toBe('UpdateMeasurement');
    expect(endpoints[2].params.map(p => p.name)).toEqual(['valueRowId', 'value', 'comment', 'isManual']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/netcontent/parse-controllers.test.ts`
Expected: FAIL ("Failed to resolve import './parse-controllers'").

- [ ] **Step 3: Write the implementation**

`scripts/netcontent/parse-controllers.ts`:
```ts
import type { Endpoint, EndpointParam } from './types';

// Splits a C# parameter list on top-level commas (ignores commas inside <...> generics).
function splitTopLevel(paramStr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of paramStr) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function parseParams(paramStr: string): EndpointParam[] {
  const trimmed = paramStr.trim();
  if (!trimmed) return [];
  return splitTopLevel(trimmed).map((raw) => {
    // Drop C# parameter attributes like [FromBody] / [FromQuery].
    let p = raw.replace(/\[[^\]]*\]/g, '').trim();
    let defaultValue: string | null = null;
    const eq = p.indexOf('=');
    if (eq !== -1) {
      defaultValue = p.slice(eq + 1).trim();
      p = p.slice(0, eq).trim();
    }
    // Remaining is "<type-with-maybe-spaces> <name>"; the name is the last token.
    const tokens = p.split(/\s+/);
    const name = tokens.pop() as string;
    const csType = tokens.join(' ');
    return { name, csType, required: defaultValue === null, defaultValue };
  });
}

// Matches: [HttpGet]/[HttpPost] ... [Route("...")] ... public <ret> <Name>( <params> )
const ACTION_RE =
  /\[Http(Get|Post)\]\s*(?:\[[^\]]*\]\s*)*?\[Route\("([^"]+)"\)\]\s*(?:\[[^\]]*\]\s*)*public\s+[\w<>?,\[\]\s]+?\s+(\w+)\s*\(([^)]*)\)/gs;

export function parseControllerSource(
  source: string,
  controller: string,
): { endpoints: Endpoint[]; warnings: string[] } {
  const endpoints: Endpoint[] = [];
  const warnings: string[] = [];
  let m: RegExpExecArray | null;
  ACTION_RE.lastIndex = 0;
  while ((m = ACTION_RE.exec(source)) !== null) {
    const [, verb, route, action, paramStr] = m;
    endpoints.push({
      httpMethod: verb.toUpperCase() === 'GET' ? 'GET' : 'POST',
      route,
      controller,
      action,
      params: parseParams(paramStr),
    });
  }
  // Flag actions that carry an HTTP verb but no [Route] (convention routing not supported).
  const verbCount = (source.match(/\[Http(Get|Post)\]/g) || []).length;
  if (verbCount > endpoints.length) {
    warnings.push(
      `${controller}: ${verbCount - endpoints.length} action(s) with [HttpGet]/[HttpPost] but no adjacent [Route(...)] were skipped.`,
    );
  }
  return { endpoints, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/netcontent/parse-controllers.test.ts`
Expected: PASS (5 assertions across 3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/netcontent/parse-controllers.ts scripts/netcontent/parse-controllers.test.ts
git commit -m "feat(netcontent): parse a controller source into routed endpoints"
```

---

## Task 3: Parser — directory scan + module derivation

**Files:**
- Modify: `scripts/netcontent/parse-controllers.ts`
- Modify: `scripts/netcontent/parse-controllers.test.ts`

**Interfaces:**
- Consumes: `parseControllerSource` (Task 2), `ParseResult` (Task 1).
- Produces:
  - `moduleFromPath(filePath: string, controllersRoot: string): string`
  - `parseControllersDir(controllersRoot: string): ParseResult`

- [ ] **Step 1: Write the failing test**

Append to `scripts/netcontent/parse-controllers.test.ts`:
```ts
import { moduleFromPath } from './parse-controllers';
import path from 'path';

describe('moduleFromPath', () => {
  const root = path.join('repo', '_NccNew', 'Controllers');
  it('uses the subfolder name when the controller sits in one', () => {
    expect(moduleFromPath(path.join(root, 'TareCheck', 'NccTareCheckController.cs'), root)).toBe('TareCheck');
  });
  it('derives from the class filename when directly under Controllers', () => {
    expect(moduleFromPath(path.join(root, 'CommonNccController.cs'), root)).toBe('Common');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/netcontent/parse-controllers.test.ts`
Expected: FAIL ("moduleFromPath is not a function").

- [ ] **Step 3: Add the implementation**

Append to `scripts/netcontent/parse-controllers.ts`:
```ts
import fs from 'fs';
import path from 'path';
import type { ParseResult } from './types';

export function moduleFromPath(filePath: string, controllersRoot: string): string {
  const rel = path.relative(controllersRoot, filePath);
  const segments = rel.split(path.sep);
  if (segments.length > 1) {
    return segments[0]; // subfolder domain, e.g. "TareCheck"
  }
  // Directly under Controllers: derive from the file name.
  // "CommonNccController.cs" -> strip .cs, trailing "Controller", leading "Ncc".
  return path
    .basename(filePath, '.cs')
    .replace(/Controller$/, '')
    .replace(/^Ncc/, '');
}

function walkCsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkCsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.cs')) out.push(full);
  }
  return out;
}

export function parseControllersDir(controllersRoot: string): ParseResult {
  if (!fs.existsSync(controllersRoot)) {
    throw new Error(`Controllers directory not found: ${controllersRoot}`);
  }
  const endpoints: ParseResult['endpoints'] = [];
  const warnings: string[] = [];
  for (const file of walkCsFiles(controllersRoot)) {
    const source = fs.readFileSync(file, 'utf-8');
    const controller = moduleFromPath(file, controllersRoot);
    const res = parseControllerSource(source, controller);
    endpoints.push(...res.endpoints);
    warnings.push(...res.warnings);
  }
  return { endpoints, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/netcontent/parse-controllers.test.ts`
Expected: PASS.

- [ ] **Step 5: Smoke-run the parser against the real controllers**

Run:
```bash
npx tsx -e "import('./scripts/netcontent/parse-controllers.ts').then(m => { const r = m.parseControllersDir(String.raw`C:\Users\marco.oliva\source\repos\DMO_3\DMO.NetContent\_NccNew\Controllers`); console.log('endpoints:', r.endpoints.length, 'warnings:', r.warnings.length); })"
```
Expected: prints roughly `endpoints: ~168` and a small warnings count. (Informational — not an assertion. If endpoints is 0, the regex needs revisiting before continuing.)

- [ ] **Step 6: Commit**

```bash
git add scripts/netcontent/parse-controllers.ts scripts/netcontent/parse-controllers.test.ts
git commit -m "feat(netcontent): recursively parse the controllers directory"
```

---

## Task 4: Mapper — endpoints → InsertApiTest[]

**Files:**
- Create: `scripts/netcontent/map-to-apitests.ts`
- Test: `scripts/netcontent/map-to-apitests.test.ts`

**Interfaces:**
- Consumes: `Endpoint` (Task 1), `InsertApiTest` (`@shared/schema`).
- Produces:
  - `interface MapperConfig { baseUrlVar: string; projectId: number; userId: number }`
  - `interface KeyValuePair { id: string; key: string; value: string; enabled: boolean }`
  - `mapEndpoint(ep: Endpoint, cfg: MapperConfig): InsertApiTest`
  - `mapEndpoints(eps: Endpoint[], cfg: MapperConfig): InsertApiTest[]`

- [ ] **Step 1: Write the failing test**

`scripts/netcontent/map-to-apitests.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mapEndpoint } from './map-to-apitests';
import type { Endpoint } from './types';

const ep: Endpoint = {
  httpMethod: 'POST',
  route: 'api/NetContentTareCheck/UpdateMeasurement',
  controller: 'TareCheck',
  action: 'UpdateMeasurement',
  params: [
    { name: 'valueRowId', csType: 'int', required: true, defaultValue: null },
    { name: 'isManual', csType: 'bool', required: false, defaultValue: 'false' },
  ],
};

describe('mapEndpoint', () => {
  const cfg = { baseUrlVar: '{{baseUrl}}', projectId: 7, userId: 3 };

  it('maps method, url, module, featureArea, owner and project', () => {
    const t = mapEndpoint(ep, cfg);
    expect(t.method).toBe('POST');
    expect(t.url).toBe('{{baseUrl}}/api/NetContentTareCheck/UpdateMeasurement');
    expect(t.name).toBe('UpdateMeasurement');
    expect(t.module).toBe('TareCheck');
    expect(t.featureArea).toBe('NetContentTareCheck');
    expect(t.projectId).toBe(7);
    expect(t.userId).toBe(3);
    expect(t.bodyType).toBe('none');
    expect(t.authType).toBeNull();
  });

  it('maps params to queryParams: required enabled+empty, optional disabled+default', () => {
    const t = mapEndpoint(ep, cfg);
    const qp = t.queryParams as Array<{ key: string; value: string; enabled: boolean }>;
    expect(qp).toHaveLength(2);
    expect(qp[0]).toMatchObject({ key: 'valueRowId', value: '', enabled: true });
    expect(qp[1]).toMatchObject({ key: 'isManual', value: 'false', enabled: false });
  });

  it('adds the default status_code < 500 smoke assertion', () => {
    const t = mapEndpoint(ep, cfg);
    const a = (t.assertions as Array<any>)[0];
    expect(a).toMatchObject({ source: 'status_code', comparison: 'less_than', targetValue: '500', enabled: true });
    expect(a.id).toMatch(/[0-9a-f-]{36}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/netcontent/map-to-apitests.test.ts`
Expected: FAIL ("Failed to resolve import './map-to-apitests'").

- [ ] **Step 3: Write the implementation**

`scripts/netcontent/map-to-apitests.ts`:
```ts
import { v4 as uuidv4 } from 'uuid';
import type { InsertApiTest } from '@shared/schema';
import type { Endpoint } from './types';

export interface MapperConfig {
  baseUrlVar: string; // e.g. "{{baseUrl}}"
  projectId: number;
  userId: number;
}

export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

function featureAreaFromRoute(route: string): string {
  const parts = route.split('/').filter(Boolean);
  // "api/NetContentTareCheck/Action" -> "NetContentTareCheck"
  return parts.length >= 2 ? parts[1] : (parts[0] ?? '');
}

export function mapEndpoint(ep: Endpoint, cfg: MapperConfig): InsertApiTest {
  const queryParams: KeyValuePair[] = ep.params.map((p) => ({
    id: uuidv4(),
    key: p.name,
    value: p.required ? '' : (p.defaultValue ?? ''),
    enabled: p.required, // required params on by default (user fills them); optional off
  }));

  const assertions = [
    {
      id: uuidv4(),
      source: 'status_code' as const,
      comparison: 'less_than' as const,
      targetValue: '500',
      enabled: true,
    },
  ];

  return {
    userId: cfg.userId,
    projectId: cfg.projectId,
    name: ep.action,
    method: ep.httpMethod,
    url: `${cfg.baseUrlVar}/${ep.route}`,
    queryParams,
    requestHeaders: null,
    requestBody: null,
    assertions,
    authType: null,
    authParams: null,
    bodyType: 'none',
    module: ep.controller,
    featureArea: featureAreaFromRoute(ep.route),
    priority: 'Medium',
    severity: 'Major',
  } as InsertApiTest;
}

export function mapEndpoints(eps: Endpoint[], cfg: MapperConfig): InsertApiTest[] {
  return eps.map((ep) => mapEndpoint(ep, cfg));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/netcontent/map-to-apitests.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/netcontent/map-to-apitests.ts scripts/netcontent/map-to-apitests.test.ts
git commit -m "feat(netcontent): map endpoints to apiTests insert records"
```

---

## Task 5: Importer — resolve user/project + first insert

**Files:**
- Create: `scripts/netcontent/importer.ts`
- Test: `scripts/netcontent/importer.test.ts`

**Interfaces:**
- Consumes: `db` (`server/db`), `apiTests`/`projects`/`users` (`@shared/schema`), `InsertApiTest`.
- Produces:
  - `resolveUserId(database, override?: number): Promise<number>`
  - `findOrCreateProject(database, userId: number, name: string): Promise<number>`
  - `interface ImportSummary { created: number; updated: number; orphans: string[] }`
  - `importApiTests(database, records: InsertApiTest[], projectId: number): Promise<ImportSummary>`

- [ ] **Step 1: Write the failing test (resolve + insert)**

`scripts/netcontent/importer.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../server/db';
import { users, projects, apiTests } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { resolveUserId, findOrCreateProject, importApiTests } from './importer';
import { mapEndpoints } from './map-to-apitests';
import type { Endpoint } from './types';

const EPS: Endpoint[] = [
  { httpMethod: 'GET', route: 'api/NetContentTareCheck/GetX', controller: 'TareCheck', action: 'GetX',
    params: [{ name: 'id', csType: 'int', required: true, defaultValue: null }] },
  { httpMethod: 'POST', route: 'api/NetContentScale/SaveY', controller: 'Scale', action: 'SaveY', params: [] },
];

beforeEach(async () => {
  await db.delete(apiTests);
  await db.delete(projects);
  await db.delete(users);
  await db.insert(users).values({ id: 1, username: 'owner', password: 'x' });
});

describe('resolveUserId', () => {
  it('returns the override when given', async () => {
    expect(await resolveUserId(db, 1)).toBe(1);
  });
  it('falls back to the only user', async () => {
    expect(await resolveUserId(db)).toBe(1);
  });
});

describe('findOrCreateProject', () => {
  it('creates the project on first call and reuses it on the second', async () => {
    const a = await findOrCreateProject(db, 1, 'NetContent');
    const b = await findOrCreateProject(db, 1, 'NetContent');
    expect(a).toBe(b);
    const rows = await db.select().from(projects).where(eq(projects.name, 'NetContent'));
    expect(rows).toHaveLength(1);
  });
});

describe('importApiTests (first run)', () => {
  it('inserts one apiTest per endpoint', async () => {
    const pid = await findOrCreateProject(db, 1, 'NetContent');
    const records = mapEndpoints(EPS, { baseUrlVar: '{{baseUrl}}', projectId: pid, userId: 1 });
    const summary = await importApiTests(db, records, pid);
    expect(summary.created).toBe(2);
    expect(summary.updated).toBe(0);
    const rows = await db.select().from(apiTests).where(eq(apiTests.projectId, pid));
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.method).sort()).toEqual(['GET', 'POST']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/netcontent/importer.test.ts`
Expected: FAIL ("Failed to resolve import './importer'").

- [ ] **Step 3: Write the implementation**

`scripts/netcontent/importer.ts`:
```ts
import { asc, eq } from 'drizzle-orm';
import type { db as DbType } from '../../server/db';
import { users, projects, apiTests, type InsertApiTest } from '@shared/schema';

type Database = typeof DbType;

export interface ImportSummary {
  created: number;
  updated: number;
  orphans: string[]; // "METHOD url" of DB tests no longer present in the import
}

export async function resolveUserId(database: Database, override?: number): Promise<number> {
  if (override !== undefined) return override;
  const rows = await database.select({ id: users.id }).from(users).orderBy(asc(users.id)).limit(1);
  if (rows.length === 0) throw new Error('No users found in the database; cannot own imported tests.');
  return rows[0].id;
}

export async function findOrCreateProject(database: Database, userId: number, name: string): Promise<number> {
  const existing = await database.select({ id: projects.id }).from(projects).where(eq(projects.name, name)).limit(1);
  if (existing.length > 0) return existing[0].id;
  const created = await database.insert(projects).values({ name, userId }).returning({ id: projects.id });
  return created[0].id;
}

const keyOf = (method: string, url: string) => `${method} ${url}`;

export async function importApiTests(
  database: Database,
  records: InsertApiTest[],
  projectId: number,
): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, orphans: [] };
  const existing = await database.select().from(apiTests).where(eq(apiTests.projectId, projectId));
  const existingByKey = new Map(existing.map((t) => [keyOf(t.method, t.url), t]));
  const importedKeys = new Set(records.map((r) => keyOf(r.method as string, r.url as string)));

  for (const rec of records) {
    const key = keyOf(rec.method as string, rec.url as string);
    const prev = existingByKey.get(key);
    if (!prev) {
      await database.insert(apiTests).values(rec);
      summary.created++;
    } else {
      // Preserve user-owned fields; refresh structural ones; add new params.
      const mergedParams = mergeQueryParams(prev.queryParams, rec.queryParams);
      await database
        .update(apiTests)
        .set({
          module: rec.module,
          featureArea: rec.featureArea,
          queryParams: mergedParams,
          updatedAt: new Date(),
        })
        .where(eq(apiTests.id, prev.id));
      summary.updated++;
    }
  }

  for (const t of existing) {
    if (!importedKeys.has(keyOf(t.method, t.url))) summary.orphans.push(keyOf(t.method, t.url));
  }
  return summary;
}

type KVP = { id: string; key: string; value: string; enabled: boolean };

// Keep every existing param (and its user-entered value); append params that are new.
export function mergeQueryParams(prev: unknown, next: unknown): KVP[] {
  const prevArr = Array.isArray(prev) ? (prev as KVP[]) : [];
  const nextArr = Array.isArray(next) ? (next as KVP[]) : [];
  const byKey = new Map(prevArr.map((p) => [p.key, p]));
  for (const n of nextArr) {
    if (!byKey.has(n.key)) byKey.set(n.key, n);
  }
  return Array.from(byKey.values());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/netcontent/importer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/netcontent/importer.ts scripts/netcontent/importer.test.ts
git commit -m "feat(netcontent): importer resolves user/project and inserts tests"
```

---

## Task 6: Importer — idempotent re-run preserves user edits

**Files:**
- Modify: `scripts/netcontent/importer.test.ts`

**Interfaces:**
- Consumes: `importApiTests`, `mergeQueryParams` (Task 5).

- [ ] **Step 1: Write the failing test**

Append to `scripts/netcontent/importer.test.ts`:
```ts
describe('importApiTests (re-run)', () => {
  it('preserves edited assertions + filled param values, adds new params, reports orphans', async () => {
    const pid = await findOrCreateProject(db, 1, 'NetContent');
    // First import.
    let records = mapEndpoints(EPS, { baseUrlVar: '{{baseUrl}}', projectId: pid, userId: 1 });
    await importApiTests(db, records, pid);

    // Simulate the user editing GetX: fill the "id" value, add a custom assertion.
    const getX = (await db.select().from(apiTests).where(eq(apiTests.method, 'GET')))[0];
    const editedParams = [{ id: 'a', key: 'id', value: '42', enabled: true }];
    const editedAssertions = [{ id: 'b', source: 'status_code', comparison: 'equals', targetValue: '200', enabled: true }];
    await db.update(apiTests)
      .set({ queryParams: editedParams, assertions: editedAssertions })
      .where(eq(apiTests.id, getX.id));

    // Re-import: GetX now also has a new param "mode"; SaveY is gone; NewZ appears.
    const eps2: Endpoint[] = [
      { httpMethod: 'GET', route: 'api/NetContentTareCheck/GetX', controller: 'TareCheck', action: 'GetX',
        params: [
          { name: 'id', csType: 'int', required: true, defaultValue: null },
          { name: 'mode', csType: 'string', required: false, defaultValue: 'null' },
        ] },
      { httpMethod: 'GET', route: 'api/NetContentTareCheck/NewZ', controller: 'TareCheck', action: 'NewZ', params: [] },
    ];
    records = mapEndpoints(eps2, { baseUrlVar: '{{baseUrl}}', projectId: pid, userId: 1 });
    const summary = await importApiTests(db, records, pid);

    expect(summary.created).toBe(1);           // NewZ
    expect(summary.updated).toBe(1);           // GetX
    expect(summary.orphans).toContain('POST {{baseUrl}}/api/NetContentScale/SaveY');

    const after = (await db.select().from(apiTests).where(eq(apiTests.id, getX.id)))[0];
    // Edited assertion preserved.
    expect((after.assertions as any[])[0].targetValue).toBe('200');
    // Existing param value preserved, new param appended.
    const params = after.queryParams as any[];
    expect(params.find(p => p.key === 'id').value).toBe('42');
    expect(params.find(p => p.key === 'mode')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run scripts/netcontent/importer.test.ts`
Expected: PASS (the Task 5 implementation already preserves assertions/values and merges params; this test confirms it). If it fails, fix `importApiTests`/`mergeQueryParams` until green.

- [ ] **Step 3: Commit**

```bash
git add scripts/netcontent/importer.test.ts
git commit -m "test(netcontent): idempotent re-run preserves edits and reports orphans"
```

---

## Task 7: CLI orchestrator + manifest + npm script

**Files:**
- Create: `scripts/import-netcontent-api.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `parseControllersDir` (Task 3), `mapEndpoints` (Task 4), `resolveUserId`/`findOrCreateProject`/`importApiTests` (Task 5).

- [ ] **Step 1: Write the orchestrator**

`scripts/import-netcontent-api.ts`:
```ts
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { db } from '../server/db';
import { parseControllersDir } from './netcontent/parse-controllers';
import { mapEndpoints } from './netcontent/map-to-apitests';
import { resolveUserId, findOrCreateProject, importApiTests } from './netcontent/importer';

const DEFAULT_CONTROLLERS =
  String.raw`C:\Users\marco.oliva\source\repos\DMO_3\DMO.NetContent\_NccNew\Controllers`;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const controllersDir = process.env.NETCONTENT_CONTROLLERS_DIR || DEFAULT_CONTROLLERS;
  const baseUrlVar = process.env.NETCONTENT_BASE_URL_VAR || '{{baseUrl}}';
  const projectName = process.env.NETCONTENT_PROJECT_NAME || 'NetContent';
  const userOverride = process.env.WFM_IMPORT_USER_ID ? Number(process.env.WFM_IMPORT_USER_ID) : undefined;

  console.log(`Parsing controllers in: ${controllersDir}`);
  const { endpoints, warnings } = parseControllersDir(controllersDir);
  console.log(`Parsed ${endpoints.length} endpoints (${warnings.length} warnings).`);
  warnings.forEach((w) => console.warn(`  ⚠ ${w}`));

  const manifestPath = path.join(__dirname, 'netcontent', 'endpoints.manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ endpoints, warnings }, null, 2), 'utf-8');
  console.log(`Manifest written: ${manifestPath}`);

  if (dryRun) {
    console.log('--dry-run: no database writes.');
    process.exit(0);
  }

  const userId = await resolveUserId(db, userOverride);
  const projectId = await findOrCreateProject(db, userId, projectName);
  const records = mapEndpoints(endpoints, { baseUrlVar, projectId, userId });
  const summary = await importApiTests(db, records, projectId);

  console.log(
    `Import complete → project "${projectName}" (id=${projectId}, owner userId=${userId})\n` +
      `  created: ${summary.created}  updated: ${summary.updated}  orphans: ${summary.orphans.length}`,
  );
  summary.orphans.forEach((o) => console.log(`  orphan (no longer in controllers): ${o}`));
  process.exit(0);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, add:
```json
"import:netcontent": "cross-env tsx --require dotenv/config scripts/import-netcontent-api.ts",
```

- [ ] **Step 3: Ignore the generated manifest**

Append to `.gitignore`:
```
# NetContent import manifest (regenerated by scripts/import-netcontent-api.ts)
scripts/netcontent/endpoints.manifest.json
```

- [ ] **Step 4: Dry-run against the real controllers**

Run: `npm run import:netcontent -- --dry-run`
Expected: prints `Parsed ~168 endpoints`, writes the manifest, and exits without touching the DB. Inspect `scripts/netcontent/endpoints.manifest.json` — spot-check that TareCheck GET/POST routes and params look right.

- [ ] **Step 5: Typecheck**

Run: `npm run check`
Expected: PASS (tsc -b exit 0).

- [ ] **Step 6: Commit**

```bash
git add scripts/import-netcontent-api.ts package.json .gitignore
git commit -m "feat(netcontent): CLI importer with --dry-run manifest and npm script"
```

---

## Task 8: Full suite + real import

**Files:** none (verification + one-time run).

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — 95 existing + the new parser/mapper/importer tests, 0 failures.

- [ ] **Step 2: Run the real import (writes to the dev DB)**

Ensure `DATABASE_URL` points at the dev DB (not the test DB), then:
Run: `npm run import:netcontent`
Expected: `created: ~168  updated: 0  orphans: 0` under project "NetContent".

- [ ] **Step 3: Verify in the app**

Start WebFlowMaster, open the API Tester / project view, confirm the "NetContent" project holds the endpoints grouped by `module`. Set the environment `baseUrl` to the local DMO host, run one endpoint, and note the auth response (200 nude / 401 / login redirect) — this determines the environment auth setting for the rest.

- [ ] **Step 4: Re-run to confirm idempotency**

Run: `npm run import:netcontent`
Expected: `created: 0  updated: ~168  orphans: 0` — no duplicates; any values you filled in step 3 are preserved.

---

## Self-Review

- **Spec coverage:** parser (Tasks 2–3), manifest artifact (Task 7), mapper with the exact field mapping incl. `status_code < 500` and required/optional queryParams (Task 4), importer with find-or-create project + primary-user resolution (Task 5), idempotent re-run preserving edits + orphan reporting (Task 6), `--dry-run` + `import:netcontent` script + `.gitignore` (Task 7), tests against PGlite (Tasks 5–6, 8). All spec sections mapped.
- **Placeholder scan:** none — every code and test step is complete.
- **Type consistency:** `Endpoint`/`EndpointParam`/`ParseResult` (Task 1) are used verbatim in Tasks 2–5; `MapperConfig`/`KeyValuePair` (Task 4) and `ImportSummary` + `mergeQueryParams` (Task 5) match their call sites in Tasks 6–7; `InsertApiTest` comes from `@shared/schema`.

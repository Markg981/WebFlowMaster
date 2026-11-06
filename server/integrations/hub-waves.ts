/**
 * QA hub waves (shared/hub-waves.ts): reading the test sessions of the QA team out of the hub,
 * keeping them (`hub_waves`, `hub_wave_results`), and making WFM runs of them.
 *
 * Syncing reads Waves/<wave_id>/wave.json and its results_<Module>.json files from the same
 * source the catalog comes from — a folder or an Azure DevOps repository — and re-reads only the
 * waves whose files changed (a hash per file: sha256 for a folder, the blob id for a repository).
 * Each wave is written in a transaction of its own, so a hub of many large waves never holds one
 * long transaction.
 *
 * Importing ("materializing") a wave makes it look like any run: the cases it names that the
 * catalog has but the library does not are imported first (into a suite per module), then one
 * plan `QA wave · <name>` and one execution, `triggered_by` 'hub-import', whose results carry the
 * QA team's verdicts as manual verdicts. The run is written ended: nothing queues it, no
 * notification goes out, quotas and retention see a finished run. Importing again refreshes the
 * results from the hub but keeps every verdict somebody has given in WFM since.
 *
 * WFM never writes to the hub: the way back is an export file in the hub's own format.
 */
import fs from 'fs/promises';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import type { Request } from 'express';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  hubJobs,
  hubTestCases,
  hubWaveResults,
  hubWaves,
  reportTestCaseResults,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  testSuites,
  tests,
  type HubJobKind,
  type HubJobStatus,
  type HubWave,
  type InsertHubWave,
  type HubWaveResultRow,
  type InsertHubWaveResultRow,
  type TestCaseSource,
} from '@shared/schema';
import {
  HUB_WAVES_DIR,
  HUB_WAVE_FILE,
  HUB_WAVE_IMPORT_CHUNK,
  hubResultToWfm,
  isWaveResultsFile,
  parseHubWave,
  parseHubWaveResults,
  type HubResultStatus,
  type HubWaveDefinition,
  type HubWaveImportParams,
  type HubWaveResult,
} from '@shared/hub-waves';
import { manualStepsOf, type ManualResultLog, type ManualStep } from '@shared/manual-tests';
import {
  runWithTenant,
  withTenantTransaction,
  type TenantTx,
} from '../platform/middleware/tenancy';
import logger from '../platform/logger';
import { failuresOf } from '../authoring/test-quarantine';
import { recordAudit, type AuditActor } from '../tenancy/audit';
import {
  API_VERSION,
  HUB_LIMITS,
  HubSourceError,
  adoGetJson,
  azureDevOpsBlobsZip,
  blobIdOfEntry,
  importCases,
  readZipEntries,
  repositoryUrl,
  resolveHubFolder,
  type AzureDevOpsHubConfig,
  type HubReaderDeps,
} from './testcases-hub';

// ─── Limits ────────────────────────────────────────────────────────────────────

export const WAVE_LIMITS = {
  /** Waves in one hub: there are 18 today. */
  maxWaves: 2000,
  /** Files of one wave folder: wave.json and a results file per module. */
  maxFilesPerWave: 200,
  /** One file: the largest wave.json today is under 6 MB, results files under 2 MB. */
  maxFileBytes: 16 * 1024 * 1024,
  /** Cases in one wave. */
  maxEntries: 50_000,
  /** Rows written per statement. */
  writeBatch: 500,
};

/** The zip reader's limits for wave files: an entry may expand to maxFileBytes. */
const WAVE_ZIP_LIMITS = {
  ...HUB_LIMITS,
  maxDefinitionBytes: WAVE_LIMITS.maxFileBytes / 4,
  maxZipEntries: WAVE_LIMITS.maxFilesPerWave,
};

// ─── Readers ───────────────────────────────────────────────────────────────────

/** A wave folder as listed: its files and a hash of each, before anything is read. */
export interface ListedWave {
  folder: string;
  files: Record<string, string>;
}

/** Where the waves come from: a listing that is cheap, and the files of one wave on demand. */
export interface WaveReader {
  list(): Promise<ListedWave[]>;
  read(wave: ListedWave): Promise<Map<string, Buffer>>;
}

function isWaveFile(name: string): boolean {
  return name === HUB_WAVE_FILE || isWaveResultsFile(name);
}

async function hashFile(file: string): Promise<string | null> {
  const handle = await fs.open(file, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > WAVE_LIMITS.maxFileBytes) return null;
    return createHash('sha256')
      .update(await handle.readFile())
      .digest('hex');
  } finally {
    await handle.close();
  }
}

/** Waves of a hub checkout. A folder with no Waves/ has no waves — not an error. */
export function folderWaveReader(folder: string): WaveReader {
  const root = path.join(folder, HUB_WAVES_DIR);
  return {
    async list() {
      const stat = await fs.stat(root).catch(() => null);
      if (!stat?.isDirectory()) return [];
      const waves: ListedWave[] = [];
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const files: Record<string, string> = {};
        const names = (await fs.readdir(path.join(root, entry.name), { withFileTypes: true }))
          .filter((file) => file.isFile() && isWaveFile(file.name))
          .slice(0, WAVE_LIMITS.maxFilesPerWave);
        for (const file of names) {
          const hash = await hashFile(path.join(root, entry.name, file.name));
          if (hash) files[file.name] = hash;
        }
        if (files[HUB_WAVE_FILE]) waves.push({ folder: entry.name, files });
        if (waves.length > WAVE_LIMITS.maxWaves)
          throw new HubSourceError(400, 'too_many_waves', 'The hub has too many waves.');
      }
      return waves;
    },
    async read(wave) {
      const out = new Map<string, Buffer>();
      for (const name of Object.keys(wave.files)) {
        const file = path.join(root, wave.folder, name);
        const stat = await fs.stat(file).catch(() => null);
        if (!stat?.isFile() || stat.size > WAVE_LIMITS.maxFileBytes) continue;
        out.set(name, await fs.readFile(file));
      }
      return out;
    },
  };
}

/** Waves of a hub kept in an Azure DevOps repository: one tree listing, one zip per wave. */
export function azureDevOpsWaveReader(
  config: AzureDevOpsHubConfig,
  deps: HubReaderDeps = {},
): WaveReader {
  return {
    async list() {
      const branch = config.branch.trim() || 'main';
      const version = `versionDescriptor.version=${encodeURIComponent(branch)}&versionDescriptor.versionType=branch`;
      const url = `${repositoryUrl(config)}/items?scopePath=${encodeURIComponent(`/${HUB_WAVES_DIR}`)}&recursionLevel=Full&${version}&api-version=${API_VERSION}`;
      let body;
      try {
        body = await adoGetJson(config, deps, url, 'items', HUB_LIMITS.maxTreeBytes);
      } catch (error) {
        // No Waves/ folder on the branch: a hub with no sessions yet.
        if (error instanceof HubSourceError && error.code === 'repository_not_found') return [];
        throw error;
      }
      const pattern = new RegExp(`^/${HUB_WAVES_DIR}/([^/]+)/([^/]+)$`);
      const byFolder = new Map<string, Record<string, string>>();
      for (const item of body?.value ?? []) {
        if (item?.gitObjectType !== 'blob' || typeof item.path !== 'string') continue;
        const match = pattern.exec(item.path);
        if (!match || !isWaveFile(match[2])) continue;
        if (typeof item.size === 'number' && item.size > WAVE_LIMITS.maxFileBytes) continue;
        const files = byFolder.get(match[1]) ?? {};
        if (Object.keys(files).length >= WAVE_LIMITS.maxFilesPerWave) continue;
        files[match[2]] = String(item.objectId).toLowerCase();
        byFolder.set(match[1], files);
      }
      const waves = Array.from(byFolder, ([folder, files]) => ({ folder, files })).filter(
        (wave) => wave.files[HUB_WAVE_FILE],
      );
      if (waves.length > WAVE_LIMITS.maxWaves)
        throw new HubSourceError(400, 'too_many_waves', 'The hub has too many waves.');
      return waves;
    },
    async read(wave) {
      const ids = Array.from(new Set(Object.values(wave.files)));
      const entries = readZipEntries(await azureDevOpsBlobsZip(config, deps, ids), WAVE_ZIP_LIMITS);
      const byBlob = new Map<string, Buffer>();
      for (const [name, bytes] of entries) byBlob.set(blobIdOfEntry(name), bytes);
      const out = new Map<string, Buffer>();
      for (const [name, blob] of Object.entries(wave.files)) {
        const bytes = byBlob.get(blob);
        if (bytes) out.set(name, bytes);
      }
      return out;
    },
  };
}

/** The wave reader of a saved source. */
export async function waveReaderOf(
  source: TestCaseSource,
  deps: HubReaderDeps & { env?: NodeJS.ProcessEnv; token?: string | null } = {},
): Promise<WaveReader> {
  if (source.kind === 'folder')
    return folderWaveReader(await resolveHubFolder(source.path ?? '', deps.env));
  if (!deps.token)
    throw new HubSourceError(400, 'token_missing', 'The Azure DevOps source has no token.');
  return azureDevOpsWaveReader(
    {
      baseUrl: source.baseUrl ?? '',
      project: source.project ?? '',
      repository: source.repository ?? '',
      branch: source.branch ?? 'main',
      token: deps.token,
    },
    deps,
  );
}

// ─── Sync ──────────────────────────────────────────────────────────────────────

/** One hash for a wave: its files and theirs, in name order. */
export function waveContentHash(files: Record<string, string>): string {
  const hash = createHash('sha256');
  for (const name of Object.keys(files).sort()) hash.update(`${name}\0${files[name]}\n`);
  return hash.digest('hex');
}

/** A wave as read: the definition and every result, merged across its results files. */
export interface ReadWave {
  definition: HubWaveDefinition;
  results: Map<string, HubWaveResult & { fileModule: string | null }>;
  warnings: string[];
}

function parseJson(bytes: Buffer): unknown {
  // The desktop app writes UTF-8, sometimes with a byte order mark.
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}

/** The files of one wave folder, parsed. Null when wave.json is missing or not a wave. */
export function parseWaveFiles(folder: string, files: Map<string, Buffer>): ReadWave | null {
  const warnings: string[] = [];
  const waveBytes = files.get(HUB_WAVE_FILE);
  if (!waveBytes) return null;
  let definition: HubWaveDefinition | null;
  try {
    definition = parseHubWave(parseJson(waveBytes), folder);
  } catch {
    return null;
  }
  if (!definition) return null;
  if (definition.entries.length > WAVE_LIMITS.maxEntries)
    throw new HubSourceError(
      400,
      'too_large',
      `Wave ${definition.waveId} has more than ${WAVE_LIMITS.maxEntries} cases.`,
    );
  const results = new Map<string, HubWaveResult & { fileModule: string | null }>();
  for (const [name, bytes] of files) {
    if (name === HUB_WAVE_FILE) continue;
    let parsed;
    try {
      parsed = parseHubWaveResults(parseJson(bytes));
    } catch {
      warnings.push(`${folder}/${name} is not valid JSON and was skipped.`);
      continue;
    }
    if (!parsed) {
      warnings.push(`${folder}/${name} holds no results and was skipped.`);
      continue;
    }
    for (const result of parsed.results) {
      // One results file per module: a case in two of them is the same case twice, and the
      // later execution is the one that stands.
      const previous = results.get(result.caseId);
      if (previous && (previous.executionDate ?? '') > (result.executionDate ?? '')) continue;
      results.set(result.caseId, { ...result, fileModule: parsed.module });
    }
  }
  return { definition, results, warnings };
}

/** The rows of hub_wave_results for a wave: one per entry, then results that have no entry. */
export function waveResultRows(
  organizationId: number,
  waveRowId: number,
  read: ReadWave,
): InsertHubWaveResultRow[] {
  const rows: InsertHubWaveResultRow[] = [];
  const seen = new Set<string>();
  const rowOf = (
    caseId: string,
    rawCaseId: string,
    entry: HubWaveDefinition['entries'][number] | null,
    result: (HubWaveResult & { fileModule: string | null }) | undefined,
  ): InsertHubWaveResultRow => ({
    organizationId,
    waveRowId,
    caseId,
    rawCaseId,
    module: entry?.module ?? result?.fileModule ?? null,
    definitionModule: entry?.definitionModule ?? null,
    assignedTester: entry?.tester ?? null,
    stage: entry?.stage ?? null,
    stageMetrics: entry?.stageMetrics ?? {},
    status: result?.status ?? 'pending',
    executedBy: result?.tester ?? null,
    executionDate: result?.executionDate ?? null,
    buildNumber: result?.buildNumber ?? null,
    bugReference: result?.bugReference ?? null,
    bugPriority: result?.bugPriority ?? null,
    notes: result?.notes ?? null,
    attempts: result?.attempts ?? [],
    attemptCount: result?.attempts.length ?? 0,
  });
  for (const entry of read.definition.entries) {
    seen.add(entry.caseId);
    rows.push(rowOf(entry.caseId, entry.rawCaseId, entry, read.results.get(entry.caseId)));
  }
  for (const [caseId, result] of read.results) {
    if (seen.has(caseId)) continue;
    rows.push(rowOf(caseId, result.rawCaseId, null, result));
  }
  return rows;
}

function dateOrNull(value: string | null): Date | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

const excluded = (column: { name: string }) => sql.raw(`excluded."${column.name}"`);

/** Writes one wave and its results; results no longer in the hub are removed. */
export async function writeWave(
  tx: TenantTx,
  source: TestCaseSource,
  read: ReadWave,
  files: Record<string, string>,
  now: Date,
): Promise<{ waveRowId: number; created: boolean }> {
  const d = read.definition;
  const values: InsertHubWave = {
    organizationId: source.organizationId,
    sourceId: source.id,
    waveId: d.waveId,
    name: d.name,
    description: d.description,
    release: d.release,
    majorRelease: d.majorRelease,
    waveType: d.waveType,
    status: d.status,
    startDate: d.startDate,
    targetDate: d.targetDate,
    modules: d.modules,
    workbookLinks: d.workbookLinks,
    createdByName: d.createdBy,
    sourceCreatedAt: dateOrNull(d.createdAt),
    sourceUpdatedAt: dateOrNull(d.updatedAt),
    entryCount: 0,
    contentHash: waveContentHash(files),
    fileHashes: files,
    syncedAt: now,
    missingSince: null,
  };
  const [before] = await tx
    .select({ id: hubWaves.id })
    .from(hubWaves)
    .where(and(eq(hubWaves.sourceId, source.id), eq(hubWaves.waveId, d.waveId)))
    .limit(1);
  let waveRowId: number;
  if (before) {
    await tx.update(hubWaves).set(values).where(eq(hubWaves.id, before.id));
    waveRowId = before.id;
  } else {
    const [inserted] = await tx.insert(hubWaves).values(values).returning();
    waveRowId = inserted.id;
  }
  const rows = waveResultRows(source.organizationId, waveRowId, read);
  const c = hubWaveResults;
  for (let start = 0; start < rows.length; start += WAVE_LIMITS.writeBatch) {
    await tx
      .insert(hubWaveResults)
      .values(rows.slice(start, start + WAVE_LIMITS.writeBatch))
      .onConflictDoUpdate({
        target: [hubWaveResults.waveRowId, hubWaveResults.caseId],
        set: {
          rawCaseId: excluded(c.rawCaseId),
          module: excluded(c.module),
          definitionModule: excluded(c.definitionModule),
          assignedTester: excluded(c.assignedTester),
          stage: excluded(c.stage),
          stageMetrics: excluded(c.stageMetrics),
          status: excluded(c.status),
          executedBy: excluded(c.executedBy),
          executionDate: excluded(c.executionDate),
          buildNumber: excluded(c.buildNumber),
          bugReference: excluded(c.bugReference),
          bugPriority: excluded(c.bugPriority),
          notes: excluded(c.notes),
          attempts: excluded(c.attempts),
          attemptCount: excluded(c.attemptCount),
        },
      });
  }
  if (before) {
    const kept = new Set(rows.map((row) => row.caseId));
    const stale = (
      await tx
        .select({ id: hubWaveResults.id, caseId: hubWaveResults.caseId })
        .from(hubWaveResults)
        .where(eq(hubWaveResults.waveRowId, waveRowId))
    )
      .filter((row) => !kept.has(row.caseId))
      .map((row) => row.id);
    for (let start = 0; start < stale.length; start += WAVE_LIMITS.writeBatch)
      await tx
        .delete(hubWaveResults)
        .where(inArray(hubWaveResults.id, stale.slice(start, start + WAVE_LIMITS.writeBatch)));
  }
  await tx.update(hubWaves).set({ entryCount: rows.length }).where(eq(hubWaves.id, waveRowId));
  return { waveRowId, created: !before };
}

export interface WavesSyncOutcome {
  waves: number;
  added: number;
  updated: number;
  unchanged: number;
  missing: number;
  warnings: string[];
}

/** Hooks a job gives the long work: where it is, and whether to stop. */
export interface WorkHooks {
  progress?(done: number, total: number, current: string | null): Promise<void> | void;
  cancelled?(): Promise<boolean> | boolean;
}

/** Thrown between two steps when the job was asked to stop. */
export class WorkCancelled extends Error {
  constructor() {
    super('Cancelled.');
  }
}

/**
 * Reads every wave of the source and writes those that changed. Must run in the organization's
 * tenant context: each wave gets a transaction of its own.
 */
export async function syncWaves(
  source: TestCaseSource,
  reader: WaveReader,
  hooks: WorkHooks = {},
): Promise<WavesSyncOutcome> {
  const listed = await reader.list();
  const known = await withTenantTransaction((tx) =>
    tx
      .select({
        id: hubWaves.id,
        waveId: hubWaves.waveId,
        contentHash: hubWaves.contentHash,
        missingSince: hubWaves.missingSince,
      })
      .from(hubWaves)
      .where(eq(hubWaves.sourceId, source.id)),
  );
  // Waves are keyed by wave_id; a folder renamed after its wave keeps its row.
  const knownByFolderHash = new Map(known.map((row) => [row.contentHash, row]));
  const outcome: WavesSyncOutcome = {
    waves: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    warnings: [],
  };
  const present = new Set<number>();
  const now = new Date();
  let done = 0;
  for (const wave of listed) {
    if (await hooks.cancelled?.()) throw new WorkCancelled();
    await hooks.progress?.(done, listed.length, wave.folder);
    done++;
    const same = knownByFolderHash.get(waveContentHash(wave.files));
    if (same && !same.missingSince) {
      present.add(same.id);
      outcome.waves++;
      outcome.unchanged++;
      continue;
    }
    const read = parseWaveFiles(wave.folder, await reader.read(wave));
    if (!read) {
      outcome.warnings.push(`${wave.folder}/${HUB_WAVE_FILE} is not a wave and was skipped.`);
      continue;
    }
    outcome.warnings.push(...read.warnings);
    const written = await withTenantTransaction((tx) =>
      writeWave(tx, source, read, wave.files, now),
    );
    present.add(written.waveRowId);
    outcome.waves++;
    if (written.created) outcome.added++;
    else outcome.updated++;
  }
  await hooks.progress?.(listed.length, listed.length, null);
  // Waves no longer in the hub keep their rows and their runs: the history is the point.
  const gone = known.filter((row) => !present.has(row.id) && !row.missingSince).map((r) => r.id);
  await withTenantTransaction(async (tx) => {
    if (gone.length)
      await tx.update(hubWaves).set({ missingSince: now }).where(inArray(hubWaves.id, gone));
    const [missing] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(hubWaves)
      .where(and(eq(hubWaves.sourceId, source.id), sql`${hubWaves.missingSince} is not null`));
    outcome.missing = Number(missing?.n ?? 0);
  });
  return outcome;
}

// ─── Import (materialize) ──────────────────────────────────────────────────────

/** Who the import acts for: what importCases and the audit need of a request. */
export interface WaveActor {
  id: number;
  username: string;
  organizationId: number;
  role: string;
  ip: string | null;
}

function requestOf(actor: WaveActor): Request {
  return {
    user: {
      id: actor.id,
      username: actor.username,
      organizationId: actor.organizationId,
      role: actor.role,
    },
    ip: actor.ip ?? undefined,
  } as unknown as Request;
}

function auditActorOf(actor: WaveActor): AuditActor {
  return { id: actor.id, username: actor.username, apiKeyId: null, ipAddress: actor.ip };
}

export const WAVE_SUITE_PREFIX = 'QA hub · ';
export const WAVE_PLAN_PREFIX = 'QA wave · ';

export interface WaveImportOutcome {
  waveId: string;
  testPlanId: string;
  executionId: string;
  results: number;
  imported: number;
  linked: number;
  /** Cases the catalog does not have: in the run by their id, with no test behind them. */
  notInCatalog: number;
  /** Verdicts given in WFM since the last import, kept over the hub's. */
  keptWfmVerdicts: number;
  status: 'completed' | 'failed';
}

async function chunked<T, R>(items: T[], size: number, fn: (chunk: T[]) => Promise<R[]>) {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += size)
    out.push(...(await fn(items.slice(start, start + size))));
  return out;
}

/** The suite a module's imported cases go to in the project, or null when there is none yet. */
async function moduleSuite(tx: TenantTx, projectId: number | null, module: string) {
  const [suite] = await tx
    .select({ id: testSuites.id, kind: testSuites.kind })
    .from(testSuites)
    .where(
      and(
        eq(testSuites.name, `${WAVE_SUITE_PREFIX}${module}`),
        projectId == null ? isNull(testSuites.projectId) : eq(testSuites.projectId, projectId),
      ),
    )
    .limit(1);
  return suite?.kind === 'static' ? suite.id : null;
}

/**
 * The cases of the wave the catalog has and the library does not, imported as manual tests: a
 * chunk per transaction, each module into its suite. Returns how many tests were made.
 */
async function importMissingCases(
  actor: WaveActor,
  params: Pick<HubWaveImportParams, 'projectId' | 'variant'>,
  /** Each case of the wave, with the module the QA team runs it under. */
  waveModules: Map<string, string | null>,
  hooks: WorkHooks,
): Promise<number> {
  const caseIds = Array.from(waveModules.keys());
  const catalog = await withTenantTransaction((tx) =>
    chunked(caseIds, 1000, (chunk) =>
      tx
        .select({
          caseId: hubTestCases.caseId,
          module: hubTestCases.module,
          testId: hubTestCases.testId,
          missingSince: hubTestCases.missingSince,
        })
        .from(hubTestCases)
        .where(inArray(hubTestCases.caseId, chunk)),
    ),
  );
  const byModule = new Map<string, string[]>();
  for (const row of catalog) {
    if (row.testId != null || row.missingSince) continue;
    // The wave's module name ("DMO Archiving") is the one the QA team knows the case by; the
    // catalog's (ARC) only when the wave has none.
    const module = waveModules.get(row.caseId) ?? row.module;
    const list = byModule.get(module) ?? [];
    list.push(row.caseId);
    byModule.set(module, list);
  }
  const total = Array.from(byModule.values()).reduce((sum, list) => sum + list.length, 0);
  let done = 0;
  let created = 0;
  const req = requestOf(actor);
  for (const [module, list] of byModule) {
    let suiteId = await withTenantTransaction((tx) => moduleSuite(tx, params.projectId, module));
    for (let start = 0; start < list.length; start += HUB_WAVE_IMPORT_CHUNK) {
      if (await hooks.cancelled?.()) throw new WorkCancelled();
      await hooks.progress?.(done, total, module);
      const chunk = list.slice(start, start + HUB_WAVE_IMPORT_CHUNK);
      const result = await withTenantTransaction((tx) =>
        importCases(tx, req, {
          caseIds: chunk,
          projectId: params.projectId,
          suiteId,
          newSuiteName: suiteId == null ? `${WAVE_SUITE_PREFIX}${module}` : null,
          variant: params.variant,
        }),
      );
      suiteId = result.suiteId;
      created += result.created;
      done += chunk.length;
    }
  }
  await hooks.progress?.(total, total, null);
  return created;
}

interface LinkedTest {
  id: number;
  name: string;
  steps: ManualStep[];
  module: string | null;
  featureArea: string | null;
  scenario: string | null;
  priority: string | null;
}

/** A verdict somebody gave in WFM — not one an import wrote. */
function wfmVerdictOf(detailedLog: string | null): ManualResultLog | null {
  if (!detailedLog || !detailedLog.startsWith('{')) return null;
  try {
    const log = JSON.parse(detailedLog) as ManualResultLog;
    return log?.manual === true && log.verdict && !log.verdict.imported ? log : null;
  } catch {
    return null;
  }
}

/** The key a result row is matched on between two imports of the same wave. */
function resultKey(row: { uiTestId: number | null; testName: string }): string {
  return row.uiTestId != null ? `t:${row.uiTestId}` : `n:${row.testName}`;
}

function planDescription(wave: HubWave): string {
  const parts = [
    `Imported from the QA hub wave ${wave.waveId}.`,
    wave.release ? `Release ${wave.release}.` : null,
    wave.waveType ? `${wave.waveType} wave.` : null,
  ];
  return parts.filter(Boolean).join(' ');
}

/**
 * Makes the wave a plan and an ended run. The wave must have been synced. Must run in the
 * organization's tenant context; the caller has checked the user may edit the project.
 */
export async function materializeWave(
  actor: WaveActor,
  waveRowId: number,
  params: Pick<HubWaveImportParams, 'projectId' | 'variant'>,
  hooks: WorkHooks = {},
): Promise<WaveImportOutcome> {
  const { wave, results } = await withTenantTransaction(async (tx) => {
    const [wave] = await tx.select().from(hubWaves).where(eq(hubWaves.id, waveRowId)).limit(1);
    if (!wave) throw new HubSourceError(404, 'wave_not_found', 'The wave does not exist.');
    const results = await tx
      .select()
      .from(hubWaveResults)
      .where(eq(hubWaveResults.waveRowId, waveRowId))
      .orderBy(hubWaveResults.id);
    return { wave, results };
  });
  const caseIds = results.map((row) => row.caseId);
  const imported = await importMissingCases(
    actor,
    params,
    new Map(results.map((row) => [row.caseId, row.module])),
    hooks,
  );

  if (await hooks.cancelled?.()) throw new WorkCancelled();
  return withTenantTransaction(async (tx) => {
    // What each case is in the library now that the missing ones were imported.
    const catalog = await chunked(caseIds, 1000, (chunk) =>
      tx
        .select({ caseId: hubTestCases.caseId, testId: hubTestCases.testId })
        .from(hubTestCases)
        .where(inArray(hubTestCases.caseId, chunk)),
    );
    const testIdOf = new Map(
      catalog.filter((row) => row.testId != null).map((row) => [row.caseId, row.testId!]),
    );
    const linkedRows = await chunked(Array.from(new Set(testIdOf.values())), 1000, (chunk) =>
      tx
        .select({
          id: tests.id,
          name: tests.name,
          sequence: tests.sequence,
          module: tests.module,
          featureArea: tests.featureArea,
          scenario: tests.scenario,
          priority: tests.priority,
        })
        .from(tests)
        .where(inArray(tests.id, chunk)),
    );
    const linked = new Map<number, LinkedTest>(
      linkedRows.map((row) => [row.id, { ...row, steps: manualStepsOf(row.sequence) }]),
    );

    // The plan: the wave's tests, in the wave's order.
    const planTests = Array.from(
      new Set(results.map((row) => testIdOf.get(row.caseId)).filter((id) => id && linked.has(id))),
    ) as number[];
    const planName = `${WAVE_PLAN_PREFIX}${wave.name}`.slice(0, 200);
    let planId = wave.testPlanId;
    if (planId) {
      const [plan] = await tx
        .select({ id: testPlans.id })
        .from(testPlans)
        .where(eq(testPlans.id, planId))
        .limit(1);
      if (!plan) planId = null;
    }
    if (planId) {
      await tx
        .update(testPlans)
        .set({ name: planName, description: planDescription(wave), updatedAt: new Date() })
        .where(eq(testPlans.id, planId));
      await tx.delete(testPlanSelectedTests).where(eq(testPlanSelectedTests.testPlanId, planId));
    } else {
      planId = randomUUID();
      await tx.insert(testPlans).values({
        id: planId,
        userId: actor.id,
        organizationId: actor.organizationId,
        name: planName,
        description: planDescription(wave),
        testMachinesConfig: null,
        notificationSettings: null,
      });
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.PLAN_CREATED,
        actor: auditActorOf(actor),
        targetType: 'test_plan',
        targetId: planId,
        metadata: { name: planName, tests: planTests.length, hubWave: wave.waveId },
      });
    }
    for (let start = 0; start < planTests.length; start += WAVE_LIMITS.writeBatch)
      await tx.insert(testPlanSelectedTests).values(
        planTests.slice(start, start + WAVE_LIMITS.writeBatch).map((testId) => ({
          testPlanId: planId!,
          organizationId: actor.organizationId,
          testId,
          apiTestId: null,
          mobileTestId: null,
          testType: 'ui',
        })),
      );

    // The run: one per wave, ended, as the QA team left it.
    let executionId = wave.executionId;
    const kept = new Map<string, typeof reportTestCaseResults.$inferSelect>();
    if (executionId) {
      const [run] = await tx
        .select({ id: testPlanExecutions.id })
        .from(testPlanExecutions)
        .where(eq(testPlanExecutions.id, executionId))
        .limit(1);
      if (!run) executionId = null;
    }
    const startedAt = dateOrNull(wave.startDate) ?? firstExecution(results) ?? new Date();
    const completedAt = lastExecution(results) ?? dateOrNull(wave.targetDate) ?? startedAt;
    if (executionId) {
      const previous = await tx
        .select()
        .from(reportTestCaseResults)
        .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
      for (const row of previous) if (wfmVerdictOf(row.detailedLog)) kept.set(resultKey(row), row);
      await tx
        .delete(reportTestCaseResults)
        .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
      await tx
        .update(testPlanExecutions)
        .set({ testPlanId: planId, startedAt, completedAt })
        .where(eq(testPlanExecutions.id, executionId));
    } else {
      executionId = randomUUID();
      await tx.insert(testPlanExecutions).values({
        id: executionId,
        testPlanId: planId,
        organizationId: actor.organizationId,
        requestedByUserId: actor.id,
        status: 'completed',
        triggeredBy: 'hub-import',
        queuedAt: startedAt,
        startedAt,
        completedAt,
        idempotencyKey: `qa-hub-wave:${wave.id}`,
        configurationSnapshot: { hubWave: { waveId: wave.waveId, release: wave.release } },
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
      });
    }

    const at = new Date().toISOString();
    let keptWfmVerdicts = 0;
    let notInCatalog = 0;
    const rows = results.map((row) => {
      const test = linked.get(testIdOf.get(row.caseId) ?? -1);
      if (!test) notInCatalog++;
      const base = {
        uiTestId: test?.id ?? null,
        testName: test?.name ?? row.caseId,
      };
      const previous = kept.get(resultKey(base));
      if (previous) {
        keptWfmVerdicts++;
        const { id: _id, ...rest } = previous;
        return { ...rest, id: randomUUID(), testPlanExecutionId: executionId! };
      }
      const outcome = hubResultToWfm(row.status as HubResultStatus);
      const log: ManualResultLog = { manual: true, steps: test?.steps ?? [] };
      if (outcome.verdict)
        log.verdict = {
          outcome: outcome.verdict,
          notes: row.notes,
          stepOutcomes: [],
          byUserId: actor.id,
          byUsername: actor.username,
          at,
          imported: {
            source: 'qa-hub',
            waveId: wave.waveId,
            tester: row.executedBy,
            executionDate: row.executionDate,
            buildNumber: row.buildNumber,
            bugReference: row.bugReference,
            hubStatus: row.status,
            attempts: row.attemptCount,
          },
        };
      const executed = dateOrNull(row.executionDate);
      return {
        id: randomUUID(),
        testPlanExecutionId: executionId!,
        organizationId: actor.organizationId,
        ...base,
        apiTestId: null,
        mobileTestId: null,
        testType: 'ui',
        browser: null,
        status: outcome.status,
        attempts: Math.max(row.attemptCount, 1),
        quarantined: false,
        reasonForFailure: reasonOf(row, outcome),
        detailedLog: JSON.stringify(log),
        startedAt: executed ?? startedAt,
        completedAt: outcome.verdict ? (executed ?? completedAt) : null,
        durationMs: null,
        module: row.module ?? test?.module ?? null,
        featureArea: test?.featureArea ?? null,
        scenario: test?.scenario ?? null,
        priority: test?.priority ?? null,
      };
    });
    for (let start = 0; start < rows.length; start += WAVE_LIMITS.writeBatch)
      await tx
        .insert(reportTestCaseResults)
        .values(rows.slice(start, start + WAVE_LIMITS.writeBatch));

    // Totals and ending with the rule a verdict given in WFM uses (manual-results.routes.ts).
    const verdicts = rows.map((row) => ({ status: row.status, quarantined: row.quarantined }));
    const failures = failuresOf(verdicts);
    const status = failures.holding > 0 ? 'failed' : 'completed';
    await tx
      .update(testPlanExecutions)
      .set({
        status,
        totalTests: rows.length,
        passedTests: rows.filter((row) => row.status === 'Passed').length,
        failedTests: rows.filter((row) => row.status === 'Failed').length,
        skippedTests: rows.filter((row) => row.status === 'Skipped').length,
        quarantinedFailures: failures.quarantined,
        executionDurationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      })
      .where(eq(testPlanExecutions.id, executionId));

    await tx
      .update(hubWaves)
      .set({
        testPlanId: planId,
        executionId,
        materializedHash: wave.contentHash,
        materializedAt: new Date(),
        materializedBy: actor.id,
      })
      .where(eq(hubWaves.id, wave.id));

    return {
      waveId: wave.waveId,
      testPlanId: planId,
      executionId,
      results: rows.length,
      imported,
      linked: rows.length - notInCatalog,
      notInCatalog,
      keptWfmVerdicts,
      status,
    };
  });
}

function reasonOf(
  row: HubWaveResultRow,
  outcome: ReturnType<typeof hubResultToWfm>,
): string | null {
  if (outcome.status === 'Passed' || outcome.status === 'Pending') return null;
  const bug = row.bugReference ? `Bug ${row.bugReference}` : null;
  return [row.notes, bug].filter(Boolean).join(' — ') || outcome.reason || 'Failed';
}

function firstExecution(results: HubWaveResultRow[]): Date | null {
  let first: Date | null = null;
  for (const row of results) {
    const date = dateOrNull(row.executionDate);
    if (date && (!first || date < first)) first = date;
  }
  return first;
}

function lastExecution(results: HubWaveResultRow[]): Date | null {
  let last: Date | null = null;
  for (const row of results) {
    const date = dateOrNull(row.executionDate);
    if (date && (!last || date > last)) last = date;
  }
  return last;
}

// ─── Jobs ──────────────────────────────────────────────────────────────────────

/** A running job that has not beaten for this long died with its process. */
export const HUB_JOB_STALE_MS = 10 * 60 * 1000;
/** How often a job writes where it is, and looks whether it was asked to stop. */
const HUB_JOB_BEAT_MS = 1000;

/** Thrown when a job is asked for while another one is live on the source. */
export class HubJobBusyError extends HubSourceError {
  constructor(public readonly jobId: string | null) {
    super(409, 'job_running', 'Another sync or import of the hub is still running.');
  }
}

const running = new Map<string, Promise<void>>();

/** Every job started by this process and not finished yet — for tests, and a clean shutdown. */
export async function settleHubJobs(): Promise<void> {
  while (running.size) await Promise.allSettled(Array.from(running.values()));
}

function isUniqueViolation(error: unknown): boolean {
  const record = error as { code?: string; message?: string; cause?: { code?: string } } | null;
  return (
    record?.code === '23505' ||
    record?.cause?.code === '23505' ||
    String(record?.message ?? '')
      .toLowerCase()
      .includes('hub_jobs_one_live_per_source')
  );
}

export interface StartedJob {
  id: string;
  kind: HubJobKind;
  status: HubJobStatus;
}

/**
 * Records a job and runs `work` after the caller has answered, in the organization's tenant
 * context with the requester as principal. One live job per source: a second is refused with
 * HubJobBusyError, except over a job that stopped beating (its process died) — that one is
 * marked failed first.
 */
export async function startHubJob(
  actor: WaveActor,
  sourceId: string,
  kind: HubJobKind,
  params: Record<string, unknown>,
  work: (hooks: WorkHooks) => Promise<Record<string, unknown>>,
): Promise<StartedJob> {
  const id = randomUUID();
  await withTenantTransaction(async (tx) => {
    const stale = new Date(Date.now() - HUB_JOB_STALE_MS);
    await tx
      .update(hubJobs)
      .set({ status: 'failed', error: 'The job stopped responding.', finishedAt: new Date() })
      .where(
        and(
          eq(hubJobs.sourceId, sourceId),
          inArray(hubJobs.status, ['queued', 'running']),
          sql`coalesce(${hubJobs.heartbeatAt}, ${hubJobs.createdAt}) < ${stale}`,
        ),
      );
  });
  try {
    await withTenantTransaction(async (tx) => {
      await tx.insert(hubJobs).values({
        id,
        organizationId: actor.organizationId,
        sourceId,
        kind,
        status: 'queued',
        params,
        requestedBy: actor.id,
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [live] = await withTenantTransaction((tx) =>
      tx
        .select({ id: hubJobs.id })
        .from(hubJobs)
        .where(and(eq(hubJobs.sourceId, sourceId), inArray(hubJobs.status, ['queued', 'running'])))
        .limit(1),
    );
    throw new HubJobBusyError(live?.id ?? null);
  }

  const run = runWithTenant(actor.organizationId, () => runJob(id, work), {
    userId: actor.id,
    role: actor.role,
  }).finally(() => running.delete(id));
  running.set(id, run);
  return { id, kind, status: 'queued' };
}

async function runJob(
  id: string,
  work: (hooks: WorkHooks) => Promise<Record<string, unknown>>,
): Promise<void> {
  const update = (values: Partial<typeof hubJobs.$inferInsert>) =>
    withTenantTransaction(async (tx) => {
      await tx.update(hubJobs).set(values).where(eq(hubJobs.id, id));
    });
  let lastBeat = 0;
  let stop = false;
  const hooks: WorkHooks = {
    async progress(done, total, current) {
      const now = Date.now();
      if (now - lastBeat < HUB_JOB_BEAT_MS && done < total) return;
      lastBeat = now;
      await update({ progress: { done, total, current }, heartbeatAt: new Date(now) });
    },
    async cancelled() {
      if (stop) return true;
      const [row] = await withTenantTransaction((tx) =>
        tx
          .select({ cancelRequestedAt: hubJobs.cancelRequestedAt })
          .from(hubJobs)
          .where(eq(hubJobs.id, id))
          .limit(1),
      );
      stop = row?.cancelRequestedAt != null;
      return stop;
    },
  };
  try {
    await update({ status: 'running', startedAt: new Date(), heartbeatAt: new Date() });
    const summary = await work(hooks);
    await update({ status: 'succeeded', summary, finishedAt: new Date() });
  } catch (error) {
    const cancelled = error instanceof WorkCancelled;
    if (!cancelled && !(error instanceof HubSourceError))
      logger.error({
        message: 'QA hub job failed',
        jobId: id,
        error: (error as Error)?.message ?? String(error),
      });
    await update({
      status: cancelled ? 'cancelled' : 'failed',
      error: cancelled
        ? null
        : error instanceof HubSourceError
          ? error.message
          : 'The job failed. See the server log.',
      finishedAt: new Date(),
    }).catch(() => undefined);
  }
}

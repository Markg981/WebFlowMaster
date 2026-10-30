/**
 * Reading the QA test case hub (shared/testcases-hub.ts) and turning its cases into tests.
 *
 * Two readers give the same thing — every definition.json under TestCasesDefinitions/ — from two
 * places: a folder the server can see, and an Azure DevOps git repository. The server image has
 * no git, so the repository is read through the Git REST API: the tree once, then the blobs in
 * zips of a few hundred, inflated here with zlib (no archive library in the dependencies, and the
 * limits below are the whole reason to read the zip by hand).
 *
 * Refreshing writes the catalog (`hub_test_cases`); importing makes manual tests of chosen rows.
 */
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { inflateRawSync } from 'zlib';
import type { Request } from 'express';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  hubTestCases,
  testSuiteItems,
  testSuites,
  tests,
  type HubTestCase,
  type TestCaseSource,
} from '@shared/schema';
import {
  HUB_DEFINITIONS_DIR,
  HUB_DEFINITION_FILE,
  HUB_MODULES_FILE,
  hubCaseFingerprint,
  hubCaseToManualSteps,
  hubPriorityToWfm,
  hubTestName,
  parseHubDefinition,
  type HubCaseDefinition,
  type HubStepsOptions,
} from '@shared/testcases-hub';
import { isManualSequence, toSequence } from '@shared/manual-tests';
import type { TenantTx } from '../platform/middleware/tenancy';
import { fetchTarget } from '../platform/outbound-http';
import { recordTestVersion } from '../authoring/test-version-store';
import { auditActor, recordAudit } from '../tenancy/audit';
import logger from '../platform/logger';

/** A problem the caller can show: the status is the HTTP answer, the code is for the client. */
export class HubSourceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// ─── Limits ────────────────────────────────────────────────────────────────────

export const HUB_LIMITS = {
  /** More definitions than this and the read stops: the hub has ~19 000 today. */
  maxCases: 60_000,
  /** One definition.json; the largest today is under 10 KB. */
  maxDefinitionBytes: 1024 * 1024,
  /** config/modules.json. */
  maxModulesBytes: 4 * 1024 * 1024,
  /** Blobs asked for in one zip. */
  blobBatch: 400,
  /** One zip from Azure DevOps, compressed. */
  maxZipBytes: 64 * 1024 * 1024,
  maxZipEntries: 1000,
  maxCompressionRatio: 200,
  /** The tree listing of the repository, as JSON. */
  maxTreeBytes: 128 * 1024 * 1024,
};

// ─── Folder sources ────────────────────────────────────────────────────────────

/**
 * The directories an organization may point a folder source at, from TESTCASE_HUB_ROOTS
 * (path.delimiter-separated). None configured, no folder source: a path typed by a tenant must
 * never be a way to read the server's disk.
 */
export function allowedHubRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.TESTCASE_HUB_ROOTS ?? '')
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter((root) => root !== '')
    .map((root) => path.resolve(root));
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * The folder, resolved through its symlinks, when it lies under an allowed root; otherwise a
 * refusal that says so without echoing what the server's disk looks like.
 */
export async function resolveHubFolder(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const roots = allowedHubRoots(env);
  if (roots.length === 0)
    throw new HubSourceError(
      400,
      'folder_sources_disabled',
      'The operator has not allowed any folder for test case hubs (TESTCASE_HUB_ROOTS).',
    );
  const trimmed = input.trim();
  if (trimmed === '' || trimmed.includes('\0'))
    throw new HubSourceError(400, 'path_invalid', 'The path is not valid.');
  const resolved = path.resolve(trimmed);
  if (!roots.some((root) => within(root, resolved)))
    throw new HubSourceError(
      400,
      'path_not_allowed',
      'The path is outside the folders the operator allows for test case hubs.',
    );
  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch {
    throw new HubSourceError(400, 'path_missing', 'The folder does not exist on the server.');
  }
  const realRoots = await Promise.all(roots.map((root) => fs.realpath(root).catch(() => root)));
  if (!realRoots.some((root) => within(root, real)))
    throw new HubSourceError(
      400,
      'path_not_allowed',
      'The path is outside the folders the operator allows for test case hubs.',
    );
  const stat = await fs.stat(real).catch(() => null);
  if (!stat?.isDirectory())
    throw new HubSourceError(400, 'path_missing', 'The path is not a folder.');
  return real;
}

/** What a reader gives back: every case, the modules the hub names, and the commit if it knows one. */
export interface HubSnapshot {
  cases: HubCaseDefinition[];
  modules: string[];
  head: string | null;
  /** Files that were skipped and why — a definition that does not parse is not a reason to stop. */
  warnings: string[];
}

/**
 * One definition.json, checked and read through one handle, so the file measured is the file
 * read even if the hub is being written to meanwhile.
 */
async function readDefinition(
  file: string,
): Promise<{ kind: 'absent' } | { kind: 'too_large' } | { kind: 'read'; text: string }> {
  const handle = await fs.open(file, 'r').catch(() => null);
  if (!handle) return { kind: 'absent' };
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { kind: 'absent' };
    if (stat.size > HUB_LIMITS.maxDefinitionBytes) return { kind: 'too_large' };
    const text = await handle.readFile('utf8');
    return text.length > HUB_LIMITS.maxDefinitionBytes
      ? { kind: 'too_large' }
      : { kind: 'read', text };
  } finally {
    await handle.close();
  }
}

function parseModules(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((entry) =>
      entry && typeof entry === 'object'
        ? String((entry as { module_name?: unknown }).module_name ?? '').trim()
        : '',
    )
    .filter((name) => name !== '');
}

/** The commit a checkout is at, from .git alone — best effort, null when there is no clue. */
async function folderHead(folder: string): Promise<string | null> {
  try {
    const head = (await fs.readFile(path.join(folder, '.git', 'HEAD'), 'utf8')).trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head;
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1]?.trim();
    if (!ref) return null;
    const direct = await fs
      .readFile(path.join(folder, '.git', ...ref.split('/')), 'utf8')
      .catch(() => null);
    if (direct && /^[0-9a-f]{40}$/i.test(direct.trim())) return direct.trim();
    const packed = await fs
      .readFile(path.join(folder, '.git', 'packed-refs'), 'utf8')
      .catch(() => '');
    const line = packed.split('\n').find((entry) => entry.endsWith(` ${ref}`));
    const sha = line?.split(' ')[0];
    return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** Reads a hub checkout: TestCasesDefinitions/<module>/<case>/definition.json, nothing else. */
export async function readHubFolder(folder: string): Promise<HubSnapshot> {
  const definitions = path.join(folder, HUB_DEFINITIONS_DIR);
  const root = await fs.stat(definitions).catch(() => null);
  if (!root?.isDirectory())
    throw new HubSourceError(
      400,
      'not_a_hub',
      `The folder has no ${HUB_DEFINITIONS_DIR}/ directory: it is not a test case hub.`,
    );
  const warnings: string[] = [];
  const cases: HubCaseDefinition[] = [];
  const modulesJson = await fs
    .readFile(path.join(folder, HUB_MODULES_FILE), 'utf8')
    .then((text) => (text.length > HUB_LIMITS.maxModulesBytes ? null : JSON.parse(text)))
    .catch(() => null);
  const modules = parseModules(modulesJson);
  for (const moduleEntry of await fs.readdir(definitions, { withFileTypes: true })) {
    if (!moduleEntry.isDirectory()) continue;
    const moduleDir = path.join(definitions, moduleEntry.name);
    for (const caseEntry of await fs.readdir(moduleDir, { withFileTypes: true })) {
      if (!caseEntry.isDirectory()) continue;
      const file = path.join(moduleDir, caseEntry.name, HUB_DEFINITION_FILE);
      const where = `${moduleEntry.name}/${caseEntry.name}`;
      const read = await readDefinition(file);
      if (read.kind === 'absent') continue;
      if (read.kind === 'too_large') {
        warnings.push(`${where}: definition.json is too large and was skipped.`);
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(read.text);
      } catch {
        warnings.push(`${where}: definition.json is not valid JSON and was skipped.`);
        continue;
      }
      const parsed = parseHubDefinition(json, {
        module: moduleEntry.name,
        caseFolder: caseEntry.name,
      });
      if (!parsed) {
        warnings.push(`${where}: definition.json has no id and was skipped.`);
        continue;
      }
      cases.push(parsed);
      if (cases.length > HUB_LIMITS.maxCases)
        throw new HubSourceError(
          400,
          'too_many_cases',
          `The hub has more than ${HUB_LIMITS.maxCases} cases.`,
        );
    }
  }
  return { cases, modules, head: await folderHead(folder), warnings };
}

// ─── Azure DevOps sources ──────────────────────────────────────────────────────

export interface AzureDevOpsHubConfig {
  /** `https://dev.azure.com/my-org` — the organization, not the project. */
  baseUrl: string;
  project: string;
  repository: string;
  branch: string;
  token: string;
}

export interface HubReaderDeps {
  fetchImpl?: typeof fetch;
}

const API_VERSION = '7.0';

function normaliseBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function repositoryUrl(config: AzureDevOpsHubConfig): string {
  const base = normaliseBaseUrl(config.baseUrl);
  return `${base}/${encodeURIComponent(config.project.trim())}/_apis/git/repositories/${encodeURIComponent(config.repository.trim())}`;
}

function authHeader(token: string): string {
  return `Basic ${Buffer.from(`:${token}`, 'utf8').toString('base64')}`;
}

function describeHttpFailure(status: number, what: string): HubSourceError {
  if (status === 401 || status === 203)
    return new HubSourceError(400, 'token_refused', 'Azure DevOps refused the token.');
  if (status === 403)
    return new HubSourceError(
      400,
      'token_refused',
      'The token is not allowed to read this repository (it needs Code: Read).',
    );
  if (status === 404)
    return new HubSourceError(
      400,
      'repository_not_found',
      'Azure DevOps has no such project, repository or branch.',
    );
  return new HubSourceError(502, 'upstream_failed', `Azure DevOps answered ${status} to ${what}.`);
}

/** What the Azure DevOps REST API answers with: a list under `value`, or one object. */
type AdoJson = { value?: Array<Record<string, unknown>>; objectId?: unknown } | null;

async function adoGetJson(
  config: AzureDevOpsHubConfig,
  deps: HubReaderDeps,
  url: string,
  what: string,
  maxBytes: number,
): Promise<AdoJson> {
  const send = deps.fetchImpl ?? fetchTarget;
  let response: Response;
  try {
    response = await send(url, {
      headers: { Authorization: authHeader(config.token), Accept: 'application/json' },
    });
  } catch (error) {
    throw new HubSourceError(
      502,
      'upstream_unreachable',
      `Azure DevOps could not be reached: ${(error as Error).message}`,
    );
  }
  if (!response.ok) throw describeHttpFailure(response.status, what);
  const text = await response.text();
  if (text.length > maxBytes)
    throw new HubSourceError(400, 'too_large', `The ${what} answer is larger than allowed.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new HubSourceError(
      502,
      'upstream_failed',
      `Azure DevOps answered ${what} with something other than JSON.`,
    );
  }
}

/** The commit the branch is at. */
export async function azureDevOpsHead(
  config: AzureDevOpsHubConfig,
  deps: HubReaderDeps = {},
): Promise<string> {
  const branch = config.branch.trim() || 'main';
  const url = `${repositoryUrl(config)}/refs?filter=${encodeURIComponent(`heads/${branch}`)}&api-version=${API_VERSION}`;
  const body = await adoGetJson(config, deps, url, 'refs', 1024 * 1024);
  const wanted = `refs/heads/${branch}`;
  const ref = (body?.value ?? []).find((entry) => entry.name === wanted);
  if (!ref?.objectId)
    throw new HubSourceError(400, 'repository_not_found', `The branch ${branch} does not exist.`);
  return String(ref.objectId);
}

interface TreeBlob {
  objectId: string;
  module: string;
  caseFolder: string;
}

/** Every definition.json under TestCasesDefinitions/, with the blob that holds it. */
async function azureDevOpsTree(
  config: AzureDevOpsHubConfig,
  deps: HubReaderDeps,
): Promise<{ blobs: TreeBlob[]; modulesBlob: string | null }> {
  const branch = config.branch.trim() || 'main';
  const version = `versionDescriptor.version=${encodeURIComponent(branch)}&versionDescriptor.versionType=branch`;
  const url = `${repositoryUrl(config)}/items?scopePath=${encodeURIComponent(`/${HUB_DEFINITIONS_DIR}`)}&recursionLevel=Full&${version}&api-version=${API_VERSION}`;
  const body = await adoGetJson(config, deps, url, 'items', HUB_LIMITS.maxTreeBytes);
  const pattern = new RegExp(`^/${HUB_DEFINITIONS_DIR}/([^/]+)/([^/]+)/${HUB_DEFINITION_FILE}$`);
  const blobs: TreeBlob[] = [];
  for (const item of body?.value ?? []) {
    if (item?.gitObjectType !== 'blob' || typeof item.path !== 'string') continue;
    const match = pattern.exec(item.path);
    if (!match) continue;
    if (typeof item.size === 'number' && item.size > HUB_LIMITS.maxDefinitionBytes) continue;
    blobs.push({ objectId: String(item.objectId), module: match[1], caseFolder: match[2] });
    if (blobs.length > HUB_LIMITS.maxCases)
      throw new HubSourceError(
        400,
        'too_many_cases',
        `The hub has more than ${HUB_LIMITS.maxCases} cases.`,
      );
  }
  if (blobs.length === 0 && !(body?.value ?? []).length)
    throw new HubSourceError(
      400,
      'not_a_hub',
      `The repository has no ${HUB_DEFINITIONS_DIR}/ directory on ${branch}: it is not a test case hub.`,
    );
  const modulesUrl = `${repositoryUrl(config)}/items?path=${encodeURIComponent(`/${HUB_MODULES_FILE}`)}&${version}&api-version=${API_VERSION}`;
  const modules = await adoGetJson(config, deps, modulesUrl, 'modules', 1024 * 1024).catch(
    () => null,
  );
  return { blobs, modulesBlob: modules?.objectId ? String(modules.objectId) : null };
}

/** The blobs named, as a zip whose entries are named by blob id. */
async function azureDevOpsBlobsZip(
  config: AzureDevOpsHubConfig,
  deps: HubReaderDeps,
  objectIds: string[],
): Promise<Buffer> {
  const send = deps.fetchImpl ?? fetchTarget;
  const url = `${repositoryUrl(config)}/blobs?api-version=${API_VERSION}`;
  let response: Response;
  try {
    response = await send(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader(config.token),
        'Content-Type': 'application/json',
        Accept: 'application/zip',
      },
      body: JSON.stringify(objectIds),
    });
  } catch (error) {
    throw new HubSourceError(
      502,
      'upstream_unreachable',
      `Azure DevOps could not be reached: ${(error as Error).message}`,
    );
  }
  if (!response.ok) throw describeHttpFailure(response.status, 'blobs');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > HUB_LIMITS.maxZipBytes)
    throw new HubSourceError(
      400,
      'too_large',
      'A blob archive from Azure DevOps is larger than allowed.',
    );
  return bytes;
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

/**
 * The entries of a small zip, by name. Stored and deflated entries only, no zip64, every size
 * checked before a byte is inflated: this reads what Azure DevOps sends back for a few hundred
 * blob ids, not arbitrary archives.
 */
export function readZipEntries(zip: Buffer, limits = HUB_LIMITS): Map<string, Buffer> {
  const invalid = () =>
    new HubSourceError(502, 'upstream_failed', 'The blob archive is not a valid zip.');
  if (zip.length < 22) throw invalid();
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw invalid();
  const entries = zip.readUInt16LE(eocd + 10);
  const cdSize = zip.readUInt32LE(eocd + 12);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    throw new HubSourceError(400, 'too_large', 'Zip64 archives are not supported.');
  if (entries > limits.maxZipEntries)
    throw new HubSourceError(
      400,
      'too_large',
      `The blob archive has too many entries (${entries}).`,
    );
  if (cdOffset + cdSize > zip.length) throw invalid();
  const out = new Map<string, Buffer>();
  let pos = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > zip.length || zip.readUInt32LE(pos) !== CDH_SIG) throw invalid();
    const method = zip.readUInt16LE(pos + 10);
    const compressed = zip.readUInt32LE(pos + 20);
    const uncompressed = zip.readUInt32LE(pos + 24);
    const nameLength = zip.readUInt16LE(pos + 28);
    const extraLength = zip.readUInt16LE(pos + 30);
    const commentLength = zip.readUInt16LE(pos + 32);
    const localOffset = zip.readUInt32LE(pos + 42);
    const name = zip.toString('utf8', pos + 46, pos + 46 + nameLength);
    pos += 46 + nameLength + extraLength + commentLength;
    if (uncompressed > limits.maxDefinitionBytes * 4)
      throw new HubSourceError(
        400,
        'too_large',
        `A blob in the archive expands to too much data (${name}).`,
      );
    if (
      uncompressed > 64 * 1024 &&
      uncompressed / Math.max(compressed, 1) > limits.maxCompressionRatio
    )
      throw new HubSourceError(
        400,
        'too_large',
        'The blob archive compression ratio is not plausible.',
      );
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== LFH_SIG) throw invalid();
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressed > zip.length) throw invalid();
    const data = zip.subarray(dataStart, dataStart + compressed);
    if (name.endsWith('/')) continue;
    if (method === 0) {
      out.set(name, Buffer.from(data));
    } else if (method === 8) {
      try {
        out.set(name, inflateRawSync(data, { maxOutputLength: Math.max(uncompressed, 1) }));
      } catch {
        throw invalid();
      }
    } else {
      throw new HubSourceError(
        502,
        'upstream_failed',
        `The blob archive uses an unsupported compression (${method}).`,
      );
    }
  }
  return out;
}

/** Entry names come back as the blob id, sometimes with a folder or extension around it. */
function blobIdOfEntry(name: string): string {
  const base = name.split('/').pop() ?? name;
  const match = /[0-9a-f]{40}/i.exec(base);
  return (match ? match[0] : base).toLowerCase();
}

/** Reads a hub kept in an Azure DevOps repository. */
export async function readAzureDevOpsHub(
  config: AzureDevOpsHubConfig,
  deps: HubReaderDeps = {},
): Promise<HubSnapshot> {
  const head = await azureDevOpsHead(config, deps);
  const { blobs, modulesBlob } = await azureDevOpsTree(config, deps);
  const warnings: string[] = [];
  const cases: HubCaseDefinition[] = [];
  let modules: string[] = [];
  const byId = new Map<string, TreeBlob[]>();
  for (const blob of blobs) {
    const list = byId.get(blob.objectId.toLowerCase()) ?? [];
    list.push(blob);
    byId.set(blob.objectId.toLowerCase(), list);
  }
  const wanted = Array.from(byId.keys());
  if (modulesBlob) wanted.push(modulesBlob.toLowerCase());
  for (let start = 0; start < wanted.length; start += HUB_LIMITS.blobBatch) {
    const batch = wanted.slice(start, start + HUB_LIMITS.blobBatch);
    const entries = readZipEntries(await azureDevOpsBlobsZip(config, deps, batch));
    const found = new Map<string, Buffer>();
    for (const [name, bytes] of entries) found.set(blobIdOfEntry(name), bytes);
    for (const objectId of batch) {
      const bytes = found.get(objectId);
      if (!bytes) {
        warnings.push(`Blob ${objectId} was not in the archive Azure DevOps returned.`);
        continue;
      }
      if (objectId === modulesBlob?.toLowerCase()) {
        try {
          modules = parseModules(JSON.parse(bytes.toString('utf8')));
        } catch {
          warnings.push(`${HUB_MODULES_FILE} is not valid JSON.`);
        }
        continue;
      }
      for (const blob of byId.get(objectId) ?? []) {
        const where = `${blob.module}/${blob.caseFolder}`;
        let json: unknown;
        try {
          json = JSON.parse(bytes.toString('utf8'));
        } catch {
          warnings.push(`${where}: definition.json is not valid JSON and was skipped.`);
          continue;
        }
        const parsed = parseHubDefinition(json, {
          module: blob.module,
          caseFolder: blob.caseFolder,
        });
        if (!parsed) {
          warnings.push(`${where}: definition.json has no id and was skipped.`);
          continue;
        }
        cases.push(parsed);
      }
    }
  }
  return { cases, modules, head, warnings };
}

// ─── Reading a saved source ────────────────────────────────────────────────────

export interface SourceReadDeps extends HubReaderDeps {
  env?: NodeJS.ProcessEnv;
  /** The decrypted token of an Azure DevOps source; the caller holds the key. */
  token?: string | null;
}

/** The snapshot of a saved source, whichever kind it is. */
export async function readSource(
  source: TestCaseSource,
  deps: SourceReadDeps = {},
): Promise<HubSnapshot> {
  if (source.kind === 'folder') {
    const folder = await resolveHubFolder(source.path ?? '', deps.env);
    return readHubFolder(folder);
  }
  if (!deps.token)
    throw new HubSourceError(400, 'token_missing', 'The Azure DevOps source has no token.');
  return readAzureDevOpsHub(
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

/** A quick look at the source: can it be read, and what is at the other end. */
export async function checkSource(
  source: TestCaseSource,
  deps: SourceReadDeps = {},
): Promise<{ ok: boolean; detail: string }> {
  try {
    if (source.kind === 'folder') {
      const folder = await resolveHubFolder(source.path ?? '', deps.env);
      const definitions = path.join(folder, HUB_DEFINITIONS_DIR);
      const stat = await fs.stat(definitions).catch(() => null);
      if (!stat?.isDirectory())
        return { ok: false, detail: `The folder has no ${HUB_DEFINITIONS_DIR}/ directory.` };
      const modules = (await fs.readdir(definitions, { withFileTypes: true })).filter((entry) =>
        entry.isDirectory(),
      ).length;
      const head = await folderHead(folder);
      return {
        ok: true,
        detail: `${modules} module folder${modules === 1 ? '' : 's'}${head ? `, at commit ${head.slice(0, 10)}` : ''}.`,
      };
    }
    if (!deps.token) return { ok: false, detail: 'The source has no token.' };
    const head = await azureDevOpsHead(
      {
        baseUrl: source.baseUrl ?? '',
        project: source.project ?? '',
        repository: source.repository ?? '',
        branch: source.branch ?? 'main',
        token: deps.token,
      },
      deps,
    );
    return {
      ok: true,
      detail: `Branch ${source.branch ?? 'main'} is at commit ${head.slice(0, 10)}.`,
    };
  } catch (error) {
    if (error instanceof HubSourceError) return { ok: false, detail: error.message };
    return { ok: false, detail: (error as Error).message };
  }
}

// ─── The catalog ───────────────────────────────────────────────────────────────

export function hubContentHash(definition: HubCaseDefinition): string {
  return createHash('sha256').update(hubCaseFingerprint(definition)).digest('hex');
}

export interface RefreshOutcome {
  cases: number;
  added: number;
  updated: number;
  missing: number;
  head: string | null;
  warnings: string[];
}

const excluded = (column: { name: string }) => sql.raw(`excluded."${column.name}"`);

/**
 * Writes a snapshot into the catalog: new rows added, known rows updated, rows no longer in the
 * hub marked missing (never deleted — the tests they became still point at them). Batches of
 * 500, one transaction.
 */
export async function writeCatalog(
  tx: TenantTx,
  source: TestCaseSource,
  snapshot: HubSnapshot,
): Promise<RefreshOutcome> {
  const now = new Date();
  const seen = new Map<string, HubCaseDefinition>();
  const warnings = [...snapshot.warnings];
  for (const definition of snapshot.cases) {
    const previous = seen.get(definition.caseId);
    if (!previous) {
      seen.set(definition.caseId, definition);
      continue;
    }
    // Two folders for one id (a legacy four-digit copy next to the padded one): the newer wins.
    const newer = (definition.sourceUpdatedAt ?? '') > (previous.sourceUpdatedAt ?? '');
    if (newer) seen.set(definition.caseId, definition);
    warnings.push(`${definition.caseId} appears twice in the hub; the newer definition was kept.`);
  }
  const existing = await tx
    .select({ caseId: hubTestCases.caseId, contentHash: hubTestCases.contentHash })
    .from(hubTestCases)
    .where(eq(hubTestCases.sourceId, source.id));
  const known = new Map(existing.map((row) => [row.caseId, row.contentHash]));
  let added = 0;
  let updated = 0;
  const rows = Array.from(seen.values()).map((definition) => {
    const contentHash = hubContentHash(definition);
    const before = known.get(definition.caseId);
    if (before === undefined) added++;
    else if (before !== contentHash) updated++;
    return {
      organizationId: source.organizationId,
      sourceId: source.id,
      caseId: definition.caseId,
      rawId: definition.rawId,
      module: definition.module,
      executionModule: definition.executionModule,
      status: definition.status,
      priority: definition.priority,
      readinessLevel: definition.readinessLevel,
      versionFrom: definition.versionFrom,
      versionTo: definition.versionTo,
      devopsId: definition.devopsId,
      sme: definition.sme,
      featureHighlight: definition.featureHighlight,
      executionGroup: definition.executionGroup,
      functionalObjective: definition.functionalObjective,
      precondition: definition.precondition,
      steps: definition.steps,
      expectedOutcome: definition.expectedOutcome,
      refEnvPrecondition: definition.refEnvPrecondition,
      refEnvSteps: definition.refEnvSteps,
      refEnvExpectedOutcome: definition.refEnvExpectedOutcome,
      dependsOn: definition.dependsOn,
      forceNotTested: definition.forceNotTested,
      sourceUpdatedAt: definition.sourceUpdatedAt ? new Date(definition.sourceUpdatedAt) : null,
      contentHash,
      refreshedAt: now,
      missingSince: null as Date | null,
    };
  });
  const c = hubTestCases;
  for (let start = 0; start < rows.length; start += 500) {
    await tx
      .insert(hubTestCases)
      .values(rows.slice(start, start + 500))
      .onConflictDoUpdate({
        target: [hubTestCases.sourceId, hubTestCases.caseId],
        set: {
          rawId: excluded(c.rawId),
          module: excluded(c.module),
          executionModule: excluded(c.executionModule),
          status: excluded(c.status),
          priority: excluded(c.priority),
          readinessLevel: excluded(c.readinessLevel),
          versionFrom: excluded(c.versionFrom),
          versionTo: excluded(c.versionTo),
          devopsId: excluded(c.devopsId),
          sme: excluded(c.sme),
          featureHighlight: excluded(c.featureHighlight),
          executionGroup: excluded(c.executionGroup),
          functionalObjective: excluded(c.functionalObjective),
          precondition: excluded(c.precondition),
          steps: excluded(c.steps),
          expectedOutcome: excluded(c.expectedOutcome),
          refEnvPrecondition: excluded(c.refEnvPrecondition),
          refEnvSteps: excluded(c.refEnvSteps),
          refEnvExpectedOutcome: excluded(c.refEnvExpectedOutcome),
          dependsOn: excluded(c.dependsOn),
          forceNotTested: excluded(c.forceNotTested),
          sourceUpdatedAt: excluded(c.sourceUpdatedAt),
          contentHash: excluded(c.contentHash),
          refreshedAt: excluded(c.refreshedAt),
          missingSince: null,
        },
      });
  }
  // Every row the hub still has was just stamped with this refresh; the rest left the hub.
  const gone = and(
    eq(hubTestCases.sourceId, source.id),
    isNull(hubTestCases.missingSince),
    sql`${hubTestCases.refreshedAt} <> ${now}`,
  );
  const [missingRow] = await tx
    .select({ missing: sql<number>`count(*)` })
    .from(hubTestCases)
    .where(gone);
  if (Number(missingRow?.missing ?? 0) > 0) {
    await tx.update(hubTestCases).set({ missingSince: now }).where(gone);
  }
  const [totals] = await tx
    .select({ missing: sql<number>`count(*)` })
    .from(hubTestCases)
    .where(
      and(eq(hubTestCases.sourceId, source.id), sql`${hubTestCases.missingSince} is not null`),
    );
  return {
    cases: rows.length,
    added,
    updated,
    missing: Number(totals?.missing ?? 0),
    head: snapshot.head,
    warnings,
  };
}

// ─── Importing cases as tests ──────────────────────────────────────────────────

export interface ImportInput {
  caseIds: string[];
  projectId: number | null;
  /** Add the created tests to this suite… */
  suiteId?: number | null;
  /** …or to a new static suite of this name in the project. */
  newSuiteName?: string | null;
  variant?: HubStepsOptions['variant'];
}

export type ImportOutcome = 'created' | 'updated' | 'unchanged' | 'skipped';

export interface ImportedCase {
  caseId: string;
  outcome: ImportOutcome;
  testId: number | null;
  /** For `skipped`: why. */
  reason?: 'name_conflict' | 'not_manual' | 'missing_in_hub' | 'not_in_catalog';
}

export interface ImportResult {
  cases: ImportedCase[];
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  suiteId: number | null;
}

function definitionOf(row: HubTestCase): HubCaseDefinition {
  return {
    caseId: row.caseId,
    rawId: row.rawId,
    module: row.module,
    executionModule: row.executionModule,
    status: row.status,
    priority: row.priority,
    readinessLevel: row.readinessLevel,
    versionFrom: row.versionFrom,
    versionTo: row.versionTo,
    devopsId: row.devopsId,
    sme: row.sme,
    featureHighlight: row.featureHighlight,
    executionGroup: row.executionGroup,
    functionalObjective: row.functionalObjective,
    precondition: row.precondition,
    steps: row.steps,
    expectedOutcome: row.expectedOutcome,
    refEnvPrecondition: row.refEnvPrecondition,
    refEnvSteps: row.refEnvSteps,
    refEnvExpectedOutcome: row.refEnvExpectedOutcome,
    dependsOn: row.dependsOn ?? [],
    forceNotTested: row.forceNotTested,
    sourceUpdatedAt: row.sourceUpdatedAt ? row.sourceUpdatedAt.toISOString() : null,
  };
}

/**
 * Makes manual tests of the catalog rows named, in the project chosen.
 *
 * A case not imported before becomes a new manual test (its id in the name, the precondition as
 * the first step). A case imported before whose test is still manual and whose hub content has
 * changed gets its steps and its hub fields rewritten, as a new version; one whose test was
 * automated since is left alone and reported, because the automation is the tester's work. A
 * name already taken skips that case and not the others. Each test gets its version and its
 * audit entry as the library's own dialog gives them.
 *
 * The caller has checked that the user may edit the project (editableProject): this module
 * sits below the HTTP layer and cannot ask it.
 */
export async function importCases(
  tx: TenantTx,
  req: Request,
  input: ImportInput,
): Promise<ImportResult> {
  const organizationId = req.user!.organizationId;
  const userId = req.user!.id;
  const wanted = Array.from(new Set(input.caseIds));
  const rows = wanted.length
    ? await tx.select().from(hubTestCases).where(inArray(hubTestCases.caseId, wanted))
    : [];
  const byCase = new Map(rows.map((row) => [row.caseId, row]));
  const result: ImportResult = {
    cases: [],
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    suiteId: null,
  };
  const createdIds: number[] = [];
  const now = new Date();
  for (const caseId of wanted) {
    const row = byCase.get(caseId);
    if (!row) {
      result.cases.push({ caseId, outcome: 'skipped', testId: null, reason: 'not_in_catalog' });
      result.skipped++;
      continue;
    }
    const definition = definitionOf(row);
    const steps = hubCaseToManualSteps(definition, { variant: input.variant });
    const fields = {
      module: definition.module,
      featureArea: definition.featureHighlight,
      scenario: definition.executionGroup,
      priority: hubPriorityToWfm(definition.priority),
    };
    const [existing] = row.testId
      ? await tx.select().from(tests).where(eq(tests.id, row.testId)).limit(1)
      : [];
    if (existing) {
      if (row.importedHash === row.contentHash) {
        result.cases.push({ caseId, outcome: 'unchanged', testId: existing.id });
        result.unchanged++;
        continue;
      }
      if (!isManualSequence(existing.sequence)) {
        result.cases.push({
          caseId,
          outcome: 'skipped',
          testId: existing.id,
          reason: 'not_manual',
        });
        result.skipped++;
        continue;
      }
      const [updatedRow] = await tx
        .update(tests)
        .set({ ...fields, sequence: toSequence(steps), updatedAt: now })
        .where(eq(tests.id, existing.id))
        .returning();
      await recordTestVersion(tx, {
        testId: updatedRow.id,
        organizationId,
        userId,
        test: updatedRow,
      });
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TEST_UPDATED,
        actor: auditActor(req),
        targetType: 'test',
        targetId: updatedRow.id,
        metadata: { name: updatedRow.name, importedFrom: caseId },
      });
      await tx
        .update(hubTestCases)
        .set({ importedHash: row.contentHash, importedAt: now, importedBy: userId })
        .where(eq(hubTestCases.id, row.id));
      result.cases.push({ caseId, outcome: 'updated', testId: updatedRow.id });
      result.updated++;
      continue;
    }
    if (row.missingSince) {
      result.cases.push({ caseId, outcome: 'skipped', testId: null, reason: 'missing_in_hub' });
      result.skipped++;
      continue;
    }
    const name = hubTestName(definition);
    const [taken] = await tx
      .select({ id: tests.id })
      .from(tests)
      .where(eq(tests.name, name))
      .limit(1);
    if (taken) {
      result.cases.push({ caseId, outcome: 'skipped', testId: taken.id, reason: 'name_conflict' });
      result.skipped++;
      continue;
    }
    const [created] = await tx
      .insert(tests)
      // A manual test, as the library's own dialog makes one: no address, no elements.
      .values({
        name,
        url: '',
        sequence: toSequence(steps),
        elements: [],
        projectId: input.projectId ?? null,
        userId,
        organizationId,
        ...fields,
      })
      .returning();
    await recordTestVersion(tx, { testId: created.id, organizationId, userId, test: created });
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.TEST_CREATED,
      actor: auditActor(req),
      targetType: 'test',
      targetId: created.id,
      metadata: { name: created.name, importedFrom: caseId },
    });
    await tx
      .update(hubTestCases)
      .set({
        testId: created.id,
        importedHash: row.contentHash,
        importedAt: now,
        importedBy: userId,
      })
      .where(eq(hubTestCases.id, row.id));
    createdIds.push(created.id);
    result.cases.push({ caseId, outcome: 'created', testId: created.id });
    result.created++;
  }
  result.suiteId = await placeInSuite(tx, input, organizationId, userId, createdIds);
  return result;
}

/** The created tests into the suite asked for, after the ones already there. */
async function placeInSuite(
  tx: TenantTx,
  input: ImportInput,
  organizationId: number,
  userId: number,
  createdIds: number[],
): Promise<number | null> {
  let suiteId = input.suiteId ?? null;
  const newName = input.newSuiteName?.trim() ?? '';
  if (suiteId == null && newName === '') return null;
  if (suiteId != null) {
    const [suite] = await tx.select().from(testSuites).where(eq(testSuites.id, suiteId)).limit(1);
    if (!suite) throw new HubSourceError(404, 'suite_not_found', 'The suite does not exist.');
    if (suite.kind !== 'static')
      throw new HubSourceError(
        400,
        'suite_dynamic',
        'A dynamic suite is filled by its tags, not by hand.',
      );
  } else {
    const [suite] = await tx
      .insert(testSuites)
      .values({
        organizationId,
        projectId: input.projectId ?? null,
        name: newName,
        description: 'Imported from the test case hub.',
        kind: 'static',
        tagIds: [],
        createdBy: userId,
      })
      .returning();
    suiteId = suite.id;
  }
  if (createdIds.length === 0) return suiteId;
  const present = await tx
    .select({ testId: testSuiteItems.testId, position: testSuiteItems.position })
    .from(testSuiteItems)
    .where(eq(testSuiteItems.suiteId, suiteId));
  const already = new Set(present.map((item) => item.testId));
  let position = present.reduce((max, item) => Math.max(max, item.position ?? -1), -1) + 1;
  const items = createdIds
    .filter((testId) => !already.has(testId))
    .map((testId) => ({
      organizationId,
      suiteId: suiteId!,
      testType: 'ui' as const,
      testId,
      apiTestId: null,
      mobileTestId: null,
      position: position++,
    }));
  if (items.length) await tx.insert(testSuiteItems).values(items);
  return suiteId;
}

/** Logged once per refresh so an operator can see what the hub keeps sending that is skipped. */
export function logWarnings(sourceId: string, warnings: string[]): void {
  if (warnings.length === 0) return;
  logger.warn({
    message: `Test case hub ${sourceId}: ${warnings.length} definition(s) skipped on refresh`,
    sample: warnings.slice(0, 10),
  });
}

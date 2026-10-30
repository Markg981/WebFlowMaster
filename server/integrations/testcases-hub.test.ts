import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { createHash } from 'crypto';
import { deflateRawSync } from 'zlib';
import {
  hubCaseToManualSteps,
  hubPriorityToWfm,
  hubTestName,
  normaliseHubCaseId,
  parseHubDefinition,
  hubCaseFingerprint,
} from '@shared/testcases-hub';
import {
  HUB_LIMITS,
  HubSourceError,
  allowedHubRoots,
  readAzureDevOpsHub,
  readHubFolder,
  readZipEntries,
  resolveHubFolder,
} from './testcases-hub';

vi.mock('../platform/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  },
  updateLogLevel: vi.fn(),
}));

/**
 * The hub as a folder and as an Azure DevOps repository, and the shared parser in between:
 * a definition.json as the CoE QA manager writes it must become the same manual steps either way.
 */

// ─── Fixtures: definitions as the hub writes them ─────────────────────────────

const definition = (overrides: Record<string, unknown> = {}) => ({
  schema_version: '3.1',
  id: 'ARC_TC_00001',
  definition_module: 'ARC',
  execution_module: 'ARC',
  status: 'active',
  priority: 'High',
  version_from: '2.3',
  version_to: null,
  sme_effort_minutes: 10,
  feature_highlight: 'Archive search',
  execution_group: 'Smoke',
  devops_id: '12345',
  sme: 'Jane',
  functional_objective: 'Verify that an archived order can be found by number.\nSecond line.',
  input_data_precondition: 'An archived order exists.',
  ref_env_precondition: '',
  steps: '1) Open the archive\n2) Type the order number\n3) Press Search',
  ref_env_steps: '',
  expected_outcome: 'Step 2. The number is accepted\nStep 3: The order is listed',
  ref_env_expected_outcome: '',
  qa_preparation_effort: null,
  qa_execution_effort: null,
  default_assignee: 'Jane',
  qa_review_assignee: null,
  excel_last_hash: 'abc',
  created_at: '2025-01-02T10:00:00Z',
  updated_at: '2025-03-04T11:22:33Z',
  readiness_level: 3,
  depends_on: ['arc_tc_2', 'ARC_TC_00002', 'SAL_TC_00010'],
  force_not_tested_in_waves: false,
  force_not_tested_note: null,
  code_refs: [],
  reviewer_notes: '',
  design_notes: '',
  resources: [],
  ...overrides,
});

describe('normaliseHubCaseId', () => {
  it('pads and upper-cases ids so legacy spellings meet the current one', () => {
    expect(normaliseHubCaseId('arc_tc_1')).toBe('ARC_TC_00001');
    expect(normaliseHubCaseId('ARC_TC_0001')).toBe('ARC_TC_00001');
    expect(normaliseHubCaseId(' ARC_TC_00001 ')).toBe('ARC_TC_00001');
    expect(normaliseHubCaseId('something-else')).toBe('SOMETHING-ELSE');
  });
});

describe('parseHubDefinition', () => {
  it('keeps the fields the catalog shows and normalises the rest', () => {
    const parsed = parseHubDefinition(definition(), { module: 'ARC', caseFolder: 'ARC_TC_00001' })!;
    expect(parsed.caseId).toBe('ARC_TC_00001');
    expect(parsed.module).toBe('ARC');
    expect(parsed.priority).toBe('High');
    expect(parsed.readinessLevel).toBe(3);
    expect(parsed.dependsOn).toEqual(['ARC_TC_00002', 'SAL_TC_00010']);
    expect(parsed.sourceUpdatedAt).toBe('2025-03-04T11:22:33.000Z');
    expect(parsed.precondition).toBe('An archived order exists.');
  });

  it('reads the readiness written as a label and the priority in any case', () => {
    const parsed = parseHubDefinition(
      definition({
        readiness_level: '4 - Automation Ready',
        priority: 'highest',
        status: 'Deprecated',
      }),
      { module: 'ARC', caseFolder: 'x' },
    )!;
    expect(parsed.readinessLevel).toBe(4);
    expect(parsed.priority).toBe('Highest');
    expect(parsed.status).toBe('deprecated');
  });

  it('falls back to the folder for a definition without an id, and rejects what is not one', () => {
    const parsed = parseHubDefinition(definition({ id: '' }), {
      module: 'ARC',
      caseFolder: 'ARC_TC_00007',
    })!;
    expect(parsed.caseId).toBe('ARC_TC_00007');
    expect(
      parseHubDefinition(definition({ id: null }), { module: 'ARC', caseFolder: '' }),
    ).toBeNull();
    expect(parseHubDefinition([], { module: 'ARC', caseFolder: 'x' })).toBeNull();
    expect(parseHubDefinition('text', { module: 'ARC', caseFolder: 'x' })).toBeNull();
  });

  it('fingerprints the content, not the bookkeeping', () => {
    const a = parseHubDefinition(definition(), { module: 'ARC', caseFolder: 'x' })!;
    const b = parseHubDefinition(
      definition({ excel_last_hash: 'other', updated_at: '2026-01-01' }),
      {
        module: 'ARC',
        caseFolder: 'x',
      },
    )!;
    const c = parseHubDefinition(definition({ steps: '1) Something else' }), {
      module: 'ARC',
      caseFolder: 'x',
    })!;
    expect(hubCaseFingerprint(a)).toBe(hubCaseFingerprint(b));
    expect(hubCaseFingerprint(a)).not.toBe(hubCaseFingerprint(c));
  });
});

describe('hubCaseToManualSteps', () => {
  const parsed = () => parseHubDefinition(definition(), { module: 'ARC', caseFolder: 'x' })!;

  it('puts the precondition first and pairs each outcome with the step it names', () => {
    expect(hubCaseToManualSteps(parsed())).toEqual([
      { action: 'Precondition: An archived order exists.', expected: '' },
      { action: 'Open the archive', expected: '' },
      { action: 'Type the order number', expected: 'The number is accepted' },
      { action: 'Press Search', expected: 'The order is listed' },
    ]);
  });

  it('pairs unnumbered outcomes in order when there are as many as the steps', () => {
    const steps = hubCaseToManualSteps(
      parseHubDefinition(
        definition({ expected_outcome: 'Archive shown\nNumber accepted\nOrder listed' }),
        {
          module: 'ARC',
          caseFolder: 'x',
        },
      )!,
    );
    expect(steps.slice(1).map((step) => step.expected)).toEqual([
      'Archive shown',
      'Number accepted',
      'Order listed',
    ]);
  });

  it('keeps an outcome written as prose on the last step, and outcomes naming no step too', () => {
    const prose = hubCaseToManualSteps(
      parseHubDefinition(definition({ expected_outcome: 'The order is listed with its date.' }), {
        module: 'ARC',
        caseFolder: 'x',
      })!,
    );
    expect(prose[prose.length - 1].expected).toBe('The order is listed with its date.');
    const mixed = hubCaseToManualSteps(
      parseHubDefinition(definition({ expected_outcome: 'No error is shown\nStep 2. Accepted' }), {
        module: 'ARC',
        caseFolder: 'x',
      })!,
    );
    expect(mixed[2].expected).toBe('Accepted');
    expect(mixed[3].expected).toBe('No error is shown');
  });

  it('continues a step on the next line when the line carries no number', () => {
    const steps = hubCaseToManualSteps(
      parseHubDefinition(
        definition({
          input_data_precondition: '',
          steps: '1. Open the archive\nwith the filter closed\n2. Search',
          expected_outcome: '',
        }),
        { module: 'ARC', caseFolder: 'x' },
      )!,
    );
    expect(steps).toEqual([
      { action: 'Open the archive\nwith the filter closed', expected: '' },
      { action: 'Search', expected: '' },
    ]);
  });

  it('uses the reference-environment variant when asked and the case has one', () => {
    const def = parseHubDefinition(
      definition({
        ref_env_steps: '1) Open the reference archive',
        ref_env_expected_outcome: 'Shown',
      }),
      { module: 'ARC', caseFolder: 'x' },
    )!;
    const reference = hubCaseToManualSteps(def, { variant: 'reference' });
    expect(reference).toEqual([
      { action: 'Precondition: An archived order exists.', expected: '' },
      { action: 'Open the reference archive', expected: 'Shown' },
    ]);
    const plain = parseHubDefinition(definition(), { module: 'ARC', caseFolder: 'x' })!;
    expect(hubCaseToManualSteps(plain, { variant: 'reference' })).toEqual(
      hubCaseToManualSteps(plain),
    );
  });

  it('makes one step of a case that has no steps, so the test can still be saved', () => {
    const steps = hubCaseToManualSteps(
      parseHubDefinition(
        definition({ steps: '', expected_outcome: '', input_data_precondition: '' }),
        {
          module: 'ARC',
          caseFolder: 'x',
        },
      )!,
    );
    expect(steps).toEqual([
      {
        action: 'Verify that an archived order can be found by number.\nSecond line.',
        expected: '',
      },
    ]);
  });
});

describe('hubTestName and priority', () => {
  it('names the test by id and first line of the objective, within the limit', () => {
    const def = parseHubDefinition(definition(), { module: 'ARC', caseFolder: 'x' })!;
    expect(hubTestName(def)).toBe(
      '[ARC_TC_00001] Verify that an archived order can be found by number.',
    );
    const long = parseHubDefinition(definition({ functional_objective: 'x'.repeat(400) }), {
      module: 'ARC',
      caseFolder: 'x',
    })!;
    expect(hubTestName(long).length).toBe(200);
    const bare = parseHubDefinition(
      definition({ functional_objective: '', feature_highlight: null }),
      {
        module: 'ARC',
        caseFolder: 'x',
      },
    )!;
    expect(hubTestName(bare)).toBe('[ARC_TC_00001] ARC');
  });

  it('maps the hub priorities onto the library ones', () => {
    expect(hubPriorityToWfm('Highest')).toBe('Critical');
    expect(hubPriorityToWfm('high')).toBe('High');
    expect(hubPriorityToWfm(null)).toBe('Medium');
    expect(hubPriorityToWfm('Whatever')).toBe('Medium');
  });
});

// ─── A hub on disk ────────────────────────────────────────────────────────────

let hubDir: string;
let rootDir: string;

async function writeDefinition(dir: string, module: string, folder: string, body: unknown) {
  const caseDir = path.join(dir, 'TestCasesDefinitions', module, folder);
  await fs.mkdir(caseDir, { recursive: true });
  await fs.writeFile(
    path.join(caseDir, 'definition.json'),
    typeof body === 'string' ? body : JSON.stringify(body, null, 2),
  );
}

beforeAll(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-hub-root-'));
  hubDir = path.join(rootDir, 'CoE-QA-TestCasesHub');
  await writeDefinition(hubDir, 'ARC', 'ARC_TC_00001', definition());
  await writeDefinition(
    hubDir,
    'ARC',
    'ARC_TC_00002',
    definition({ id: 'ARC_TC_00002', status: 'deprecated', priority: 'Low', readiness_level: 0 }),
  );
  await writeDefinition(
    hubDir,
    'SAL',
    'SAL_TC_00010',
    definition({
      id: 'sal_tc_10',
      definition_module: 'SAL',
      execution_module: 'ARC',
      priority: null,
    }),
  );
  await writeDefinition(hubDir, 'SAL', 'SAL_TC_00011', '{ not json');
  await fs.mkdir(path.join(hubDir, 'TestCasesDefinitions', 'SAL', 'SAL_TC_00012', 'images'), {
    recursive: true,
  });
  await fs.mkdir(path.join(hubDir, 'config'), { recursive: true });
  await fs.writeFile(
    path.join(hubDir, 'config', 'modules.json'),
    JSON.stringify([
      { module_name: 'ARC', default_assignee: 'Jane', tc_prefix: 'ARC' },
      { module_name: 'SAL', default_assignee: 'Joe', tc_prefix: 'SAL' },
    ]),
  );
  await fs.mkdir(path.join(hubDir, '.git', 'refs', 'heads'), { recursive: true });
  await fs.writeFile(path.join(hubDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await fs.writeFile(path.join(hubDir, '.git', 'refs', 'heads', 'main'), `${'a'.repeat(40)}\n`);
});

afterAll(async () => {
  await fs.rm(rootDir, { recursive: true, force: true });
});

describe('resolveHubFolder', () => {
  it('refuses every folder when the operator allowed none', async () => {
    await expect(resolveHubFolder(hubDir, {})).rejects.toMatchObject({
      status: 400,
      code: 'folder_sources_disabled',
    });
    expect(allowedHubRoots({})).toEqual([]);
  });

  it('accepts a folder under an allowed root and refuses one outside, or missing', async () => {
    const env = { TESTCASE_HUB_ROOTS: rootDir };
    expect(await resolveHubFolder(hubDir, env)).toBe(await fs.realpath(hubDir));
    expect(await resolveHubFolder(rootDir, env)).toBe(await fs.realpath(rootDir));
    await expect(resolveHubFolder(path.join(rootDir, '..'), env)).rejects.toMatchObject({
      code: 'path_not_allowed',
    });
    await expect(resolveHubFolder(path.join(hubDir, '..', '..', 'etc'), env)).rejects.toMatchObject(
      {
        code: 'path_not_allowed',
      },
    );
    await expect(resolveHubFolder(path.join(rootDir, 'nope'), env)).rejects.toMatchObject({
      code: 'path_missing',
    });
    await expect(
      resolveHubFolder(path.join(hubDir, 'config', 'modules.json'), env),
    ).rejects.toMatchObject({ code: 'path_missing' });
  });

  it('reads several roots separated as PATH is', async () => {
    const env = {
      TESTCASE_HUB_ROOTS: `${path.join(rootDir, 'other')}${path.delimiter} ${rootDir} `,
    };
    expect(await resolveHubFolder(hubDir, env)).toBe(await fs.realpath(hubDir));
  });
});

describe('readHubFolder', () => {
  it('reads every definition, skips what does not parse, and names the commit', async () => {
    const snapshot = await readHubFolder(hubDir);
    expect(snapshot.cases.map((c) => c.caseId).sort()).toEqual([
      'ARC_TC_00001',
      'ARC_TC_00002',
      'SAL_TC_00010',
    ]);
    const sal = snapshot.cases.find((c) => c.caseId === 'SAL_TC_00010')!;
    expect(sal.rawId).toBe('sal_tc_10');
    expect(sal.executionModule).toBe('ARC');
    expect(snapshot.modules).toEqual(['ARC', 'SAL']);
    expect(snapshot.head).toBe('a'.repeat(40));
    expect(snapshot.warnings).toEqual([
      'SAL/SAL_TC_00011: definition.json is not valid JSON and was skipped.',
    ]);
  });

  it('refuses a folder that is not a hub', async () => {
    await expect(readHubFolder(rootDir)).rejects.toMatchObject({ code: 'not_a_hub' });
  });
});

// ─── Zips as Azure DevOps sends them ──────────────────────────────────────────

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** A zip of the entries given, deflated unless `stored`, with the trailing fields a tool writes. */
function buildZip(
  entries: {
    name: string;
    data: Buffer;
    stored?: boolean;
    method?: number;
    lieUncompressed?: number;
  }[],
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? (entry.stored ? 0 : 8);
    const data = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const name = Buffer.from(entry.name, 'utf8');
    const uncompressed = entry.lieUncompressed ?? entry.data.length;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(entry.data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('readZipEntries', () => {
  it('reads stored and deflated entries by name', () => {
    const zip = buildZip([
      { name: 'one.json', data: Buffer.from('{"a":1}') },
      { name: 'two.txt', data: Buffer.from('plain'), stored: true },
      { name: 'dir/', data: Buffer.alloc(0), stored: true },
    ]);
    const entries = readZipEntries(zip);
    expect(entries.get('one.json')?.toString()).toBe('{"a":1}');
    expect(entries.get('two.txt')?.toString()).toBe('plain');
    expect(entries.has('dir/')).toBe(false);
  });

  it('refuses what is not a zip, an unsupported method, and an entry that claims to expand too much', () => {
    expect(() => readZipEntries(Buffer.from('nope'))).toThrow(HubSourceError);
    expect(() =>
      readZipEntries(buildZip([{ name: 'x', data: Buffer.from('x'), method: 12 }])),
    ).toThrow(/unsupported compression/);
    expect(() =>
      readZipEntries(
        buildZip([
          {
            name: 'bomb',
            data: Buffer.from('x'),
            lieUncompressed: HUB_LIMITS.maxDefinitionBytes * 5,
          },
        ]),
      ),
    ).toThrow(/too much data/);
    expect(() =>
      readZipEntries(buildZip([{ name: 'x', data: Buffer.from('x') }]), {
        ...HUB_LIMITS,
        maxZipEntries: 0,
      }),
    ).toThrow(/too many entries/);
  });

  it('stops inflating at the declared size rather than trusting the stream', () => {
    // A deflated entry whose header says 10 bytes but whose stream holds far more.
    const big = Buffer.alloc(200_000, 'a');
    const zip = buildZip([{ name: 'short', data: big, lieUncompressed: 10 }]);
    expect(() => readZipEntries(zip)).toThrow(HubSourceError);
  });
});

// ─── A hub in Azure DevOps ────────────────────────────────────────────────────

const blobId = (content: string) => createHash('sha1').update(content).digest('hex');

describe('readAzureDevOpsHub', () => {
  let server: http.Server;
  let base: string;
  let seen: { method: string; url: string; authorization?: string; body: string }[] = [];
  const files: Record<string, string> = {
    '/TestCasesDefinitions/ARC/ARC_TC_00001/definition.json': JSON.stringify(definition()),
    '/TestCasesDefinitions/ARC/ARC_TC_00002/definition.json': JSON.stringify(
      definition({ id: 'ARC_TC_00002', status: 'deprecated' }),
    ),
    '/TestCasesDefinitions/SAL/SAL_TC_00010/definition.json': JSON.stringify(
      definition({ id: 'SAL_TC_00010', definition_module: 'SAL' }),
    ),
    '/TestCasesDefinitions/SAL/SAL_TC_00011/definition.json': '{ broken',
    '/config/modules.json': JSON.stringify([{ module_name: 'ARC' }, { module_name: 'SAL' }]),
  };
  let refuse: number | null = null;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        seen.push({
          method: req.method!,
          url: req.url!,
          authorization: req.headers.authorization,
          body: raw,
        });
        const url = new URL(req.url!, 'http://x');
        const json = (status: number, body: unknown) =>
          res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
        if (refuse) return json(refuse, { message: 'no' });
        if (
          !url.pathname.startsWith(
            '/my-org/QA%20Project/_apis/git/repositories/CoE-QA-TestCasesHub/',
          )
        )
          return json(404, { message: 'unknown repository' });
        const tail = url.pathname.split('/').pop();
        if (tail === 'refs') {
          return json(200, {
            value:
              url.searchParams.get('filter') === 'heads/main'
                ? [{ name: 'refs/heads/main', objectId: 'f'.repeat(40) }]
                : [],
          });
        }
        if (tail === 'items') {
          if (url.searchParams.get('scopePath') === '/TestCasesDefinitions') {
            return json(200, {
              value: [
                { path: '/TestCasesDefinitions', gitObjectType: 'tree', objectId: '1'.repeat(40) },
                {
                  path: '/TestCasesDefinitions/ARC',
                  gitObjectType: 'tree',
                  objectId: '2'.repeat(40),
                },
                {
                  path: '/TestCasesDefinitions/ARC/ARC_TC_00001/images/shot.png',
                  gitObjectType: 'blob',
                  objectId: '3'.repeat(40),
                },
                ...Object.keys(files)
                  .filter((file) => file.startsWith('/TestCasesDefinitions/'))
                  .map((file) => ({
                    path: file,
                    gitObjectType: 'blob',
                    objectId: blobId(files[file]),
                    size: files[file].length,
                  })),
              ],
            });
          }
          if (url.searchParams.get('path') === '/config/modules.json')
            return json(200, {
              path: '/config/modules.json',
              gitObjectType: 'blob',
              objectId: blobId(files['/config/modules.json']),
            });
          return json(404, { message: 'no such item' });
        }
        if (tail === 'blobs' && req.method === 'POST') {
          const ids: string[] = JSON.parse(raw);
          const byId = new Map(Object.values(files).map((content) => [blobId(content), content]));
          const zip = buildZip(
            ids
              .filter((id) => byId.has(id))
              .map((id) => ({ name: id, data: Buffer.from(byId.get(id)!) })),
          );
          return res.writeHead(200, { 'Content-Type': 'application/zip' }).end(zip);
        }
        json(404, { message: 'nothing here' });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/my-org/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const config = () => ({
    baseUrl: base,
    project: 'QA Project',
    repository: 'CoE-QA-TestCasesHub',
    branch: 'main',
    token: 'pat-secret',
  });

  it('reads the tree once, the blobs as zips, and authenticates with the token', async () => {
    seen = [];
    const snapshot = await readAzureDevOpsHub(config());
    expect(snapshot.head).toBe('f'.repeat(40));
    expect(snapshot.cases.map((c) => c.caseId).sort()).toEqual([
      'ARC_TC_00001',
      'ARC_TC_00002',
      'SAL_TC_00010',
    ]);
    expect(snapshot.modules).toEqual(['ARC', 'SAL']);
    expect(snapshot.warnings).toEqual([
      'SAL/SAL_TC_00011: definition.json is not valid JSON and was skipped.',
    ]);
    const expectedAuth = `Basic ${Buffer.from(':pat-secret').toString('base64')}`;
    expect(seen.every((call) => call.authorization === expectedAuth)).toBe(true);
    expect(seen.filter((call) => call.url.includes('/blobs')).length).toBe(1);
    const asked: string[] = JSON.parse(seen.find((call) => call.url.includes('/blobs'))!.body);
    // The image blob is not asked for: only definition.json files are.
    expect(asked).not.toContain('3'.repeat(40));
    expect(asked).toContain(blobId(files['/config/modules.json']));
  });

  it('says what went wrong: a refused token, a missing repository, a missing branch', async () => {
    refuse = 401;
    await expect(readAzureDevOpsHub(config())).rejects.toMatchObject({ code: 'token_refused' });
    refuse = 403;
    await expect(readAzureDevOpsHub(config())).rejects.toMatchObject({ code: 'token_refused' });
    refuse = null;
    await expect(readAzureDevOpsHub({ ...config(), repository: 'other' })).rejects.toMatchObject({
      code: 'repository_not_found',
    });
    await expect(readAzureDevOpsHub({ ...config(), branch: 'develop' })).rejects.toMatchObject({
      code: 'repository_not_found',
    });
  });

  it('reports a server it cannot reach as upstream, not as a bug', async () => {
    await expect(
      readAzureDevOpsHub({ ...config(), baseUrl: 'http://127.0.0.1:9/my-org' }),
    ).rejects.toMatchObject({ status: 502, code: 'upstream_unreachable' });
  });
});

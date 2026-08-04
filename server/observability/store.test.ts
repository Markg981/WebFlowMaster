import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
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
  vi.restoreAllMocks();
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

  it('does not let a recurrence without a repro erase the stored one', async () => {
    await store.upsert(
      incident({ repro: { path: 'repro/inc_aaaaaa.spec.ts', command: 'npx vitest run', confidence: 'high' } }),
    );

    const reoccurred = await store.upsert(incident({ repro: undefined }));

    expect(reoccurred.repro).toEqual({
      path: 'repro/inc_aaaaaa.spec.ts',
      command: 'npx vitest run',
      confidence: 'high',
    });
  });

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
});

describe('IncidentStore.readIndex', () => {
  it('returns an empty list when index.json is simply absent', async () => {
    expect(await store.readIndex()).toEqual([]);
  });

  it('rebuilds from incident files when index.json is corrupt, without losing them on the next upsert', async () => {
    await store.upsert(incident({ id: 'inc_one001', fingerprint: 'one001' }));
    await store.upsert(incident({ id: 'inc_two002', fingerprint: 'two002' }));

    fs.writeFileSync(path.join(root, 'index.json'), 'not valid json{{{');

    const rebuilt = await store.readIndex();
    expect(rebuilt.map((e) => e.id).sort()).toEqual(['inc_one001', 'inc_two002']);

    // A later upsert must reindex from the rebuilt view, not from an empty one, or the
    // two pre-existing incidents become unreachable through the index.
    await store.upsert(incident({ id: 'inc_three3', fingerprint: 'three3' }));
    const after = await store.readIndex();
    expect(after.map((e) => e.id).sort()).toEqual(['inc_one001', 'inc_three3', 'inc_two002']);
  });

  it('skips an unparseable incident file during rebuild but keeps the valid ones', async () => {
    await store.upsert(incident({ id: 'inc_good001', fingerprint: 'good001' }));
    await store.upsert(incident({ id: 'inc_bad0001', fingerprint: 'bad0001' }));

    fs.writeFileSync(path.join(root, 'index.json'), 'not valid json{{{');
    fs.writeFileSync(path.join(root, 'incidents', 'inc_bad0001.json'), 'also not json{{{');

    const rebuilt = await store.readIndex();
    expect(rebuilt.map((e) => e.id)).toEqual(['inc_good001']);
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

  it('counts only incidents actually deleted and keeps a failed deletion in the index', async () => {
    const old = new Date(Date.now() - 40 * 24 * 3600_000).toISOString();
    await store.upsert(incident({ id: 'inc_old003', fingerprint: 'old003', lastSeen: old }));
    await store.upsert(incident({ id: 'inc_old004', fingerprint: 'old004', lastSeen: old }));

    const stuckPath = path.join(root, 'incidents', 'inc_old004.json');
    const realRm = fsPromises.rm.bind(fsPromises);
    vi.spyOn(fsPromises, 'rm').mockImplementation(async (...args: Parameters<typeof fsPromises.rm>) => {
      if (args[0] === stuckPath) {
        const err = new Error('EBUSY: resource busy or locked') as NodeJS.ErrnoException;
        err.code = 'EBUSY';
        throw err;
      }
      return realRm(...args);
    });

    const removed = await store.prune({ maxFiles: 500, maxAgeDays: 30 });

    // Only inc_old003 was actually removed; inc_old004's file could not be deleted, so it
    // must not be counted and must still be reachable through the index.
    expect(removed).toBe(1);
    const ids = (await store.readIndex()).map((e) => e.id);
    expect(ids).toEqual(['inc_old004']);
    expect(fs.existsSync(stuckPath)).toBe(true);
  });
});

describe('IncidentStore writeJson rename retry', () => {
  // These exercise the write-then-rename retry loop directly, which is the regression
  // guard for a Critical finding that the old code deleted the destination before
  // renaming. Only fs.rename is mocked; writeFile/mkdir/readFile all run for real, so the
  // rest of the write path is genuinely exercised.
  const targetPath = (root: string) => path.join(root, 'incidents', 'inc_aaaaaa.json');

  it('retries a transient EPERM and still writes the file once it clears', async () => {
    const realRename = fsPromises.rename.bind(fsPromises);
    const target = targetPath(root);
    let attempts = 0;
    vi.spyOn(fsPromises, 'rename').mockImplementation(async (...args: Parameters<typeof fsPromises.rename>) => {
      if (args[1] === target) {
        attempts++;
        if (attempts <= 2) {
          const err = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException;
          err.code = 'EPERM';
          throw err;
        }
      }
      return realRename(...args);
    });

    await store.upsert(incident());

    // Two failed attempts, then the third succeeds.
    expect(attempts).toBe(3);
    const onDisk = await store.read('inc_aaaaaa');
    expect(onDisk?.count).toBe(1);
  });

  it('propagates a persistent EPERM after exactly the bounded number of attempts, cleaning up the temp file', async () => {
    const target = targetPath(root);
    let attempts = 0;
    vi.spyOn(fsPromises, 'rename').mockImplementation(async (...args: Parameters<typeof fsPromises.rename>) => {
      if (args[1] === target) {
        attempts++;
        const err = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      throw new Error(`unexpected rename call for ${String(args[1])}`);
    });

    await expect(store.upsert(incident())).rejects.toMatchObject({ code: 'EPERM' });

    // Bounded: neither one-shot nor unbounded — exactly the retry cap.
    expect(attempts).toBe(5);
    const leftoverTemps = fs.readdirSync(path.join(root, 'incidents')).filter((f) => f.endsWith('.tmp'));
    expect(leftoverTemps).toEqual([]);
  });

  it('propagates a non-retryable EACCES on the first attempt without retrying', async () => {
    const realRename = fsPromises.rename.bind(fsPromises);
    const target = targetPath(root);
    let attempts = 0;
    vi.spyOn(fsPromises, 'rename').mockImplementation(async (...args: Parameters<typeof fsPromises.rename>) => {
      if (args[1] === target) {
        attempts++;
        const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return realRename(...args);
    });

    await expect(store.upsert(incident())).rejects.toMatchObject({ code: 'EACCES' });
    expect(attempts).toBe(1);
  });
});

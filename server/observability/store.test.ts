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

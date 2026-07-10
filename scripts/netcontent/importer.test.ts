import { describe, it, expect, beforeEach, afterAll } from 'vitest';
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

// Clean up so leftover projects (FK -> users) don't break other suites' db.delete(users)
// when this file runs before them (test-file order differs between machines/CI).
afterAll(async () => {
  await db.delete(apiTests);
  await db.delete(projects);
  await db.delete(users);
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
    expect(rows.map((r) => r.method).sort()).toEqual(['GET', 'POST']);
  });
});

describe('importApiTests (re-run)', () => {
  it('preserves edited assertions + filled param values, adds new params, reports orphans', async () => {
    const pid = await findOrCreateProject(db, 1, 'NetContent');
    let records = mapEndpoints(EPS, { baseUrlVar: '{{baseUrl}}', projectId: pid, userId: 1 });
    await importApiTests(db, records, pid);

    // User edits GetX: fill the "id" value, add a custom assertion.
    const getX = (await db.select().from(apiTests).where(eq(apiTests.method, 'GET')))[0];
    const editedParams = [{ id: 'a', key: 'id', value: '42', enabled: true }];
    const editedAssertions = [{ id: 'b', source: 'status_code', comparison: 'equals', targetValue: '200', enabled: true }];
    await db.update(apiTests)
      .set({ queryParams: editedParams, assertions: editedAssertions })
      .where(eq(apiTests.id, getX.id));

    // Re-import: GetX gains a new param "mode"; SaveY is gone; NewZ appears.
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

    expect(summary.created).toBe(1); // NewZ
    expect(summary.updated).toBe(1); // GetX
    expect(summary.orphans).toContain('POST {{baseUrl}}/api/NetContentScale/SaveY');

    const after = (await db.select().from(apiTests).where(eq(apiTests.id, getX.id)))[0];
    expect((after.assertions as any[])[0].targetValue).toBe('200'); // edited assertion preserved
    const params = after.queryParams as any[];
    expect(params.find((p) => p.key === 'id').value).toBe('42'); // filled value preserved
    expect(params.find((p) => p.key === 'mode')).toBeTruthy(); // new param appended
  });
});

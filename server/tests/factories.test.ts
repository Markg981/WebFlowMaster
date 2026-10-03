import { afterEach, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { createTestOrganization, createTestUser } from './factories';

const orgIds: number[] = [];

afterEach(async () => {
  vi.doUnmock('../db');
  for (const id of orgIds.splice(0)) {
    await privilegedDb.execute(sql`DELETE FROM users WHERE organization_id = ${id}`);
    await privilegedDb.execute(sql`DELETE FROM organizations WHERE id = ${id}`);
  }
});

it('creates unique default users across isolated module registries sharing one database', async () => {
  const org = await createTestOrganization('Shared fixture database');
  orgIds.push(org);
  const first = await createTestUser(org);

  // Real-Postgres suites get a fresh module registry but retain the same database.
  vi.resetModules();
  vi.doMock('../db', () => ({ privilegedDb }));
  const otherRegistry = await import('./factories');
  const second = await otherRegistry.createTestUser(org);

  expect(second).not.toBe(first);
});

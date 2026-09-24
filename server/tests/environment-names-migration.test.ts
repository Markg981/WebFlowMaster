import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { createTestOrganization, createTestUser } from './factories';

/**
 * Migration 0041 makes environment names unique per organization without case. The old global
 * constraint allowed "Staging" and "staging" in one organization, so the migration renames the
 * later one before creating the index; a migration that fails on data nobody can see from here
 * would stop an upgrade.
 *
 * The migration has already run on this database, so the duplicate can only be made by lifting
 * the index for a moment, inside a transaction that is rolled back.
 */
const migration = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations/0041_environment_name_per_organization.sql'),
  'utf8',
);
const renameStatement = migration
  .split('--> statement-breakpoint')[0]
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

class Rollback extends Error {}

describe('migration 0041', () => {
  it('renames the later of two names that differ only in case, and nothing else', async () => {
    const organizationId = await createTestOrganization('Migration Org');
    const userId = await createTestUser(organizationId, 'migration-user');
    const otherOrganizationId = await createTestOrganization('Other Migration Org');
    const otherUserId = await createTestUser(otherOrganizationId, 'other-migration-user');
    let names: Array<{ organization_id: number; name: string }> = [];

    await privilegedDb
      .transaction(async (tx) => {
        await tx.execute(sql`DROP INDEX "environments_organization_name_unique"`);
        await tx.execute(sql`
          INSERT INTO environments (name, user_id, organization_id) VALUES
            ('Staging', ${userId}, ${organizationId}),
            ('staging', ${userId}, ${organizationId}),
            ('staging', ${otherUserId}, ${otherOrganizationId})
        `);
        await tx.execute(sql.raw(renameStatement));
        const rows = await tx.execute(sql`SELECT id, organization_id, name FROM environments ORDER BY id`);
        names = rows.rows as typeof names;
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });

    const ours = names.filter((row) => Number(row.organization_id) === organizationId).map((row) => row.name);
    const theirs = names.filter((row) => Number(row.organization_id) === otherOrganizationId).map((row) => row.name);
    expect(ours[0]).toBe('Staging');
    expect(ours[1]).toMatch(/^staging \(\d+\)$/);
    // Another organization's "staging" was never a duplicate.
    expect(theirs).toEqual(['staging']);
  });
});

import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from './db';
import { TRANSFERRED_ON_REMOVAL } from './member-removal';

/**
 * Every constraint that points at users decides what removing a member does to that table, so
 * every one of them has to be a decision. A new table referencing users must be either handed on
 * (TRANSFERRED_ON_REMOVAL, and no cascade), the person's own (cascade, listed here), or a record
 * of who did something (set null). Anything else is the bug migration 0040 fixed: organization
 * data deleted with a person, or a removal that fails.
 */

/** Rows that are the person's and go with the account. */
const PERSONAL = ['api_keys', 'api_test_history', 'project_members', 'user_mfa', 'user_settings'];

/** Tables where the reference only records who did something; it becomes null. */
const PROVENANCE = [
  'agents',
  'audit_log',
  'invitations',
  'issue_trackers',
  'source_hosts',
  'test_plan_executions',
  'test_publications',
  'test_quarantines',
  'test_reviews',
  'test_suites',
  'test_versions',
];

/**
 * The single-column constraints: they decide what a deletion does. The two-column
 * `…_same_org_fk` ones (migration 0034) only say that a row and the user it names share an
 * organization; they are NO ACTION and checked at the end of the statement, after the
 * single-column constraint has cascaded or nulled the reference.
 */
async function constraintsOnUsers() {
  const result = await privilegedDb.execute(sql`
    SELECT conrelid::regclass::text AS "table", confdeltype AS "onDelete"
    FROM pg_constraint
    WHERE contype = 'f' AND confrelid = 'users'::regclass AND array_length(conkey, 1) = 1
  `);
  return (result.rows as Array<{ table: string; onDelete: string }>).map((row) => ({
    table: row.table.replace(/^public\./, '').replace(/"/g, ''),
    onDelete: row.onDelete,
  }));
}

describe('what removing a member does to each table that references users', () => {
  it('hands on, deletes or forgets — never anything undecided', async () => {
    const transferred = TRANSFERRED_ON_REMOVAL.map((entry) => entry.name as string);
    const undecided = (await constraintsOnUsers()).filter(
      ({ table }) => !transferred.includes(table) && !PERSONAL.includes(table) && !PROVENANCE.includes(table),
    );
    expect(undecided).toEqual([]);
  });

  it('never cascades into the organization’s data', async () => {
    const transferred = TRANSFERRED_ON_REMOVAL.map((entry) => entry.name as string);
    const constraints = await constraintsOnUsers();
    // 'a' is NO ACTION: a row the transfer missed makes the removal fail instead of vanishing.
    const wrong = constraints.filter(({ table, onDelete }) => transferred.includes(table) && onDelete !== 'a');
    expect(wrong).toEqual([]);
    for (const table of transferred) expect(constraints.some((c) => c.table === table)).toBe(true);
  });

  it('deletes only what is the person’s, and forgets only who did what', async () => {
    const constraints = await constraintsOnUsers();
    expect(constraints.filter(({ table, onDelete }) => PERSONAL.includes(table) && onDelete !== 'c')).toEqual([]);
    expect(constraints.filter(({ table, onDelete }) => PROVENANCE.includes(table) && onDelete !== 'n')).toEqual([]);
  });
});

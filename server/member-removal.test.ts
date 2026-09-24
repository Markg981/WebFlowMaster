import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from './db';
import { TRANSFERRED_ON_REMOVAL } from './member-removal';

/**
 * Every constraint that points at users decides what removing a member does to that column, so
 * every one of them has to be a decision. A new reference to users must be either handed on
 * (TRANSFERRED_ON_REMOVAL, and no cascade), the person's own (cascade, listed here), or a record
 * of who did something (set null). Anything else is the bug migration 0040 fixed: organization
 * data deleted with a person, or a removal that fails.
 *
 * Per column, not per table: one table can hold both, as password_resets does (whose link it is,
 * and who issued it).
 */

/** Rows that are the person's and go with the account. */
const PERSONAL = [
  'api_keys.user_id',
  'api_test_history.user_id',
  'password_resets.user_id',
  'project_members.user_id',
  'user_mfa.user_id',
  'user_settings.user_id',
];

/** References that only record who did something; they become null. */
const PROVENANCE = [
  'agents.created_by',
  'audit_log.actor_user_id',
  'invitations.invited_by_user_id',
  'issue_trackers.created_by',
  'password_resets.created_by',
  'source_hosts.created_by',
  'test_plan_executions.requested_by_user_id',
  'test_publications.published_by',
  'test_quarantines.quarantined_by',
  'test_quarantines.released_by',
  'test_reviews.decided_by',
  'test_reviews.requested_by',
  'test_suites.created_by',
  'test_versions.created_by',
];

/**
 * The single-column constraints: they decide what a deletion does. The two-column
 * `…_same_org_fk` ones (migration 0034) only say that a row and the user it names share an
 * organization; they are NO ACTION and checked at the end of the statement, after the
 * single-column constraint has cascaded or nulled the reference.
 */
async function constraintsOnUsers() {
  const result = await privilegedDb.execute(sql`
    SELECT c.conrelid::regclass::text AS "table", a.attname::text AS "column", c.confdeltype AS "onDelete"
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND array_length(c.conkey, 1) = 1
  `);
  return (result.rows as Array<{ table: string; column: string; onDelete: string }>).map((row) => ({
    table: row.table.replace(/^public\./, '').replace(/"/g, ''),
    reference: `${row.table.replace(/^public\./, '').replace(/"/g, '')}.${row.column}`,
    onDelete: row.onDelete,
  }));
}

const transferred = TRANSFERRED_ON_REMOVAL.map((entry) => `${entry.name}.user_id`);

describe('what removing a member does to each reference to users', () => {
  it('hands on, deletes or forgets — never anything undecided', async () => {
    const undecided = (await constraintsOnUsers())
      .map((c) => c.reference)
      .filter((reference) => !transferred.includes(reference) && !PERSONAL.includes(reference) && !PROVENANCE.includes(reference));
    expect(undecided).toEqual([]);
  });

  it('never cascades into the organization’s data', async () => {
    const constraints = await constraintsOnUsers();
    // 'a' is NO ACTION: a row the transfer missed makes the removal fail instead of vanishing.
    expect(constraints.filter((c) => transferred.includes(c.reference) && c.onDelete !== 'a')).toEqual([]);
    for (const reference of transferred) expect(constraints.some((c) => c.reference === reference)).toBe(true);
  });

  it('deletes only what is the person’s, and forgets only who did what', async () => {
    const constraints = await constraintsOnUsers();
    expect(constraints.filter((c) => PERSONAL.includes(c.reference) && c.onDelete !== 'c')).toEqual([]);
    expect(constraints.filter((c) => PROVENANCE.includes(c.reference) && c.onDelete !== 'n')).toEqual([]);
  });
});

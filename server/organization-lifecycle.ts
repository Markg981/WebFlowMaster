import { sql } from 'drizzle-orm';
import { privilegedDb } from './db';
import { ORG_SCOPED_TABLES } from '@shared/schema';

/**
 * Export and erasure for a whole organization.
 *
 * Privileged on purpose, and the only module outside the tenancy machinery that is. Two
 * reasons, both structural rather than convenient:
 *
 * Erasure has to remove rows the application is deliberately unable to touch. `audit_log` is
 * append-only — app_user holds SELECT and INSERT and nothing else, which is what makes it
 * evidence — and app_user has no DELETE on `organizations` either. A tenant-scoped connection
 * therefore *cannot* delete an organization, by design. Erasing one is an act on the tenancy
 * boundary, not an act within it.
 *
 * And the export must be able to prove it captured everything, which means reading the
 * catalogue rather than a list someone remembered to update.
 */

/** Tables holding organization data, plus the two that are org-scoped without an RLS policy. */
const TABLES_TO_ERASE = [...ORG_SCOPED_TABLES, 'invitations', 'users'] as const;

/**
 * Orders the tables so children are deleted before their parents, computed from the database's
 * own foreign keys rather than written down here.
 *
 * A hand-maintained order is wrong the first time someone adds a table and does not think about
 * this file — and it fails as a foreign-key violation at the worst possible moment, halfway
 * through erasing a customer's data. The catalogue always knows the real shape.
 */
async function deletionOrder(): Promise<string[]> {
  const rows = await privilegedDb.execute(sql`
    SELECT
      child.relname::text  AS child,
      parent.relname::text AS parent
    FROM pg_constraint c
    JOIN pg_class child  ON child.oid  = c.conrelid
    JOIN pg_class parent ON parent.oid = c.confrelid
    WHERE c.contype = 'f' AND child.relname <> parent.relname
  `);

  const edges = rows.rows as { child: string; parent: string }[];
  const remaining = new Set<string>(TABLES_TO_ERASE);
  const ordered: string[] = [];

  // Repeatedly take any table nothing left in the set still points at.
  while (remaining.size > 0) {
    const free = [...remaining].filter(
      (table) => !edges.some((e) => e.parent === table && e.child !== table && remaining.has(e.child)),
    );

    if (free.length === 0) {
      // A cycle among the tables being erased. Not currently possible, but silently deleting in
      // an arbitrary order would corrupt data, so refuse instead.
      throw new Error(
        `Cannot determine a deletion order: a foreign-key cycle involves ${[...remaining].join(', ')}`,
      );
    }

    for (const table of free) {
      ordered.push(table);
      remaining.delete(table);
    }
  }

  return ordered;
}

/**
 * Everything the organization owns, as plain JSON.
 *
 * Reads privileged and filters explicitly by organization_id rather than going through RLS. The
 * point of an export is completeness, and it covers two tables (`users`, `invitations`) that
 * carry an organization but have no policy — mixing "the policy scopes this" and "the predicate
 * scopes this" in one operation is how a table quietly gets left out.
 *
 * Password hashes and invitation tokens are excluded: this is data portability, not a
 * credential dump, and an export lands in a file the customer will email to someone.
 */
export async function exportOrganization(organizationId: number): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};

  for (const table of TABLES_TO_ERASE) {
    const rows = await privilegedDb.execute(
      sql`SELECT * FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId}`,
    );
    data[table] = rows.rows.map((row) => {
      const copy = { ...(row as Record<string, unknown>) };
      delete copy.password;
      delete copy.token;
      return copy;
    });
  }

  const organization = await privilegedDb.execute(
    sql`SELECT * FROM organizations WHERE id = ${organizationId}`,
  );

  return {
    exportedAt: new Date().toISOString(),
    organization: organization.rows[0] ?? null,
    data,
  };
}

/**
 * Erases an organization and everything belonging to it. Irreversible.
 *
 * One transaction: a half-erased organization is worse than either outcome — the customer was
 * told their data is gone while some of it is not, and what remains is unreachable because the
 * accounts that could read it are among the rows deleted.
 *
 * Note what this cannot do: leave an audit entry about itself. The entry would be deleted along
 * with the organization it describes. Erasure is recorded in the application log instead, which
 * outlives the tenant — the caller is expected to log it.
 */
export async function eraseOrganization(organizationId: number): Promise<{ deleted: Record<string, number> }> {
  const order = await deletionOrder();

  // The two drivers name this differently: node-postgres reports rowCount, PGlite affectedRows.
  const rowsAffected = (result: unknown) => {
    const r = result as { rowCount?: number | null; affectedRows?: number | null };
    return r.rowCount ?? r.affectedRows ?? 0;
  };

  return privilegedDb.transaction(async (tx) => {
    const deleted: Record<string, number> = {};

    for (const table of order) {
      const result = await tx.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId}`,
      );
      deleted[table] = rowsAffected(result);
    }

    const org = await tx.execute(sql`DELETE FROM organizations WHERE id = ${organizationId}`);
    deleted.organizations = rowsAffected(org);

    return { deleted };
  });
}

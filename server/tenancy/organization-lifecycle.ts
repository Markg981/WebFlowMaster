import { sql } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import logger from '../platform/logger';
import { relocateMembersBeforeErasure } from './organization-memberships';
import { ORG_SCOPED_TABLES } from '@shared/schema';
import {
  BASELINES_PREFIX,
  RESULTS_PREFIX,
  artifactStore,
  type ArtifactStore,
} from './artifact-store';

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
 * Erased with the organization but left out of its export: one-time password reset links are a
 * credential for a day, not the organization's data, and an export is a file that gets e-mailed.
 * The organization's wrapped encryption keys are key material, useless without the master key and
 * not data either; a restored installation makes new ones. A run's pending job is delivery state
 * that lasts seconds, not data.
 */
export const NOT_EXPORTED = new Set<string>([
  'password_resets',
  'organization_keys',
  'execution_outbox',
]);

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
      (table) =>
        !edges.some((e) => e.parent === table && e.child !== table && remaining.has(e.child)),
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
 * Columns that are key material or credential residue, by name: password and token hashes,
 * ciphertext with its IV and auth tag, tokens, salts. Matched on the name so a column added
 * later with the usual naming is left out by default. A `*_prefix` display column is kept.
 */
export function isSecretColumn(column: string): boolean {
  if (column.endsWith('_prefix')) return false;
  return /hash|encrypted|cipher|auth_tag|password|salt|(^|_)iv(_|$)|(^|_)token(_|$)/.test(column);
}

/**
 * Everything the organization owns, as plain JSON.
 *
 * Reads privileged and filters explicitly by organization_id rather than going through RLS. The
 * point of an export is completeness, and it covers two tables (`users`, `invitations`) that
 * carry an organization but have no policy — mixing "the policy scopes this" and "the predicate
 * scopes this" in one operation is how a table quietly gets left out.
 *
 * Password and key hashes, ciphertext (with IV and tag) and tokens are excluded: this is data portability, not a
 * credential dump, and an export lands in a file the customer will email to someone.
 */
export async function exportOrganization(organizationId: number): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};

  for (const table of TABLES_TO_ERASE) {
    if (NOT_EXPORTED.has(table)) continue;
    const rows = await privilegedDb.execute(
      sql`SELECT * FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId}`,
    );
    data[table] = rows.rows.map((row) => {
      const copy = { ...(row as Record<string, unknown>) };
      for (const column of Object.keys(copy)) if (isSecretColumn(column)) delete copy[column];
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
export async function eraseOrganization(
  organizationId: number,
  options: {
    store?: ArtifactStore;
    /** Who asked for it; recorded in organization_erasures, which outlives the organization. */
    actor?: { id?: number | null; username?: string | null };
  } = {},
): Promise<{ deleted: Record<string, number>; files: { removed: number; failed: string[] } }> {
  const order = await deletionOrder();
  const orgRow = await privilegedDb.execute(
    sql`SELECT name FROM organizations WHERE id = ${organizationId}`,
  );
  const organizationName = (orgRow.rows[0] as { name?: string } | undefined)?.name ?? null;

  // Where its files are, read before the rows that name them are gone: each run's evidence
  // under results/<plan>/<run>/, and its visual baselines under visual-baselines/org_<id>/.
  const runs = await privilegedDb.execute(
    sql`SELECT test_plan_id, id FROM test_plan_executions WHERE organization_id = ${organizationId}`,
  );
  const retained = await privilegedDb.execute(
    sql`SELECT key FROM quota_artifacts WHERE organization_id=${organizationId}`,
  );
  const prefixes = new Set([
    ...(runs.rows as Array<{ test_plan_id: string; id: string }>).map(
      (run) => `${RESULTS_PREFIX}${run.test_plan_id}/${run.id}/`,
    ),
    ...(retained.rows as Array<{ key: string }>).flatMap(
      (row) => /^results\/[^/]+\/[^/]+\//.exec(row.key)?.[0] ?? [],
    ),
    `${BASELINES_PREFIX}org_${organizationId}/`,
  ]);

  // The two drivers name this differently: node-postgres reports rowCount, PGlite affectedRows.
  const rowsAffected = (result: unknown) => {
    const r = result as { rowCount?: number | null; affectedRows?: number | null };
    return r.rowCount ?? r.affectedRows ?? 0;
  };

  return privilegedDb
    .transaction(async (tx) => {
      const deleted: Record<string, number> = {};

      // audit_log is guarded by a trigger (migration 0102); erasure is a maintenance act.
      await tx.execute(sql`SELECT set_config('app.audit_maintenance', 'on', true)`);

      // Members who also belong elsewhere are moved there first (migration 0086): erasing an
      // organization takes its accounts with it, not the seats those people hold in others.
      deleted.members_relocated = await relocateMembersBeforeErasure(tx, organizationId);

      for (const table of order) {
        const result = await tx.execute(
          sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId}`,
        );
        deleted[table] = rowsAffected(result);
      }

      const org = await tx.execute(sql`DELETE FROM organizations WHERE id = ${organizationId}`);
      deleted.organizations = rowsAffected(org);

      return deleted;
    })
    .then(async (deleted) => {
      // The files go after the rows have: a failed transaction must not leave a living
      // organization without its evidence. A file that cannot be removed is reported, never
      // thrown — the rows are already gone, and the operator is told exactly what is left.
      const store = options.store ?? artifactStore();
      const files = { removed: 0, failed: [] as string[] };
      for (const prefix of prefixes) {
        try {
          files.removed += await store.deletePrefix(prefix);
        } catch {
          files.failed.push(prefix);
        }
      }
      // Recorded outside the tenant tables (migration 0095): the audit log went with the
      // organization, this row does not. Only when something was actually erased, so repeating
      // the call on an erased organization stays a no-op. A failure to record is logged, never
      // thrown: the erasure has committed and cannot be undone.
      if (deleted.organizations > 0) {
        try {
          await privilegedDb.execute(sql`
            INSERT INTO organization_erasures
              (organization_id, organization_name, actor_user_id, actor_username,
               deleted_counts, files_removed, files_failed)
            VALUES (${organizationId}, ${organizationName}, ${options.actor?.id ?? null},
              ${options.actor?.username ?? null}, ${JSON.stringify(deleted)}::jsonb,
              ${files.removed}, ${JSON.stringify(files.failed)}::jsonb)
          `);
        } catch (error) {
          logger.error({
            message: 'Organization erased, but the erasure record could not be written',
            organizationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { deleted, files };
    });
}

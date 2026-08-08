import { and, asc, eq } from 'drizzle-orm';
import type { db as DbType } from '../../server/db';
import { users, projects, apiTests, type InsertApiTest } from '@shared/schema';

type Database = typeof DbType;

export interface ImportSummary {
  created: number;
  updated: number;
  orphans: string[]; // "METHOD url" of DB tests no longer present in the import
}

export async function resolveUserId(database: Database, override?: number): Promise<number> {
  if (override !== undefined) return override;
  const rows = await database.select({ id: users.id }).from(users).orderBy(asc(users.id)).limit(1);
  if (rows.length === 0) throw new Error('No users found in the database; cannot own imported tests.');
  return rows[0].id;
}

/**
 * Returns the project id together with the organization it belongs to. The organization is
 * returned rather than left for the caller to re-derive because every row the import goes
 * on to write needs it — `organizationId` is NOT NULL on all of them — and a caller that
 * has to look it up separately is a caller that can forget to.
 */
export async function findOrCreateProject(
  database: Database,
  userId: number,
  name: string,
): Promise<{ projectId: number; organizationId: number }> {
  // A created project belongs to the same organization as the user who owns it.
  const [owner] = await database.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!owner) throw new Error(`No user found with id ${userId}; cannot determine organization for imported project.`);

  // Match by name AND organization: matching on name alone could attach this run's
  // apiTests (stamped with the importer's org) to a same-named project owned by another
  // tenant.
  const existing = await database
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.name, name), eq(projects.organizationId, owner.organizationId)))
    .limit(1);
  if (existing.length > 0) return { projectId: existing[0].id, organizationId: owner.organizationId };

  // Plain .returning(): db is a union of the node-postgres and PGlite drivers, and the
  // selective form does not resolve across it. Every other call site in the repo does the
  // same.
  const created = await database.insert(projects).values({ name, userId, organizationId: owner.organizationId }).returning();
  return { projectId: created[0].id, organizationId: owner.organizationId };
}

const keyOf = (method: string, url: string) => `${method} ${url}`;

type KVP = { id: string; key: string; value: string; enabled: boolean };

// Keep every existing param (and its user-entered value); append params that are new.
export function mergeQueryParams(prev: unknown, next: unknown): KVP[] {
  const prevArr = Array.isArray(prev) ? (prev as KVP[]) : [];
  const nextArr = Array.isArray(next) ? (next as KVP[]) : [];
  const byKey = new Map(prevArr.map((p) => [p.key, p]));
  for (const n of nextArr) {
    if (!byKey.has(n.key)) byKey.set(n.key, n);
  }
  return Array.from(byKey.values());
}

export async function importApiTests(
  database: Database,
  records: InsertApiTest[],
  projectId: number,
): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, orphans: [] };
  const existing = await database.select().from(apiTests).where(eq(apiTests.projectId, projectId));
  const existingByKey = new Map(existing.map((t) => [keyOf(t.method, t.url), t]));
  const importedKeys = new Set(records.map((r) => keyOf(r.method as string, r.url as string)));

  for (const rec of records) {
    const key = keyOf(rec.method as string, rec.url as string);
    const prev = existingByKey.get(key);
    if (!prev) {
      await database.insert(apiTests).values(rec);
      summary.created++;
    } else {
      // Preserve user-owned fields (assertions, filled param values, auth); refresh
      // structural ones; add newly-appeared params.
      const mergedParams = mergeQueryParams(prev.queryParams, rec.queryParams);
      await database
        .update(apiTests)
        .set({
          module: rec.module,
          featureArea: rec.featureArea,
          queryParams: mergedParams,
          updatedAt: new Date(),
        })
        .where(eq(apiTests.id, prev.id));
      summary.updated++;
    }
  }

  for (const t of existing) {
    if (!importedKeys.has(keyOf(t.method, t.url))) summary.orphans.push(keyOf(t.method, t.url));
  }
  return summary;
}

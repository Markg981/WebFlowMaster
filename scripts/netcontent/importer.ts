import { asc, eq } from 'drizzle-orm';
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

export async function findOrCreateProject(
  database: Database,
  userId: number,
  name: string,
): Promise<number> {
  const existing = await database
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.name, name))
    .limit(1);
  if (existing.length > 0) return existing[0].id;
  const created = await database.insert(projects).values({ name, userId }).returning({ id: projects.id });
  return created[0].id;
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

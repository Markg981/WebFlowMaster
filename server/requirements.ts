import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { apiTests, requirementTests, requirements, testPlanExecutions, testPlans, tests, type Requirement } from '@shared/schema';
import {
  computeCoverage,
  coverageSummary,
  kindFromTrackerType,
  outcomeOf,
  type CoverageRun,
  type CoverageTest,
  type RequirementCoverage,
} from '@shared/requirements';
import type { TenantTx } from './middleware/tenancy';
import type { TrackedItem } from './issue-providers';

/**
 * Requirements traceability against the database: which tests are linked, how each did the last
 * time it ran, and what that makes of each requirement (shared/requirements.ts decides that part).
 *
 * Everything runs in the requester's tenant transaction, so row-level security decides what is
 * seen: a linked test in a project the requester cannot see is counted as hidden, never named.
 */

/** Which results count: the latest anywhere, the latest of one plan, or exactly one run. */
export type CoverageScope = { planId?: string | null; executionId?: string | null };

const key = (type: 'ui' | 'api', id: number) => `${type}:${id}`;

const idList = (ids: number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/** A timestamp as ISO, from a Date or from milliseconds since the epoch. */
const toIso = (value: unknown): string | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(Number(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * The latest finished run of each test that has result rows, within the scope, and the outcome
 * of all its rows in that run (one per browser) together.
 */
async function latestOutcomes(
  tx: TenantTx,
  uiIds: number[],
  apiIds: number[],
  scope: CoverageScope,
): Promise<Map<string, { outcome: CoverageTest['outcome']; lastRun: CoverageRun }>> {
  const found = new Map<string, { outcome: CoverageTest['outcome']; lastRun: CoverageRun }>();
  if (uiIds.length === 0 && apiIds.length === 0) return found;

  const which = sql.join(
    [
      ...(uiIds.length ? [sql`r.ui_test_id IN (${idList(uiIds)})`] : []),
      ...(apiIds.length ? [sql`r.api_test_id IN (${idList(apiIds)})`] : []),
    ],
    sql` OR `,
  );
  const scoped = scope.executionId
    ? sql`AND e.id = ${scope.executionId}`
    : scope.planId
      ? sql`AND e.test_plan_id = ${scope.planId}`
      : sql``;

  const result = await tx.execute(sql`
    WITH ranked AS (
      SELECT r.ui_test_id, r.api_test_id, r.status, e.id AS execution_id, e.test_plan_id, p.name AS plan_name,
             -- As milliseconds, not as the timestamp: in a raw query a timestamp without time zone
             -- comes back as whatever the driver makes of it, and node-postgres reads it in the
             -- server's local zone. The column holds UTC (server/db-time-zone.test.ts).
             (EXTRACT(EPOCH FROM COALESCE(e.completed_at, e.started_at, e.queued_at)) * 1000)::bigint AS at_ms,
             DENSE_RANK() OVER (
               PARTITION BY r.ui_test_id, r.api_test_id
               ORDER BY COALESCE(e.completed_at, e.started_at, e.queued_at) DESC, e.id DESC
             ) AS rnk
      FROM report_test_case_results r
      JOIN test_plan_executions e ON e.id = r.test_plan_execution_id
      LEFT JOIN test_plans p ON p.id = e.test_plan_id
      WHERE (${which})
        AND e.status NOT IN ('queued', 'running', 'cancelling')
        ${scoped}
    )
    SELECT * FROM ranked WHERE rnk = 1
  `);

  const statuses = new Map<string, { statuses: string[]; lastRun: CoverageRun }>();
  for (const row of result.rows as any[]) {
    const k = row.ui_test_id != null ? key('ui', Number(row.ui_test_id)) : key('api', Number(row.api_test_id));
    const entry = statuses.get(k) ?? {
      statuses: [],
      lastRun: { executionId: String(row.execution_id), planId: String(row.test_plan_id), planName: row.plan_name ?? null, at: toIso(row.at_ms) },
    };
    entry.statuses.push(String(row.status));
    statuses.set(k, entry);
  }
  for (const [k, entry] of Array.from(statuses)) found.set(k, { outcome: outcomeOf(entry.statuses), lastRun: entry.lastRun });
  return found;
}

export interface RequirementRow extends Requirement {
  /** Tests linked to this requirement itself, visible or not; an epic's coverage counts more. */
  directTests: number;
  coverage: RequirementCoverage;
}

/** Every requirement of the organization with its coverage, and the numbers for the whole set. */
export async function loadCoverage(tx: TenantTx, scope: CoverageScope = {}) {
  const rows = await tx.select().from(requirements).orderBy(asc(requirements.key));
  const links = await tx.select().from(requirementTests);

  const uiIds = Array.from(new Set(links.filter((l) => l.testType === 'ui').map((l) => l.testId!)));
  const apiIds = Array.from(new Set(links.filter((l) => l.testType === 'api').map((l) => l.apiTestId!)));
  // Through RLS: what comes back is what the requester can see.
  const uiNames = uiIds.length ? await tx.select({ id: tests.id, name: tests.name }).from(tests).where(inArray(tests.id, uiIds)) : [];
  const apiNames = apiIds.length ? await tx.select({ id: apiTests.id, name: apiTests.name }).from(apiTests).where(inArray(apiTests.id, apiIds)) : [];
  const outcomes = await latestOutcomes(tx, uiNames.map((t) => t.id), apiNames.map((t) => t.id), scope);

  const visible = new Map<string, CoverageTest>();
  for (const [type, list] of [['ui', uiNames], ['api', apiNames]] as const) {
    for (const test of list) {
      const k = key(type, test.id);
      const latest = outcomes.get(k);
      visible.set(k, { type, id: test.id, name: test.name, outcome: latest?.outcome ?? 'notRun', lastRun: latest?.lastRun ?? null });
    }
  }

  const coverage = computeCoverage(
    rows.map((r) => ({ id: r.id, parentId: r.parentId })),
    links.map((l) => ({ requirementId: l.requirementId, type: l.testType, testId: (l.testType === 'ui' ? l.testId : l.apiTestId)! })),
    visible,
  );
  const direct = new Map<number, number>();
  for (const link of links) direct.set(link.requirementId, (direct.get(link.requirementId) ?? 0) + 1);

  const list: RequirementRow[] = rows.map((r) => ({ ...r, directTests: direct.get(r.id) ?? 0, coverage: coverage.get(r.id)! }));
  return { requirements: list, summary: coverageSummary(list.map((r) => r.coverage)) };
}

/** The plan or run a scope names, for the page to say what it is showing; null when it names none. */
export async function describeScope(tx: TenantTx, scope: CoverageScope) {
  if (scope.executionId) {
    const [run] = await tx
      .select({ id: testPlanExecutions.id, planId: testPlanExecutions.testPlanId, planName: testPlans.name, at: testPlanExecutions.completedAt })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlans.id, testPlanExecutions.testPlanId))
      .where(eq(testPlanExecutions.id, scope.executionId))
      .limit(1);
    return run ? { kind: 'execution' as const, ...run, at: toIso(run.at) } : undefined;
  }
  if (scope.planId) {
    const [plan] = await tx.select({ id: testPlans.id, name: testPlans.name }).from(testPlans).where(eq(testPlans.id, scope.planId)).limit(1);
    return plan ? { kind: 'plan' as const, planId: plan.id, planName: plan.name } : undefined;
  }
  return null;
}

/** Whether making `parentId` the parent of `id` would put a requirement under itself. */
export async function wouldLoop(tx: TenantTx, id: number, parentId: number): Promise<boolean> {
  const rows = await tx.select({ id: requirements.id, parentId: requirements.parentId }).from(requirements);
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  for (let current: number | null | undefined = parentId, steps = 0; current != null && steps <= rows.length; steps++) {
    if (current === id) return true;
    current = parentOf.get(current);
  }
  return false;
}

export interface ImportOutcome {
  created: string[];
  updated: string[];
}

/**
 * Writes what the tracker said: a requirement per item, created or brought up to date, and each
 * story under its epic when the epic is here too. Keys are matched without regard to case, so an
 * import of SHOP-142 updates the requirement somebody typed as shop-142.
 */
export async function upsertTrackedItems(
  tx: TenantTx,
  organizationId: number,
  trackerId: string,
  items: TrackedItem[],
  userId: number,
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { created: [], updated: [] };
  const now = new Date();
  const existing = await tx.select({ id: requirements.id, key: requirements.key }).from(requirements);
  const idOf = new Map(existing.map((r) => [r.key.toLowerCase(), r.id]));

  for (const item of items) {
    const values = {
      title: item.title.slice(0, 500),
      kind: kindFromTrackerType(item.type),
      trackerId,
      url: item.url,
      externalType: item.type || null,
      externalStatus: item.status,
      syncedAt: now,
      updatedAt: now,
    };
    const id = idOf.get(item.key.toLowerCase());
    if (id != null) {
      await tx.update(requirements).set(values).where(eq(requirements.id, id));
      outcome.updated.push(item.key);
    } else {
      const [created] = await tx
        .insert(requirements)
        .values({ organizationId, key: item.key, createdBy: userId, ...values })
        .returning({ id: requirements.id });
      idOf.set(item.key.toLowerCase(), created.id);
      outcome.created.push(item.key);
    }
  }

  for (const item of items) {
    const id = idOf.get(item.key.toLowerCase())!;
    const parentId = item.parentKey ? idOf.get(item.parentKey.toLowerCase()) ?? null : null;
    if (parentId === id) continue;
    if (parentId != null && (await wouldLoop(tx, id, parentId))) continue;
    // A parent the tracker names but that is not here is left as it is, not cleared.
    if (parentId != null || !item.parentKey) {
      await tx.update(requirements).set({ parentId }).where(and(eq(requirements.id, id)));
    }
  }
  return outcome;
}

const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  // A leading = + - @ would be run as a formula by a spreadsheet: shown as text instead.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * The traceability matrix as CSV: one line per requirement and covering test, and one line for a
 * requirement no test covers — the lines an auditor is looking for.
 */
export function matrixCsv(rows: RequirementRow[]): string {
  const keyOf = new Map(rows.map((r) => [r.id, r.key]));
  const header = ['Requirement', 'Title', 'Kind', 'Parent', 'Tracker status', 'Coverage', 'Test', 'Test type', 'Last outcome', 'Last run', 'Plan', 'Run id', 'Hidden tests'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    const base = [r.key, r.title, r.kind, r.parentId ? keyOf.get(r.parentId) ?? '' : '', r.externalStatus ?? '', r.coverage.state];
    if (r.coverage.tests.length === 0) {
      lines.push([...base, '', '', '', '', '', '', r.coverage.hidden].map(csvCell).join(','));
      continue;
    }
    for (const test of r.coverage.tests) {
      lines.push(
        [...base, test.name, test.type === 'ui' ? 'web' : 'api', test.outcome, test.lastRun?.at ?? '', test.lastRun?.planName ?? '', test.lastRun?.executionId ?? '', r.coverage.hidden]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return lines.join('\r\n') + '\r\n';
}

import os from 'os';
import { randomUUID } from 'crypto';
import { and, asc, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { runWorkItems, testPlanExecutions } from '@shared/schema';
import { withTenantTransaction } from './middleware/tenancy';
import type { BrowserChoice } from './browsers';

/**
 * One plan run on several workers at once.
 *
 * A plan's `maxParallelTests` runs tests side by side on one worker, which is as far as one
 * machine's memory goes. `shards` lets several workers share a run: the worker that takes the run
 * (the coordinator) writes its work down as items in `run_work_items`, asks for helpers, and then
 * claims items like any of them until none are left. A helper is an ordinary job on the execution
 * queue; whichever worker picks it up joins the run.
 *
 * An item is one test on one browser and language, or, when the plan's API tests pass values on to
 * later ones, the whole sequence of a browser and language, which has to stay on one worker and in
 * order. It carries what to run as the coordinator resolved it — the browser it started, headless
 * or not, the engine it fell back to — so every worker runs the same thing.
 *
 * Every claim keeps a heartbeat. A worker that dies mid-item stops it, and after `STALE_CLAIM_MS`
 * another worker takes the item back. The coordinator waits for every item to be done and then
 * finishes the run as it always has, from the results in the database: only the parts that lived
 * in one worker's memory — the legacy results list, the tests that could not be executed — go
 * through the items, and a plan policy's stop goes through the run's row so every worker sees it.
 *
 * With one shard, the default, none of this is used.
 */

export const MAX_SHARDS = 8;
export const WORK_ITEM_HEARTBEAT_MS = Number(process.env.WORK_ITEM_HEARTBEAT_MS) || 15_000;
export const STALE_CLAIM_MS = Number(process.env.STALE_CLAIM_MS) || 120_000;
/** How long a worker with nothing to claim waits before it looks again. */
export const WORK_POLL_MS = process.env.NODE_ENV === 'test' ? 20 : 1_000;

/** What one item runs: tests in order, with the variables they start from. */
export interface WorkUnit {
  units: Array<{ link: number; browserChoice?: BrowserChoice; locale?: string }>;
  captured: Record<string, string>;
}

export interface WorkItemResults {
  /** The run's legacy `results` entries this item produced. */
  legacy: unknown[];
  /** Tests that could not be executed at all, as the run's failure message lists them. */
  failures: string[];
}

export function shardCount(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(MAX_SHARDS, Math.max(1, n)) : 1;
}

/** A name for one worker's share of one run, unique even for two jobs in one process. */
export function workerName(): string {
  return `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

/** Written once by the coordinator. Writing them again is harmless: an item that exists is kept as it is. */
export async function writeWorkItems(
  executionId: string,
  organizationId: number,
  items: Array<{ key: string; unit: WorkUnit }>,
): Promise<void> {
  if (items.length === 0) return;
  await withTenantTransaction(async (tx) => {
    await tx
      .insert(runWorkItems)
      .values(items.map((item, position) => ({ executionId, organizationId, key: item.key, position, unit: item.unit })))
      .onConflictDoNothing();
  });
}

/**
 * The next item nobody holds, in plan order, or one whose holder stopped answering. Rows another
 * worker is claiming at the same moment are skipped rather than waited for.
 */
export async function claimWorkItem(executionId: string, worker: string): Promise<{ key: string; unit: WorkUnit } | null> {
  return withTenantTransaction(async (tx) => {
    const staleBefore = sql`now() - make_interval(secs => ${STALE_CLAIM_MS / 1000})`;
    const [next] = await tx
      .select({ key: runWorkItems.key, unit: runWorkItems.unit })
      .from(runWorkItems)
      .where(
        and(
          eq(runWorkItems.executionId, executionId),
          or(
            eq(runWorkItems.state, 'pending'),
            and(eq(runWorkItems.state, 'claimed'), lt(runWorkItems.heartbeatAt, staleBefore)),
          ),
        ),
      )
      .orderBy(asc(runWorkItems.position))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!next) return null;
    await tx
      .update(runWorkItems)
      .set({ state: 'claimed', claimedBy: worker, heartbeatAt: sql`now()` })
      .where(and(eq(runWorkItems.executionId, executionId), eq(runWorkItems.key, next.key)));
    return { key: next.key, unit: next.unit as WorkUnit };
  });
}

/** The items this worker holds are still being worked on. */
export async function heartbeatWorkItems(executionId: string, worker: string): Promise<void> {
  await withTenantTransaction(async (tx) => {
    await tx
      .update(runWorkItems)
      .set({ heartbeatAt: sql`now()` })
      .where(and(eq(runWorkItems.executionId, executionId), eq(runWorkItems.claimedBy, worker), eq(runWorkItems.state, 'claimed')));
  });
}

/**
 * Done, with what it produced. Only by the worker that holds it: an item taken back from a worker
 * that then came back to life is the other worker's to finish. Returns whether it was recorded.
 */
export async function finishWorkItem(
  executionId: string,
  key: string,
  worker: string,
  results: WorkItemResults,
): Promise<boolean> {
  const rows = await withTenantTransaction((tx) =>
    tx
      .update(runWorkItems)
      .set({ state: 'done', finishedAt: sql`now()`, results, error: results.failures[0] ?? null })
      .where(and(eq(runWorkItems.executionId, executionId), eq(runWorkItems.key, key), eq(runWorkItems.claimedBy, worker)))
      .returning(),
  );
  return rows.length > 0;
}

/** How many items are not done yet. */
export async function openWorkItems(executionId: string): Promise<number> {
  const [row] = await withTenantTransaction((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(runWorkItems)
      .where(and(eq(runWorkItems.executionId, executionId), ne(runWorkItems.state, 'done'))),
  );
  return Number(row?.count ?? 0);
}

/** What every item produced, in plan order. */
export async function workItemResults(executionId: string): Promise<WorkItemResults> {
  const rows = await withTenantTransaction((tx) =>
    tx
      .select({ results: runWorkItems.results })
      .from(runWorkItems)
      .where(eq(runWorkItems.executionId, executionId))
      .orderBy(asc(runWorkItems.position)),
  );
  const merged: WorkItemResults = { legacy: [], failures: [] };
  for (const { results } of rows) {
    const r = results as Partial<WorkItemResults> | null;
    merged.legacy.push(...(r?.legacy ?? []));
    merged.failures.push(...(r?.failures ?? []));
  }
  return merged;
}

/** A plan policy stopped the run: said once, on the run, for every worker sharing it. The first reason stays. */
export async function recordStopReason(executionId: string, reason: string): Promise<void> {
  await withTenantTransaction(async (tx) => {
    await tx
      .update(testPlanExecutions)
      .set({ stopReason: reason })
      .where(and(eq(testPlanExecutions.id, executionId), isNull(testPlanExecutions.stopReason)));
  });
}

export async function sharedStopReason(executionId: string): Promise<string | null> {
  const [row] = await withTenantTransaction((tx) =>
    tx.select({ stopReason: testPlanExecutions.stopReason }).from(testPlanExecutions).where(eq(testPlanExecutions.id, executionId)).limit(1),
  );
  return row?.stopReason ?? null;
}

/** Asks for helpers: the worker process registers how (server/worker.ts). Without one, the coordinator runs every item itself. */
export type ShardDispatcher = (job: { executionId: string; planId: string; userId: number; shard: number; updateBaselines: boolean }) => Promise<void>;

let dispatcher: ShardDispatcher | null = null;

export function registerShardDispatcher(next: ShardDispatcher | null): void {
  dispatcher = next;
}

export function shardDispatcher(): ShardDispatcher | null {
  return dispatcher;
}

export const SHARD_JOB = 'execute-shard';

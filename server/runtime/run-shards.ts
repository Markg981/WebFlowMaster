import os from 'os';
import { randomUUID } from 'crypto';
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import {
  executionUnitAttempts,
  executionUnits,
  runWorkItems,
  testPlanExecutions,
  type RunWorkItem,
} from '@shared/schema';
import type { WorkClaimRef, WorkerLossPolicy } from '@shared/execution-identity';
import { withTenantTransaction, type TenantTx } from '../platform/middleware/tenancy';
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
 * Every claim has an epoch and a lease (migration 0093): a write is admitted only under the current
 * claim with its lease left by the database's clock, so a worker whose claim was taken over or ran
 * out cannot record over the item (server/execution/plan-run/fence.ts). A worker that dies mid-item
 * lets its lease run out; the item is then taken again only if nothing was tried under it, or the
 * plan's worker-loss policy allows a replay, and otherwise ends `indeterminate` — terminal, so
 * nobody waits for it. The coordinator waits for every item to be over and then
 * finishes the run as it always has, from the results in the database: only the parts that lived
 * in one worker's memory — the legacy results list, the tests that could not be executed — go
 * through the items, and a plan policy's stop goes through the run's row so every worker sees it.
 *
 * With one shard, the default, none of this is used.
 */

export const MAX_SHARDS = 8;
export const WORK_ITEM_HEARTBEAT_MS = Number(process.env.WORK_ITEM_HEARTBEAT_MS) || 15_000;
export const STALE_CLAIM_MS = Number(process.env.STALE_CLAIM_MS) || 120_000;
/** How long a claim's lease lasts from its last confirmed renewal, by the database's clock (lot P11). */
export const WORK_CLAIM_LEASE_MS = Number(process.env.WORK_CLAIM_LEASE_MS) || STALE_CLAIM_MS;
/** What a worker keeps back from its lease for a write to reach the database before it ends. */
export const WORK_CLAIM_MARGIN_MS =
  Number(process.env.WORK_CLAIM_MARGIN_MS) || Math.min(10_000, Math.floor(WORK_CLAIM_LEASE_MS / 4));
/** How long a worker with nothing to claim waits before it looks again. */
export const WORK_POLL_MS = process.env.NODE_ENV === 'test' ? 20 : 1_000;

/** What one item runs: tests in order, with the variables they start from. */
export interface WorkUnit {
  units: Array<{
    link: number;
    browserChoice?: BrowserChoice;
    locale?: string;
    bddRowIndex?: number;
    mobileTarget?: import('../mobile/mobile-plan-units').MobilePlanTarget;
    /** The unit of the run's manifest (shared/execution-identity.ts); absent on items written before it. */
    unitId?: string;
  }>;
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
      .values(
        items.map((item, position) => ({
          executionId,
          organizationId,
          key: item.key,
          position,
          unit: item.unit,
        })),
      )
      .onConflictDoNothing();
  });
}

/** The claim on a work item is no longer the writer's, or the run takes no more results (lot P11). */
export class OwnershipLostError extends Error {
  /** Read like a run's stop by a step it cuts short (stepInterruption, server/web/step-executor.ts). */
  readonly stopCause = 'lost' as const;

  constructor(message: string) {
    super(message);
    this.name = 'OwnershipLostError';
  }
}

/** One claim this worker holds: the item, what it runs, and how long its lease was granted for. */
export interface WorkClaim extends WorkClaimRef {
  unit: WorkUnit;
  leaseMs: number;
  /** When, by this process's monotonic clock, the claim was asked for: its lease cannot have started earlier. */
  askedAt: number;
}

export interface ClaimOptions {
  leaseMs?: number;
  /** What an expired claim with work begun becomes: see `WorkerLossPolicy`. */
  policy?: WorkerLossPolicy;
}

const leaseInterval = (leaseMs: number) => sql`make_interval(secs => ${leaseMs / 1000})`;

/** A claim whose lease has ended by the database's clock; a row from before leases, by its heartbeat. */
const expired = sql`(${runWorkItems.leaseExpiresAt} < now() or (${runWorkItems.leaseExpiresAt} is null and ${runWorkItems.heartbeatAt} < now() - ${leaseInterval(STALE_CLAIM_MS)}))`;

/**
 * The next item nobody holds, in plan order. Rows another worker is claiming at the same moment
 * are skipped rather than waited for.
 *
 * An item whose claim expired is not simply handed on. Its units may have done something to the
 * application, and a second worker repeating it is a second run of a click or a request, not the
 * same one. So it is taken again only when that cannot be the case — no attempt was begun under the
 * expired claim — or when the plan says it may (`replay`, one unit only). Otherwise it ends
 * `indeterminate`, its unfinished units with it, and the search goes on. A chained lane is never
 * resumed half-way: its captured values died with the worker and its first requests already happened.
 */
export async function claimWorkItem(
  executionId: string,
  worker: string,
  options: ClaimOptions = {},
): Promise<WorkClaim | null> {
  const leaseMs = options.leaseMs ?? WORK_CLAIM_LEASE_MS;
  const askedAt = performance.now();
  return withTenantTransaction(async (tx) => {
    for (;;) {
      const [next] = await tx
        .select()
        .from(runWorkItems)
        .where(
          and(
            eq(runWorkItems.executionId, executionId),
            or(eq(runWorkItems.state, 'pending'), and(eq(runWorkItems.state, 'claimed'), expired)),
          ),
        )
        .orderBy(asc(runWorkItems.position))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!next) return null;
      if (next.state === 'claimed') {
        const outcome = await settleExpiredClaim(tx, next, options.policy ?? 'indeterminate');
        if (outcome === 'indeterminate') continue;
      }
      const [claimed] = await tx
        .update(runWorkItems)
        .set({
          state: 'claimed',
          claimedBy: worker,
          epoch: sql`${runWorkItems.epoch} + 1`,
          leaseExpiresAt: sql`now() + ${leaseInterval(leaseMs)}`,
          heartbeatAt: sql`now()`,
        })
        .where(and(eq(runWorkItems.executionId, executionId), eq(runWorkItems.key, next.key)))
        .returning();
      return {
        executionId,
        workItemKey: next.key,
        owner: worker,
        epoch: claimed.epoch,
        unit: next.unit as WorkUnit,
        leaseMs,
        askedAt,
      };
    }
  });
}

/** The unit ids an item runs; empty for an item written before the manifest. */
const unitIdsOf = (unit: WorkUnit): string[] =>
  unit.units.flatMap((spec) => (spec.unitId ? [spec.unitId] : []));

/**
 * What an expired claim becomes, inside the claiming transaction (the item's row is locked):
 * 'reclaim' when another worker may take it, 'indeterminate' when it has ended here.
 */
async function settleExpiredClaim(
  tx: TenantTx,
  item: RunWorkItem,
  policy: WorkerLossPolicy,
): Promise<'reclaim' | 'indeterminate'> {
  const unit = item.unit as WorkUnit;
  const unitIds = unitIdsOf(unit);
  const known = unitIds.length === unit.units.length && unitIds.length > 0;
  const begun = known
    ? await tx
        .select({ unitId: executionUnitAttempts.unitId })
        .from(executionUnitAttempts)
        .where(
          and(
            eq(executionUnitAttempts.executionId, item.executionId),
            inArray(executionUnitAttempts.unitId, unitIds),
            eq(executionUnitAttempts.claimEpoch, item.epoch),
          ),
        )
        .limit(1)
    : [{ unitId: '?' }];
  const abandon = () =>
    known
      ? tx
          .update(executionUnitAttempts)
          .set({ state: 'abandoned', finishedAt: sql`now()` })
          .where(
            and(
              eq(executionUnitAttempts.executionId, item.executionId),
              inArray(executionUnitAttempts.unitId, unitIds),
              eq(executionUnitAttempts.claimEpoch, item.epoch),
              eq(executionUnitAttempts.state, 'running'),
            ),
          )
      : Promise.resolve();
  // Nothing was tried under the lost claim: nothing reached the application, so nothing repeats.
  if (begun.length === 0) return 'reclaim';
  // The plan accepts running the unit again, and it is one unit with nothing captured before it.
  if (policy === 'replay' && known && unitIds.length === 1) {
    await abandon();
    return 'reclaim';
  }
  await abandon();
  const reason =
    `A worker running "${item.key}" stopped answering (claim ${item.epoch} by ${item.claimedBy ?? 'unknown'}) ` +
    'after its tests had started. Their results are not known: they are not run again, and the run is incomplete.';
  if (known)
    await tx
      .update(executionUnits)
      .set({ state: 'indeterminate', reason, updatedAt: sql`now()` })
      .where(
        and(
          eq(executionUnits.executionId, item.executionId),
          inArray(executionUnits.unitId, unitIds),
          inArray(executionUnits.state, ['planned', 'running']),
        ),
      );
  const results: WorkItemResults = { legacy: [], failures: [reason] };
  await tx
    .update(runWorkItems)
    .set({ state: 'indeterminate', finishedAt: sql`now()`, error: reason, results })
    .where(and(eq(runWorkItems.executionId, item.executionId), eq(runWorkItems.key, item.key)));
  return 'indeterminate';
}

/** The conditions under which a claim is still the one it names, with a lease left. */
const current = (claim: WorkClaimRef) =>
  and(
    eq(runWorkItems.executionId, claim.executionId),
    eq(runWorkItems.key, claim.workItemKey),
    eq(runWorkItems.state, 'claimed'),
    eq(runWorkItems.claimedBy, claim.owner),
    eq(runWorkItems.epoch, claim.epoch),
    sql`${runWorkItems.leaseExpiresAt} > now()`,
  );

/**
 * The point a write is admitted at: inside the writing transaction, the claim row is locked and
 * must still be current with a lease left. A lease that ended counts as lost even when nobody has
 * taken the item since: nobody can tell, any more, whether somebody will.
 */
export async function admitUnderClaim(tx: TenantTx, claim: WorkClaimRef): Promise<void> {
  const [row] = await tx
    .select({ key: runWorkItems.key })
    .from(runWorkItems)
    .where(current(claim))
    .for('update');
  if (!row)
    throw new OwnershipLostError(
      `The claim ${claim.epoch} on "${claim.workItemKey}" is no longer this worker's: its result is not recorded.`,
    );
}

/**
 * Extends a lease that has not ended. False when the claim is gone — taken over, finished, ended
 * indeterminate, or expired — which is the end of this worker's ownership; never a renewal of a
 * lease that already ran out.
 */
export async function renewClaim(
  claim: WorkClaimRef,
  leaseMs = WORK_CLAIM_LEASE_MS,
): Promise<boolean> {
  const rows = await withTenantTransaction((tx) =>
    tx
      .update(runWorkItems)
      .set({ leaseExpiresAt: sql`now() + ${leaseInterval(leaseMs)}`, heartbeatAt: sql`now()` })
      .where(current(claim))
      .returning(),
  );
  return rows.length > 0;
}

/** Marks the item done with what it produced, inside a transaction that admitted the claim. */
export async function completeWorkItem(
  tx: TenantTx,
  claim: WorkClaimRef,
  results: WorkItemResults,
): Promise<boolean> {
  const rows = await tx
    .update(runWorkItems)
    .set({ state: 'done', finishedAt: sql`now()`, results, error: results.failures[0] ?? null })
    .where(current(claim))
    .returning();
  return rows.length > 0;
}

/**
 * Done, with what it produced. Only under the claim that holds it, with its lease left: an item
 * taken back from a worker that then came back to life is the other worker's to finish. False when
 * it was not recorded, which the caller reads as lost ownership.
 */
export async function finishWorkItem(
  claim: WorkClaimRef,
  results: WorkItemResults,
): Promise<boolean> {
  return withTenantTransaction((tx) => completeWorkItem(tx, claim, results));
}

export interface ClaimKeeper {
  /** Aborted, with an OwnershipLostError, when the claim is lost or cannot be confirmed in time. */
  readonly signal: AbortSignal;
  stop(): void;
}

export interface KeepOptions {
  heartbeatMs?: number;
  marginMs?: number;
  now?: () => number;
  renew?: (claim: WorkClaim) => Promise<boolean>;
}

/**
 * Keeps a claim's lease while its work goes on, and gives up before the lease can end unconfirmed.
 *
 * The deadline is local and conservative: from when the last confirmed renewal was *asked for*,
 * by the monotonic clock, plus the lease, less a margin for the time a write takes to reach the
 * database. A renewal that updated no row is the loss of the claim at once. One that failed or
 * did not answer within a heartbeat is not a renewal: the deadline stays where it was, and when it
 * passes the work is stopped and reported indeterminate, before the lease could run out under it.
 */
export function keepClaim(claim: WorkClaim, options: KeepOptions = {}): ClaimKeeper {
  const heartbeatMs = options.heartbeatMs ?? WORK_ITEM_HEARTBEAT_MS;
  const marginMs = options.marginMs ?? WORK_CLAIM_MARGIN_MS;
  const now = options.now ?? (() => performance.now());
  const renew = options.renew ?? ((c: WorkClaim) => renewClaim(c, c.leaseMs));
  const controller = new AbortController();
  let guard: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;

  const lose = (message: string) => {
    if (controller.signal.aborted) return;
    clearInterval(beat);
    clearTimeout(guard);
    controller.abort(new OwnershipLostError(message));
  };
  const armUntil = (deadline: number) => {
    clearTimeout(guard);
    guard = setTimeout(
      () =>
        lose(
          `This worker could not confirm in time that it still holds "${claim.workItemKey}": ` +
            'its work was stopped and its result is indeterminate.',
        ),
      Math.max(0, deadline - now()),
    );
    guard.unref?.();
  };
  const tick = async () => {
    if (inFlight || controller.signal.aborted) return;
    inFlight = true;
    const askedAt = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const renewed = await Promise.race([
        renew(claim),
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), heartbeatMs);
        }),
      ]);
      if (renewed === true) armUntil(askedAt + claim.leaseMs - marginMs);
      else if (renewed === false)
        lose(`The claim on "${claim.workItemKey}" was taken over or ended: this worker stops it.`);
      // 'timeout': not a confirmation; the deadline stands.
    } catch {
      // Not a confirmation either.
    } finally {
      clearTimeout(timer);
      inFlight = false;
    }
  };
  const beat = setInterval(() => void tick(), heartbeatMs);
  beat.unref?.();
  armUntil(claim.askedAt + claim.leaseMs - marginMs);
  return {
    signal: controller.signal,
    stop: () => {
      clearInterval(beat);
      clearTimeout(guard);
    },
  };
}

/** How many items are not over yet: neither done nor ended indeterminate. */
export async function openWorkItems(executionId: string): Promise<number> {
  const [row] = await withTenantTransaction((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(runWorkItems)
      .where(
        and(
          eq(runWorkItems.executionId, executionId),
          notInArray(runWorkItems.state, ['done', 'indeterminate']),
        ),
      ),
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
    tx
      .select({ stopReason: testPlanExecutions.stopReason })
      .from(testPlanExecutions)
      .where(eq(testPlanExecutions.id, executionId))
      .limit(1),
  );
  return row?.stopReason ?? null;
}

/** Asks for helpers: the worker process registers how (server/worker.ts). Without one, the coordinator runs every item itself. */
export type ShardDispatcher = (job: {
  executionId: string;
  planId: string;
  userId: number | null;
  shard: number;
  updateBaselines: boolean;
}) => Promise<void>;

let dispatcher: ShardDispatcher | null = null;

export function registerShardDispatcher(next: ShardDispatcher | null): void {
  dispatcher = next;
}

export function shardDispatcher(): ShardDispatcher | null {
  return dispatcher;
}

export const SHARD_JOB = 'execute-shard';

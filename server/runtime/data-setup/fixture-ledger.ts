/**
 * The data fixture ledger (migration 0119): what a run applied and has not torn down yet.
 *
 * A row is written as soon as a fixture's `apply` has made its data, and settled when the
 * teardown has run (or was kept by policy). A worker that dies in between leaves a `pending`
 * row. That row is how a crashed run is recovered: a person lists the rows and runs the teardown
 * (routes in server/http/routes/data-fixtures.routes.ts), and a sweep does it for the ones that
 * are old enough that nobody is coming back for them.
 *
 * The ledger is a safety net, never a gate: failing to write or settle a row is logged and the run
 * goes on, because a test must not fail for a bookkeeping table.
 */

import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  fixtureLedger,
  type FixtureLedgerRow,
  type FixtureLedgerStatus,
} from '@shared/schema';
import { privilegedDb } from '../../platform/db';
import { ADVISORY_KEYS, withAdvisoryLock } from '../../platform/advisory-lock';
import {
  runAsOrganization,
  runWithTenant,
  withTenantTransaction,
} from '../../platform/middleware/tenancy';
import { recordAudit } from '../../tenancy/audit';
import logger from '../../platform/logger';
import { environmentAllowsDataSetup, resolveVariables } from '../variables';
import { redactMessage } from '../database-step';
import type { AppliedFixture } from './fixture-runner';
import {
  runOneTeardown,
  type TeardownLedger,
  type TeardownOptions,
  type TeardownStatus,
} from './fixture-teardown';

/** A row claimed `running` this long ago belongs to a worker that is gone. */
export const LEDGER_CLAIM_TTL_MS = 10 * 60_000;
/** A `pending` row this old is picked up by the sweep: its run is long over, or dead. */
export const DEFAULT_STALE_MINUTES = 120;

export function staleMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.WFM_FIXTURE_TEARDOWN_STALE_MINUTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_STALE_MINUTES;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_STALE_MINUTES;
}

export interface RunLedgerContext {
  organizationId: number;
  runId: string;
  testId: number | null;
  environmentId: number | null;
}

/** The ledger of one run: written as fixtures apply, settled as they are torn down. */
export interface RunLedger extends TeardownLedger {
  /** Before the apply runs: the row exists as `applying`, so a crash leaves a trace. */
  reserve(applied: AppliedFixture): Promise<void>;
  /** The apply rolled back: there is nothing to take back. */
  abort(applied: AppliedFixture): Promise<void>;
  /** The apply committed: the row is `pending`, with the teardown's final bindings. */
  confirm(applied: AppliedFixture): Promise<void>;
}

const entryOf = (applied: AppliedFixture) => ({
  name: applied.name,
  alias: applied.alias,
  connection: applied.connection,
  timeoutMs: applied.timeoutMs,
  teardown: applied.teardown,
  params: applied.params,
  ...(applied.source ? { source: applied.source } : {}),
});

/** Never throws: see the file's comment. */
export function createRunLedger(context: RunLedgerContext): RunLedger {
  const ids = new Map<AppliedFixture, number>();
  const warn = (what: string, error: unknown) =>
    logger.warn({
      message: `Data fixture ledger: ${what}`,
      runId: context.runId,
      error: error instanceof Error ? error.message : String(error),
    });
  return {
    async reserve(applied) {
      try {
        const id = await runAsOrganization(context.organizationId, () =>
          withTenantTransaction(async (tx) => {
            const [row] = await tx
              .insert(fixtureLedger)
              .values({
                organizationId: context.organizationId,
                runId: context.runId,
                testId: context.testId,
                environmentId: context.environmentId,
                alias: applied.alias,
                name: applied.name,
                policy: applied.policy,
                status: 'applying',
                entry: entryOf(applied),
                bindings: applied.bindings,
              })
              .returning();
            return row.id;
          }),
        );
        ids.set(applied, id);
      } catch (error) {
        warn('could not write the row (the teardown still runs)', error);
      }
    },
    async abort(applied) {
      const id = ids.get(applied);
      if (id === undefined) return;
      ids.delete(applied);
      try {
        await runAsOrganization(context.organizationId, () =>
          withTenantTransaction(async (tx) => {
            await tx.delete(fixtureLedger).where(eq(fixtureLedger.id, id));
          }),
        );
      } catch (error) {
        warn('could not drop the row of an apply that did not commit', error);
      }
    },
    async confirm(applied) {
      const id = ids.get(applied);
      if (id === undefined) return;
      try {
        await runAsOrganization(context.organizationId, () =>
          withTenantTransaction(async (tx) => {
            await tx
              .update(fixtureLedger)
              .set({ status: 'pending', entry: entryOf(applied), bindings: applied.bindings })
              .where(eq(fixtureLedger.id, id));
          }),
        );
      } catch (error) {
        warn('could not confirm the row', error);
      }
    },
    async settle(applied, status, detail) {
      const id = ids.get(applied);
      if (id === undefined) return;
      try {
        await runAsOrganization(context.organizationId, () =>
          withTenantTransaction(async (tx) => {
            await tx
              .update(fixtureLedger)
              .set({
                status,
                detail: detail.slice(0, 2000),
                settledAt: new Date(),
                attempts: sql`${fixtureLedger.attempts} + 1`,
              })
              .where(eq(fixtureLedger.id, id));
            if (status === 'failed')
              await recordAudit(tx, {
                action: AUDIT_ACTIONS.DATA_FIXTURE_TEARDOWN_FAILED,
                targetType: 'data_fixture',
                targetId: id,
                metadata: {
                  runId: context.runId,
                  testId: context.testId,
                  fixture: applied.name,
                  alias: applied.alias,
                  reason: detail.slice(0, 500),
                },
              });
          }),
        );
      } catch (error) {
        warn('could not settle the row', error);
      }
    },
  };
}

export async function listLedger(
  organizationId: number,
  filter: { status?: FixtureLedgerStatus[]; limit?: number } = {},
): Promise<FixtureLedgerRow[]> {
  return runAsOrganization(organizationId, () =>
    withTenantTransaction((tx) =>
      tx
        .select()
        .from(fixtureLedger)
        .where(filter.status?.length ? inArray(fixtureLedger.status, filter.status) : undefined)
        .orderBy(desc(fixtureLedger.appliedAt))
        .limit(Math.min(filter.limit ?? 100, 500)),
    ),
  );
}

export type RetryOutcome =
  | { outcome: 'not-found' }
  | { outcome: 'not-claimable'; status: string }
  | { outcome: 'done' | 'failed'; detail: string };

export interface RetryOptions extends Pick<TeardownOptions, 'openSession' | 'vet'> {
  /** Who asked, for the audit entry; null for the sweep. */
  actor?: Parameters<typeof recordAudit>[1]['actor'];
  /** Whose secrets the environment's variables are resolved for. */
  userId: number;
  now?: Date;
}

/** Turns a row back into what the teardown runner takes. The policy was decided by the run. */
export function ledgerRowToApplied(row: FixtureLedgerRow): AppliedFixture {
  return {
    id: `ledger-${row.id}`,
    name: row.entry.name,
    alias: row.entry.alias,
    connection: row.entry.connection,
    timeoutMs: row.entry.timeoutMs,
    teardown: row.entry.teardown,
    policy: 'always',
    params: row.entry.params,
    bindings: row.bindings,
    ...(row.entry.source ? { source: row.entry.source } : {}),
  };
}

/**
 * Runs the pending teardown of one row, on the environment it was applied to. The row is claimed
 * first (one atomic update), so a person and the sweep, or two people, never run it twice.
 */
export async function retryLedgerRow(
  organizationId: number,
  id: number,
  options: RetryOptions,
): Promise<RetryOutcome> {
  const now = options.now ?? new Date();
  const claimed = await runAsOrganization(organizationId, () =>
    withTenantTransaction(async (tx) => {
      const [row] = await tx
        .update(fixtureLedger)
        .set({ status: 'running', claimedAt: now, attempts: sql`${fixtureLedger.attempts} + 1` })
        .where(
          and(
            eq(fixtureLedger.id, id),
            or(
              inArray(fixtureLedger.status, ['pending', 'failed']),
              // An apply that never confirmed: its worker died, or is still going (give it time).
              and(
                eq(fixtureLedger.status, 'applying'),
                lt(fixtureLedger.appliedAt, new Date(now.getTime() - LEDGER_CLAIM_TTL_MS)),
              ),
              and(
                eq(fixtureLedger.status, 'running'),
                lt(fixtureLedger.claimedAt, new Date(now.getTime() - LEDGER_CLAIM_TTL_MS)),
              ),
            ),
          ),
        )
        .returning();
      if (row) return { row };
      const [existing] = await tx
        .select({ status: fixtureLedger.status })
        .from(fixtureLedger)
        .where(eq(fixtureLedger.id, id));
      return { existing };
    }),
  );
  if (!claimed.row)
    return claimed.existing
      ? { outcome: 'not-claimable', status: claimed.existing.status }
      : { outcome: 'not-found' };
  const row = claimed.row;

  let status: Extract<TeardownStatus, 'done' | 'failed'>;
  let detail: string;
  try {
    if (!row.environmentId)
      throw new Error(
        'the environment it was applied to has been deleted; remove the data by hand',
      );
    if (!(await environmentAllowsDataSetup(organizationId, row.environmentId)))
      throw new Error(
        'the environment no longer allows data setup (turn it on to remove the data)',
      );
    const vars = await resolveVariables({
      userId: options.userId,
      organizationId,
      environmentId: row.environmentId,
    });
    detail = await runOneTeardown(ledgerRowToApplied(row), vars, options, new Set());
    status = 'done';
  } catch (error) {
    status = 'failed';
    detail = redactMessage(error instanceof Error ? error.message : String(error), '');
  }

  await runAsOrganization(organizationId, () =>
    withTenantTransaction(async (tx) => {
      await tx
        .update(fixtureLedger)
        .set({ status, detail: detail.slice(0, 2000), settledAt: new Date() })
        .where(eq(fixtureLedger.id, id));
      await recordAudit(tx, {
        ...(options.actor ? { actor: options.actor } : {}),
        action:
          status === 'failed'
            ? AUDIT_ACTIONS.DATA_FIXTURE_TEARDOWN_FAILED
            : AUDIT_ACTIONS.DATA_FIXTURE_TEARDOWN_RETRIED,
        targetType: 'data_fixture',
        targetId: id,
        metadata: {
          runId: row.runId,
          fixture: row.name,
          alias: row.alias,
          result: status,
          reason: status === 'failed' ? detail.slice(0, 500) : undefined,
        },
      });
    }),
  );
  return { outcome: status, detail };
}

export interface SweepReport {
  retried: number;
  kept: number;
  failed: number;
}

/**
 * Handles the `pending` rows no run is coming back for. Only `always` rows are run: for the
 * other policies the outcome of the crashed test is unknown, so they are kept, and say why.
 * A `failed` row is never retried here (it failed once for a reason a person should read).
 */
export async function sweepStaleTeardowns(
  options: Pick<TeardownOptions, 'openSession' | 'vet'> & {
    now?: Date;
    minutes?: number;
    batch?: number;
  } = {},
): Promise<SweepReport> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - (options.minutes ?? staleMinutes()) * 60_000);
  const report: SweepReport = { retried: 0, kept: 0, failed: 0 };
  const stale = await privilegedDb
    .select({
      id: fixtureLedger.id,
      organizationId: fixtureLedger.organizationId,
      policy: fixtureLedger.policy,
    })
    .from(fixtureLedger)
    .where(
      or(
        and(
          inArray(fixtureLedger.status, ['pending', 'applying']),
          lt(fixtureLedger.appliedAt, cutoff),
        ),
        and(
          eq(fixtureLedger.status, 'running'),
          lt(fixtureLedger.claimedAt, new Date(now.getTime() - LEDGER_CLAIM_TTL_MS)),
        ),
      ),
    )
    .limit(options.batch ?? 100);
  for (const item of stale) {
    try {
      if (item.policy !== 'always') {
        await runWithTenant(item.organizationId, () =>
          withTenantTransaction(async (tx) => {
            await tx
              .update(fixtureLedger)
              .set({
                status: 'kept',
                settledAt: now,
                detail:
                  'the run ended without a recorded outcome, so the data was kept as the policy asks; run it from the ledger if it should go',
              })
              .where(eq(fixtureLedger.id, item.id));
          }),
        );
        report.kept += 1;
        continue;
      }
      // The sweep has no user: the environment's secrets are the organization's, read as its owner
      // would. userId 0 reaches nothing user-specific.
      const result = await retryLedgerRow(item.organizationId, item.id, {
        ...options,
        userId: 0,
        now,
      });
      if (result.outcome === 'done') report.retried += 1;
      else if (result.outcome === 'failed') report.failed += 1;
    } catch (error) {
      report.failed += 1;
      logger.warn({
        message: 'Fixture teardown sweep: a row could not be handled',
        ledgerId: item.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}

/** Sweeps every intervalMs until stopped. Started by the web server, like the other sweeps. */
export function startFixtureTeardownSweep(intervalMs = 15 * 60_000): () => void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      const locked = await withAdvisoryLock(ADVISORY_KEYS.fixtureTeardownSweep, () =>
        sweepStaleTeardowns(),
      );
      if (!locked.ran) return;
      const report = locked.value;
      if (report.retried + report.kept + report.failed > 0)
        logger.info({ message: 'Fixture teardown sweep', ...report });
    } catch (error) {
      logger.error({
        message: 'The fixture teardown sweep failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void sweep(), 3 * 60_000);
  const timer = setInterval(() => void sweep(), intervalMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

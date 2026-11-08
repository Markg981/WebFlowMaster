import { sql } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import logger from '../platform/logger';
import { ADVISORY_KEYS, withAdvisoryLock } from '../platform/advisory-lock';

/**
 * Optional retention for the database rows that artifact retention does not touch (audit A-10).
 *
 * The audit-row and evidence knobs are off unless set (the IP knob defaults to 90 days): unset, empty, 0 or negative keeps the rows for ever, which is
 * what the installation did before. The retention window is a policy decision of the operator
 * (GDPR, contracts), so there is no default.
 *
 * - AUDIT_LOG_RETENTION_DAYS: deletes audit_log entries older than that. The table is append-only
 *   for app_user (SELECT and INSERT only) and a trigger refuses UPDATE/DELETE for everyone unless the
 *   transaction sets app.audit_maintenance; like organization erasure, this runs on the privileged
 *   connection, which owns the table. The application itself still cannot alter or delete entries.
 * - EVIDENCE_RETENTION_DAYS: clears the `evidence` document (stored paths of screenshots, traces,
 *   HAR) and the failure reason of unit attempts that finished earlier than that. The attempt row
 *   and its verdict stay, so history and analytics do not change.
 *
 * Backups are not reached by either: how long they live is the operator's responsibility.
 */

function days(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export const auditLogRetentionDays = (env: NodeJS.ProcessEnv = process.env) =>
  days(env.AUDIT_LOG_RETENTION_DAYS);
/**
 * AUDIT_LOG_IP_RETENTION_DAYS: after that many days the sweep nulls ip_address on older audit
 * entries (the entry itself stays). Default 90; 0 keeps addresses as long as the row (audit M-12).
 */
export const DEFAULT_AUDIT_IP_RETENTION_DAYS = 90;
export const auditIpRetentionDays = (env: NodeJS.ProcessEnv = process.env) => {
  const raw = env.AUDIT_LOG_IP_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_AUDIT_IP_RETENTION_DAYS;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
};
export const evidenceRetentionDays = (env: NodeJS.ProcessEnv = process.env) =>
  days(env.EVIDENCE_RETENTION_DAYS);

export interface DataRetentionReport {
  auditEntriesDeleted: number;
  auditIpsCleared: number;
  evidenceCleared: number;
}

/** Rows per statement, pause between batches and total time per sweep (audit M-10). */
export const BATCH_SIZE = 1000;
const BATCH_PAUSE_MS = 50;
const SWEEP_BUDGET_MS = 5 * 60_000;

const affected = (result: unknown) => {
  const r = result as { rowCount?: number | null; affectedRows?: number | null };
  return r.rowCount ?? r.affectedRows ?? 0;
};

export async function purgeExpiredRows(
  options: {
    now?: Date;
    auditDays?: number;
    auditIpDays?: number;
    evidenceDays?: number;
    batchSize?: number;
    pauseMs?: number;
    budgetMs?: number;
  } = {},
): Promise<DataRetentionReport> {
  const now = options.now ?? new Date();
  const auditDays = options.auditDays ?? auditLogRetentionDays();
  const auditIpDays = options.auditIpDays ?? auditIpRetentionDays();
  const evidenceDays = options.evidenceDays ?? evidenceRetentionDays();
  const batch = options.batchSize ?? BATCH_SIZE;
  const pause = options.pauseMs ?? BATCH_PAUSE_MS;
  const deadline = Date.now() + (options.budgetMs ?? SWEEP_BUDGET_MS);
  const report: DataRetentionReport = {
    auditEntriesDeleted: 0,
    auditIpsCleared: 0,
    evidenceCleared: 0,
  };
  const cutoff = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  /** Runs one bounded statement per round until it touches less than a batch or the budget is spent. */
  const inBatches = async (run: () => Promise<number>): Promise<number> => {
    let total = 0;
    while (Date.now() < deadline) {
      const n = await run();
      total += n;
      if (n < batch) break;
      if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
    }
    return total;
  };
  // The audit_log trigger (migration 0102) refuses UPDATE/DELETE unless the transaction opts in.
  const audit = (statement: ReturnType<typeof sql>) =>
    privilegedDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.audit_maintenance', 'on', true)`);
      return affected(await tx.execute(statement));
    });

  if (auditDays > 0) {
    const at = cutoff(auditDays);
    report.auditEntriesDeleted = await inBatches(() =>
      audit(sql`
        DELETE FROM audit_log WHERE id IN (
          SELECT id FROM audit_log WHERE created_at < ${at} ORDER BY id LIMIT ${batch})
      `),
    );
  }
  if (auditIpDays > 0) {
    const at = cutoff(auditIpDays);
    report.auditIpsCleared = await inBatches(() =>
      audit(sql`
        UPDATE audit_log SET ip_address = NULL WHERE id IN (
          SELECT id FROM audit_log
          WHERE created_at < ${at} AND ip_address IS NOT NULL ORDER BY id LIMIT ${batch})
      `),
    );
  }
  if (evidenceDays > 0) {
    const at = cutoff(evidenceDays);
    report.evidenceCleared = await inBatches(async () =>
      affected(
        await privilegedDb.execute(sql`
          UPDATE execution_unit_attempts SET evidence = NULL, failure_reason = NULL
          WHERE ctid IN (
            SELECT ctid FROM execution_unit_attempts
            WHERE finished_at < ${at} AND (evidence IS NOT NULL OR failure_reason IS NOT NULL)
            LIMIT ${batch})
        `),
      ),
    );
  }
  return report;
}

/** One sweep under the cross-replica lock: only one process runs it; the others skip. */
export async function runRetentionSweep(
  options: Parameters<typeof purgeExpiredRows>[0] = {},
): Promise<DataRetentionReport | undefined> {
  const result = await withAdvisoryLock(ADVISORY_KEYS.dataRetention, () =>
    purgeExpiredRows(options),
  );
  if (!result.ran) return undefined;
  const r = result.value;
  if (r.auditEntriesDeleted || r.auditIpsCleared || r.evidenceCleared) {
    logger.info({
      message: 'Data retention',
      audit_log_deleted: r.auditEntriesDeleted,
      audit_log_ip_cleared: r.auditIpsCleared,
      execution_unit_attempts_cleared: r.evidenceCleared,
    });
  }
  return r;
}

/** Sweeps every intervalMs until stopped. Does nothing at all while both knobs are unset. */
export function startDataRetention(intervalMs = 6 * 60 * 60_000): () => void {
  if (auditLogRetentionDays() <= 0 && auditIpRetentionDays() <= 0 && evidenceRetentionDays() <= 0)
    return () => {};
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      await runRetentionSweep();
    } catch (error) {
      logger.error({
        message: 'Data retention sweep failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void sweep(), intervalMs);
  timer.unref?.();
  void sweep();
  return () => clearInterval(timer);
}

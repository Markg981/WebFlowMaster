import { sql } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import logger from '../platform/logger';

/**
 * Optional retention for the database rows that artifact retention does not touch (audit A-10).
 *
 * Both knobs are off unless set: unset, empty, 0 or negative keeps the rows for ever, which is
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
export const evidenceRetentionDays = (env: NodeJS.ProcessEnv = process.env) =>
  days(env.EVIDENCE_RETENTION_DAYS);

export interface DataRetentionReport {
  auditEntriesDeleted: number;
  evidenceCleared: number;
}

const affected = (result: unknown) => {
  const r = result as { rowCount?: number | null; affectedRows?: number | null };
  return r.rowCount ?? r.affectedRows ?? 0;
};

export async function purgeExpiredRows(
  options: { now?: Date; auditDays?: number; evidenceDays?: number } = {},
): Promise<DataRetentionReport> {
  const now = options.now ?? new Date();
  const auditDays = options.auditDays ?? auditLogRetentionDays();
  const evidenceDays = options.evidenceDays ?? evidenceRetentionDays();
  const report: DataRetentionReport = { auditEntriesDeleted: 0, evidenceCleared: 0 };
  const cutoff = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  if (auditDays > 0) {
    // The audit_log trigger (migration 0102) refuses DELETE unless this transaction opts in.
    report.auditEntriesDeleted = await privilegedDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.audit_maintenance', 'on', true)`);
      return affected(
        await tx.execute(sql`DELETE FROM audit_log WHERE created_at < ${cutoff(auditDays)}`),
      );
    });
  }
  if (evidenceDays > 0) {
    report.evidenceCleared = affected(
      await privilegedDb.execute(sql`
        UPDATE execution_unit_attempts SET evidence = NULL, failure_reason = NULL
        WHERE finished_at < ${cutoff(evidenceDays)}
          AND (evidence IS NOT NULL OR failure_reason IS NOT NULL)
      `),
    );
  }
  return report;
}

/** Sweeps every intervalMs until stopped. Does nothing at all while both knobs are unset. */
export function startDataRetention(intervalMs = 6 * 60 * 60_000): () => void {
  if (auditLogRetentionDays() <= 0 && evidenceRetentionDays() <= 0) return () => {};
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      const report = await purgeExpiredRows();
      if (report.auditEntriesDeleted > 0 || report.evidenceCleared > 0) {
        logger.info({ message: 'Data retention', ...report });
      }
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

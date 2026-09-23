import { and, asc, inArray, isNull, lt, eq } from 'drizzle-orm';
import { testPlanExecutions } from '@shared/schema';
import { privilegedDb } from './db';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { artifactStore, RESULTS_PREFIX, type ArtifactStore } from './artifact-store';
import loggerPromise from './logger';

/**
 * Removes the evidence of runs that ended long enough ago.
 *
 * Every screenshot, video and trace a run kept stayed for good, on disk or in the bucket, and
 * the space grew with every run — a plan with video on, nightly on three browsers, is gigabytes
 * a month. Runs older than ARTIFACT_RETENTION_DAYS now lose their files. Their results, steps
 * and verdicts stay: history and analytics do not change, and the report says the pictures were
 * removed and when, rather than showing broken images.
 *
 * Visual baselines are never touched: they are what the next run is compared against, not the
 * record of one that happened.
 */

/** 0 (or a negative number) keeps evidence for ever. */
export function retentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ARTIFACT_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === '') return 90;
  const days = Number(raw);
  return Number.isFinite(days) ? days : 90;
}

const TERMINAL = ['completed', 'failed', 'error', 'cancelled', 'timed_out'];

export interface RetentionOptions {
  now?: Date;
  days?: number;
  store?: ArtifactStore;
  /** How many runs one sweep handles, so a first sweep over years of runs does not run for hours. */
  batchSize?: number;
}

export interface RetentionReport {
  purgedRuns: number;
  removedFiles: number;
  failed: string[];
}

export async function purgeExpiredArtifacts(options: RetentionOptions = {}): Promise<RetentionReport> {
  const days = options.days ?? retentionDays();
  const report: RetentionReport = { purgedRuns: 0, removedFiles: 0, failed: [] };
  if (days <= 0) return report;

  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const store = options.store ?? artifactStore();

  // Across every organization: retention is not a request and has no tenant. It only finds the
  // runs; each is marked inside its own organization's context.
  const expired = await privilegedDb
    .select({ id: testPlanExecutions.id, organizationId: testPlanExecutions.organizationId, testPlanId: testPlanExecutions.testPlanId })
    .from(testPlanExecutions)
    .where(and(
      isNull(testPlanExecutions.artifactsPurgedAt),
      inArray(testPlanExecutions.status, TERMINAL),
      lt(testPlanExecutions.completedAt, cutoff),
    ))
    .orderBy(asc(testPlanExecutions.completedAt))
    .limit(options.batchSize ?? 500);

  for (const run of expired) {
    try {
      report.removedFiles += await store.deletePrefix(`${RESULTS_PREFIX}${run.testPlanId}/${run.id}/`);
      // Marked only once its files are gone: a run whose removal failed is tried again next time.
      await runWithTenant(run.organizationId, () =>
        withTenantTransaction((tx) =>
          tx
            .update(testPlanExecutions)
            .set({ artifactsPurgedAt: now })
            .where(eq(testPlanExecutions.id, run.id))
            .returning(),
        ),
      );
      report.purgedRuns += 1;
    } catch {
      report.failed.push(run.id);
    }
  }
  return report;
}

/** Sweeps every intervalMs until stopped. Started by the web server. */
export function startArtifactRetention(intervalMs = 6 * 60 * 60_000): () => void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    const logger = await loggerPromise;
    try {
      const report = await purgeExpiredArtifacts();
      if (report.purgedRuns > 0 || report.failed.length > 0) {
        logger.info({ message: 'Artifact retention', days: retentionDays(), ...report });
      }
    } catch (error: any) {
      logger.error({ message: 'The artifact retention sweep failed', error: error?.message });
    } finally {
      running = false;
    }
  };
  // Soon after start, so a server restarted daily still sweeps, then on the interval.
  const first = setTimeout(() => void sweep(), 5 * 60_000);
  const timer = setInterval(() => void sweep(), intervalMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

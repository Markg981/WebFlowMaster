import { inArray } from 'drizzle-orm';
import { comparisonRuns, type TestPlanExecution } from '@shared/schema';
import { privilegedDb } from '../platform/db';
import logger from '../platform/logger';
import { ADVISORY_KEYS, withAdvisoryLock } from '../platform/advisory-lock';
import { runDetachedForOrganization } from '../platform/middleware/tenancy';
import { isTerminalExecutionStatus, onExecutionTransition } from './execution-state';
import { readExecutionSnapshot } from './execution-snapshot';
import type { ComparisonOrchestrator } from './comparison-orchestrator';

/**
 * What moves a comparison forward once it has started: the end of one of its runs, and a sweep
 * for whatever that missed (a process that stopped between the run ending and the comparison
 * hearing about it, a candidate deferred by a full queue, a computation that died).
 */

type Advancer = Pick<ComparisonOrchestrator, 'advance'>;

function advanceLogged(orchestrator: Advancer, organizationId: number, comparisonId: string) {
  // Its own context: a listener is told after the run's transaction, and must not join another.
  return runDetachedForOrganization(organizationId, () => orchestrator.advance(comparisonId)).catch(
    (error: unknown) => {
      logger.warn({
        message: 'A comparison could not be advanced',
        comparisonId,
        error: (error as Error)?.message ?? String(error),
      });
      return null;
    },
  );
}

/** The comparison a run belongs to, when it has ended. */
export function comparisonOfEndedRun(execution: TestPlanExecution): string | null {
  if (!isTerminalExecutionStatus(execution.status)) return null;
  return readExecutionSnapshot(execution.configurationSnapshot)?.comparison?.id ?? null;
}

/** Advances a comparison when one of its runs ends. Returns the function that unregisters it. */
export function registerComparisonFinalizer(orchestrator: Advancer): () => void {
  return onExecutionTransition(async (execution) => {
    const comparisonId = comparisonOfEndedRun(execution);
    if (comparisonId) await advanceLogged(orchestrator, execution.organizationId, comparisonId);
  });
}

/** One pass of the sweep: advances every comparison that has not ended, in every organization. */
export async function sweepComparisons(orchestrator: Advancer): Promise<number> {
  // Not a request and no tenant: it only finds them; each is advanced under its own organization.
  const open = await privilegedDb
    .select({ id: comparisonRuns.id, organizationId: comparisonRuns.organizationId })
    .from(comparisonRuns)
    .where(inArray(comparisonRuns.status, ['queued', 'running', 'comparing']))
    .limit(500);
  for (const comparison of open) {
    await advanceLogged(orchestrator, comparison.organizationId, comparison.id);
  }
  return open.length;
}

/** Sweeps every intervalMs until stopped; one process at a time does it. */
export function startComparisonSweep(orchestrator: Advancer, intervalMs = 60_000): () => void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      await withAdvisoryLock(ADVISORY_KEYS.comparisonSweep, () => sweepComparisons(orchestrator));
    } catch (error) {
      logger.error({
        message: 'The comparison sweep failed',
        error: (error as Error)?.message ?? String(error),
      });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void sweep(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

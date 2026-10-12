/**
 * Runs a run's lanes: one at a time, side by side, or shared with other workers
 * (server/runtime/run-shards.ts).
 */
import { effectiveConcurrency, runWithConcurrency } from '../../concurrency';
import {
  claimWorkItem,
  finishWorkItem,
  heartbeatWorkItems,
  openWorkItems,
  shardCount,
  shardDispatcher,
  sharedStopReason,
  workItemResults,
  workerName,
  writeWorkItems,
  WORK_ITEM_HEARTBEAT_MS,
  WORK_POLL_MS,
  type WorkUnit,
} from '../../runtime/run-shards';
import type { IndividualTestRunResult } from '../run-test';
import { emit, report, type PlanRun } from './context';
import { lanesAreChained, type Lane, type RunUnit } from './lanes';
import { runUnit, type UnitScope } from './run-unit';

export interface LaneResults {
  /** The legacy results list the execution row still carries. */
  legacy: IndividualTestRunResult[];
  /** Units that threw: something ran, and it was not the test. */
  unitFailures: string[];
}

export async function executeLanes(scope: UnitScope, lanes: Lane[]): Promise<LaneResults> {
  const { run } = scope;
  const legacy: IndividualTestRunResult[] = [];
  const unitFailures: string[] = [];
  const chained = lanesAreChained(scope.tests.api.values());

  const parallelism = effectiveConcurrency(scope.inputs.snapshot.maxParallelTests);
  if (parallelism > 1) {
    emit(run, {
      level: 'info',
      message: chained
        ? `Running up to ${parallelism} browsers at once. This plan's API tests capture values for later ` +
          `requests, so within each browser its tests stay in order.`
        : `Running up to ${parallelism} tests at once.`,
      metadata: { parallelism, chained },
    });
  }

  /** Surfaced like a browser that would not start: something ran, and it was not the test. */
  const recordSettled = (settled: PromiseSettledResult<void>[], into: string[] = unitFailures) => {
    for (const outcome of settled) {
      if (outcome.status !== 'rejected') continue;
      const message = `A test in this run could not be executed: ${
        (outcome.reason as Error)?.message ?? String(outcome.reason)
      }`;
      into.push(message);
      report(run, { level: 'error', message });
    }
  };
  const runOne = (unit: RunUnit, captured: Record<string, string>) =>
    runUnit(scope, unit, captured, legacy);

  const shards = shardCount(scope.inputs.snapshot.shards);
  run.stop.shared = !!run.helper || shards > 1;
  run.quiet = false;

  try {
    if (run.stop.shared) {
      await runShared(scope, lanes, { chained, parallelism, shards, recordSettled });
    } else if (parallelism <= 1) {
      // The order every plan has always run in: one browser at a time, its tests in sequence.
      for (const lane of lanes) {
        for (const unit of lane.units) {
          try {
            await runOne(unit, lane.captured);
          } catch (error: unknown) {
            recordSettled([{ status: 'rejected', reason: error }]);
          }
        }
      }
    } else if (chained) {
      // Browsers side by side; within each one, the flow keeps its order.
      recordSettled(
        await runWithConcurrency(
          parallelism,
          lanes.map((lane) => async () => {
            for (const unit of lane.units) await runOne(unit, lane.captured);
          }),
        ),
      );
    } else {
      recordSettled(
        await runWithConcurrency(
          parallelism,
          lanes.flatMap((lane) => lane.units.map((unit) => () => runOne(unit, lane.captured))),
        ),
      );
    }
  } finally {
    // The browser the API requests went through goes back to the agent.
    await scope.agentHttp?.close();
  }

  return { legacy, unitFailures };
}

/** The coordinator of a shared run adds what every worker's items recorded. */
export async function collectSharedResults(run: PlanRun, results: LaneResults): Promise<void> {
  if (!run.stop.shared) return;
  const shared = await workItemResults(run.executionId);
  results.legacy.push(...(shared.legacy as IndividualTestRunResult[]));
  results.unitFailures.push(...shared.failures);
}

/**
 * Shares the run's work with other workers (server/runtime/run-shards.ts): the coordinator writes it
 * down and asks for helpers; then everyone, the coordinator included, takes items until none
 * are left. The coordinator also waits for the items others hold, and takes back any whose
 * worker stopped answering.
 */
async function runShared(
  scope: UnitScope,
  lanes: Lane[],
  options: {
    chained: boolean;
    parallelism: number;
    shards: number;
    recordSettled: (settled: PromiseSettledResult<void>[], into?: string[]) => void;
  },
): Promise<void> {
  const { run } = scope;
  const { chained, parallelism, shards, recordSettled } = options;
  const links = scope.tests.links;
  const worker = workerName();
  if (!run.helper) {
    const spec = (unit: RunUnit) => ({
      link: links.indexOf(unit.link),
      browserChoice: unit.browserChoice,
      locale: unit.locale,
      bddRowIndex: unit.bddRowIndex,
      mobileTarget: unit.mobileTarget,
    });
    const items: Array<{ key: string; unit: WorkUnit }> = chained
      ? lanes.map((lane, i) => ({
          key: `lane-${i}`,
          unit: { units: lane.units.map(spec), captured: lane.captured },
        }))
      : lanes.flatMap((lane, i) =>
          lane.units.map((unit, j) => ({
            key: `${i}-${j}`,
            unit: { units: [spec(unit)], captured: lane.captured },
          })),
        );
    await writeWorkItems(run.executionId, scope.inputs.organizationId, items);
    const dispatch = shardDispatcher();
    const helpers = Math.min(shards - 1, Math.max(0, items.length - 1));
    let asked = 0;
    for (let shard = 1; dispatch && shard <= helpers; shard++) {
      await dispatch({
        executionId: run.executionId,
        planId: run.planId,
        userId: run.userId,
        shard,
        updateBaselines: scope.settings.visual.updateBaselines,
      })
        .then(() => asked++)
        .catch((error: unknown) =>
          run.logger.warn({
            message: 'Could not queue a helper for a shared run',
            testPlanRunId: run.executionId,
            shard,
            error: (error as Error)?.message,
          }),
        );
    }
    emit(run, {
      level: asked > 0 || helpers === 0 ? 'info' : 'warn',
      message:
        asked > 0
          ? `Sharing this run with up to ${asked} more worker(s): ${items.length} piece(s) of work, taken one at a time by whichever worker is free.`
          : helpers === 0
            ? 'This run has one piece of work; it runs on this worker.'
            : `This plan asks for ${shards} workers, but no other could be asked: this worker runs every test.`,
      metadata: { shards, helpers: asked, items: items.length },
    });
  }
  const beat = setInterval(
    () => heartbeatWorkItems(run.executionId, worker).catch(() => undefined),
    WORK_ITEM_HEARTBEAT_MS,
  );
  try {
    const takeItems = async () => {
      for (;;) {
        if (run.watch.cause === 'lost') return;
        const item = await claimWorkItem(run.executionId, worker);
        if (!item) {
          // A helper is done when nothing is left to take; the coordinator, when nothing is left at all.
          if (run.helper || (await openWorkItems(run.executionId)) === 0) return;
          await new Promise((resolve) => setTimeout(resolve, WORK_POLL_MS));
          continue;
        }
        if (!run.stop.reason) run.stop.reason = await sharedStopReason(run.executionId);
        // Where its entry of the legacy results list goes: a shared run keeps them with each work item.
        const legacy: IndividualTestRunResult[] = [];
        const failures: string[] = [];
        const captured = { ...item.unit.captured };
        for (const spec of item.unit.units) {
          const link = links[spec.link];
          if (!link) continue;
          try {
            await runUnit(
              scope,
              {
                browserChoice: spec.browserChoice,
                locale: spec.locale,
                link,
                bddRowIndex: spec.bddRowIndex,
                mobileTarget: spec.mobileTarget,
              },
              captured,
              legacy,
            );
          } catch (error: unknown) {
            recordSettled([{ status: 'rejected', reason: error }], failures);
          }
        }
        await finishWorkItem(run.executionId, item.key, worker, { legacy, failures });
      }
    };
    recordSettled(
      await runWithConcurrency(
        parallelism,
        Array.from({ length: parallelism }, () => takeItems),
      ),
    );
  } finally {
    clearInterval(beat);
  }
}

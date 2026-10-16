/**
 * Runs a run's lanes: one at a time, side by side, or shared with other workers
 * (server/runtime/run-shards.ts).
 */
import { effectiveConcurrency, runWithConcurrency } from '../../platform/concurrency';
import {
  claimWorkItem,
  completeWorkItem,
  finishWorkItem,
  keepClaim,
  openWorkItems,
  shardCount,
  shardDispatcher,
  sharedStopReason,
  workItemResults,
  workerName,
  writeWorkItems,
  WORK_POLL_MS,
  type WorkUnit,
} from '../../runtime/run-shards';
import { claimFence, OwnershipLostError, runFence } from './fence';
import type { IndividualTestRunResult } from '../run-test';
import { emit, report, type PlanRun } from './context';
import { lanesAreChained, type Lane, type RunUnit } from './lanes';
import { ReportEntryNotSavedError } from './report-entry';
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

  /**
   * Surfaced like a browser that would not start: something ran, and it was not the test — or
   * the test ran and its result could not be recorded, which the run cannot count either.
   */
  const recordSettled = (settled: PromiseSettledResult<void>[], into: string[] = unitFailures) => {
    for (const outcome of settled) {
      if (outcome.status !== 'rejected') continue;
      const message =
        outcome.reason instanceof ReportEntryNotSavedError ||
        outcome.reason instanceof OwnershipLostError
          ? outcome.reason.message
          : `A test in this run could not be executed: ${
              (outcome.reason as Error)?.message ?? String(outcome.reason)
            }`;
      into.push(message);
      report(run, { level: 'error', message });
    }
  };
  // A result that could not be recorded is the end of that unit only: the lane goes on.
  const runOne = (unit: RunUnit, captured: Record<string, string>) =>
    runUnit(scope, unit, captured, legacy).catch((error: unknown) => {
      if (!(error instanceof ReportEntryNotSavedError)) throw error;
      recordSettled([{ status: 'rejected', reason: error }]);
    });

  const shards = shardCount(scope.inputs.snapshot.shards);
  run.stop.shared = !!run.helper || shards > 1;
  run.quiet = false;
  // One worker's run: its writes are admitted while the run is live. A shared run's units each
  // take the fence of the claim they run under instead.
  if (!run.stop.shared) scope = { ...scope, fence: scope.fence ?? runFence(run.executionId) };

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
      unitId: unit.unitId,
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
  const policy = scope.inputs.snapshot.workerLossPolicy ?? 'indeterminate';
  const takeItems = async () => {
    for (;;) {
      if (run.watch.cause === 'lost') return;
      const claim = await claimWorkItem(run.executionId, worker, { policy });
      if (!claim) {
        // A helper is done when nothing is left to take; the coordinator, when nothing is left at all.
        if (run.helper || (await openWorkItems(run.executionId)) === 0) return;
        await new Promise((resolve) => setTimeout(resolve, WORK_POLL_MS));
        continue;
      }
      if (!run.stop.reason) run.stop.reason = await sharedStopReason(run.executionId);
      // The lease is kept while the item runs; once it cannot be, the item's work stops.
      const keeper = keepClaim(claim);
      const itemScope: UnitScope = { ...scope, fence: claimFence(claim, keeper.signal) };
      // Where its entry of the legacy results list goes: a shared run keeps them with each work item.
      const legacy: IndividualTestRunResult[] = [];
      const failures: string[] = [];
      const captured = { ...claim.unit.captured };
      const specs = claim.unit.units;
      let completed = false;
      let lost: OwnershipLostError | null = null;
      try {
        for (const [index, spec] of specs.entries()) {
          const link = links[spec.link];
          if (!link) continue;
          // The item's last unit completes the claim in the transaction that admits its result.
          // An earlier unit of a chained lane keeps its admitted result, and the item stays open.
          let completing = false;
          const onAdmitted =
            index === specs.length - 1
              ? async (tx: Parameters<typeof completeWorkItem>[0]) => {
                  completing = await completeWorkItem(tx, claim, { legacy, failures });
                }
              : undefined;
          try {
            await runUnit(
              itemScope,
              {
                browserChoice: spec.browserChoice,
                locale: spec.locale,
                link,
                bddRowIndex: spec.bddRowIndex,
                mobileTarget: spec.mobileTarget,
                unitId: spec.unitId,
              },
              captured,
              legacy,
              { onAdmitted },
            );
            completed = completing;
          } catch (error: unknown) {
            if (error instanceof OwnershipLostError || keeper.signal.aborted) {
              lost =
                error instanceof OwnershipLostError
                  ? error
                  : (keeper.signal.reason as OwnershipLostError);
              break;
            }
            recordSettled([{ status: 'rejected', reason: error }], failures);
          }
        }
        if (!lost && !completed && !(await finishWorkItem(claim, { legacy, failures })))
          lost = new OwnershipLostError(
            `The claim on "${claim.workItemKey}" ended before its results could be recorded.`,
          );
      } finally {
        keeper.stop();
      }
      if (lost)
        // Nothing more of it is this worker's to write. What its units did to the application
        // may have happened; the item ends indeterminate when its lease runs out, unless the
        // plan's worker-loss policy lets another worker run it again.
        report(run, {
          level: 'warn',
          message: `${lost.message} Its result is indeterminate.`,
          metadata: { workItem: claim.workItemKey, epoch: claim.epoch },
        });
    }
  };
  recordSettled(
    await runWithConcurrency(
      parallelism,
      Array.from({ length: parallelism }, () => takeItems),
    ),
  );
}

import { and, asc, eq } from 'drizzle-orm';
import {
  executionUnits,
  reportTestCaseResults,
  testPlanExecutions,
  type ExecutionUnit,
  type ExecutionUnitAttempt,
} from '@shared/schema';
import type { UnitEvidenceView } from '@shared/execution-identity';
import { withTenantTransaction } from '../platform/middleware/tenancy';
import { executionArtifactAvailability } from '../tenancy/artifact-metering';
import {
  relativeArtifactPath,
  runArtifactAccess,
  type EvidencePrincipal,
  type RunArtifactAccess,
} from '../tenancy/artifact-access';
import { readAttempts, unitEvidenceView, type EvidenceLinker } from '../execution/execution-units';

/**
 * The drill-down from a run to one unit's attempts and dataset rows (audit C07, lot P08): the same
 * answer for the report page, the session API and /api/v1.
 *
 * Who may see what is decided once, here, by the rules every other way into a run's files follows
 * (server/tenancy/artifact-access.ts): RLS finds the run or it does not exist; a unit of a test the
 * caller cannot see is absent; raw evidence (a trace, a HAR) is linked only for a principal with the
 * permission, and counted as restricted otherwise; nothing retention removed is linked. What leaves
 * is a projection — never the database rows, which hold the worker's name and the stored paths.
 */

/** Where a link to a run's file points: the report's own route, or /api/v1's. */
export type EvidenceUrlBase = 'session' | 'api-v1';

function urlOf(base: EvidenceUrlBase, executionId: string, relative: string): string {
  const path = relative.split('/').map(encodeURIComponent).join('/');
  return base === 'api-v1'
    ? `/api/v1/runs/${executionId}/artifacts/${path}`
    : `/api/test-plan-executions/${executionId}/artifacts/${path}`;
}

/** Links to a run's stored paths, as this caller may follow them. */
export function evidenceLinker(input: {
  executionId: string;
  base: EvidenceUrlBase;
  access: RunArtifactAccess;
  /** Whether the file is still kept: committed to the quota, not removed by retention. */
  retained: (relative: string) => boolean;
  purged: boolean;
}): EvidenceLinker {
  const { executionId, base, access, retained, purged } = input;
  const relativeOf = (storedPath: string | null | undefined) =>
    purged ? null : relativeArtifactPath(executionId, storedPath);
  return {
    link(storedPath) {
      const relative = relativeOf(storedPath);
      if (!relative || !retained(relative) || !access.linkable(relative)) return null;
      return urlOf(base, executionId, relative);
    },
    restricted(storedPath) {
      const relative = relativeOf(storedPath);
      return !!relative && retained(relative) && access.restricted(relative);
    },
  };
}

/** A unit of a run as the API describes it: its coordinates, never a dataset value. */
export interface UnitSummary {
  unitId: string;
  position: number;
  state: ExecutionUnit['state'];
  /** Why a not_startable unit could not start, or why an indeterminate one has no result. */
  reason: string | null;
  testType: 'ui' | 'api' | 'mobile';
  testId: number | null;
  /** Which occurrence of the test in the plan, from 0. */
  occurrence: number;
  browser: string | null;
  locale: string | null;
  device: string | null;
  /** A cucumber test's dataset row, by index. A UI dataset's rows are the attempts' `rows`. */
  bddRow: number | null;
  /** Its single final result, once written. */
  result: {
    id: string;
    testName: string;
    status: string;
    attempts: number;
    decidingAttempt: number | null;
  } | null;
}

export interface UnitDetail extends UnitSummary {
  evidence: UnitEvidenceView;
}

function summaryOf(
  unit: ExecutionUnit,
  result: {
    id: string;
    testName: string;
    status: string;
    attempts: number;
    unitAttempt: number | null;
  } | null,
): UnitSummary {
  const { coordinates } = unit;
  return {
    unitId: unit.unitId,
    position: unit.position,
    state: unit.state,
    reason: unit.reason ?? null,
    testType: coordinates.testType,
    testId: coordinates.testId,
    occurrence: coordinates.occurrence,
    browser: coordinates.browser?.name ?? null,
    locale: coordinates.locale,
    device: coordinates.device,
    bddRow: coordinates.bddRow,
    result: result
      ? {
          id: result.id,
          testName: result.testName,
          status: result.status,
          attempts: result.attempts,
          decidingAttempt: result.unitAttempt,
        }
      : null,
  };
}

/** A unit whose test the caller cannot see: answered like a unit that does not exist. */
const hiddenUnit = (access: RunArtifactAccess, unitId: string) => {
  const decision = access.decide(`units/${unitId}/attempt_1/final.png`);
  return !decision.allowed && decision.reason === 'hidden';
};

interface Loaded {
  execution: { id: string; testPlanId: string; organizationId: number; purged: boolean };
  units: ExecutionUnit[];
  results: Map<
    string,
    { id: string; testName: string; status: string; attempts: number; unitAttempt: number | null }
  >;
  attempts: Map<string, ExecutionUnitAttempt[]>;
  access: RunArtifactAccess;
}

async function load(
  executionId: string,
  principal: EvidencePrincipal | null,
  unitId?: string,
): Promise<Loaded | null> {
  return withTenantTransaction(async (tx) => {
    const [execution] = await tx
      .select({
        id: testPlanExecutions.id,
        testPlanId: testPlanExecutions.testPlanId,
        organizationId: testPlanExecutions.organizationId,
        purgedAt: testPlanExecutions.artifactsPurgedAt,
      })
      .from(testPlanExecutions)
      .where(eq(testPlanExecutions.id, executionId))
      .limit(1);
    if (!execution) return null;
    const units = await tx
      .select()
      .from(executionUnits)
      .where(
        unitId
          ? and(eq(executionUnits.executionId, executionId), eq(executionUnits.unitId, unitId))
          : eq(executionUnits.executionId, executionId),
      )
      .orderBy(asc(executionUnits.position));
    const rows = await tx
      .select({
        id: reportTestCaseResults.id,
        unitId: reportTestCaseResults.executionUnitId,
        testName: reportTestCaseResults.testName,
        status: reportTestCaseResults.status,
        attempts: reportTestCaseResults.attempts,
        unitAttempt: reportTestCaseResults.unitAttempt,
      })
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
    const access = await runArtifactAccess(tx, {
      organizationId: execution.organizationId,
      executionId,
      principal,
    });
    return {
      execution: { ...execution, purged: !!execution.purgedAt },
      units,
      results: new Map(rows.filter((row) => row.unitId).map((row) => [row.unitId!, row])),
      attempts: unitId ? await readAttempts(tx, executionId, unitId) : new Map(),
      access,
    };
  });
}

/** A run's units, in plan order, without those of tests the caller cannot see. Null: no such run. */
export async function listRunUnits(
  executionId: string,
  principal: EvidencePrincipal | null,
): Promise<UnitSummary[] | null> {
  const loaded = await load(executionId, principal);
  if (!loaded) return null;
  return loaded.units
    .filter((unit) => !hiddenUnit(loaded.access, unit.unitId))
    .map((unit) => summaryOf(unit, loaded.results.get(unit.unitId) ?? null));
}

/**
 * One unit with every attempt and dataset row, linked as the caller may follow them. Null when the
 * run, or the unit, does not exist for this caller.
 */
export async function runUnitDetail(
  executionId: string,
  unitId: string,
  principal: EvidencePrincipal | null,
  base: EvidenceUrlBase,
): Promise<UnitDetail | null> {
  const loaded = await load(executionId, principal, unitId);
  const unit = loaded?.units[0];
  if (!loaded || !unit || hiddenUnit(loaded.access, unit.unitId)) return null;
  const { execution } = loaded;
  const retained = await executionArtifactAvailability(
    execution.organizationId,
    execution.testPlanId,
    execution.id,
  );
  const result = loaded.results.get(unit.unitId) ?? null;
  const linker = evidenceLinker({
    executionId,
    base,
    access: loaded.access,
    retained,
    purged: execution.purged,
  });
  return {
    ...summaryOf(unit, result),
    evidence: unitEvidenceView(
      unit.unitId,
      result?.unitAttempt ?? null,
      loaded.attempts.get(unit.unitId) ?? [],
      linker,
    ),
  };
}

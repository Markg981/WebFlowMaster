/**
 * A run's manifest and the attempts at its units (migration 0091, shared/execution-identity.ts).
 *
 * The lanes say what runs where; the manifest says, before anything runs, what results the run
 * owes: one per unit, units of a browser that would not start included. Each unit is named once,
 * here, from where it sits in the plan — never later from a result's name or a count of rows —
 * and every try at it is an attempt assigned before the try produces anything.
 *
 * Rolling out: the tables are additive and a worker that predates them keeps writing results
 * without a unit, which every reader here accepts. Nothing decides a verdict from the manifest
 * yet; that comes once no worker without it is left (lot P11).
 */
import { createHash } from 'crypto';
import os from 'os';
import { and, asc, eq, max, sql } from 'drizzle-orm';
import {
  executionUnitAttempts,
  executionUnits,
  type ExecutionUnit,
  type ExecutionUnitAttempt,
  type ReportTestCaseResult,
} from '@shared/schema';
import {
  canonicalCoordinates,
  type AttemptEvidenceRecord,
  type AttemptView,
  type EvidenceLinks,
  type UnitEvidenceView,
  type ExecutionAttemptRef,
  type ExecutionUnitRef,
  type ExecutionUnitState,
  type UnitBrowser,
  type UnitCoordinates,
} from '@shared/execution-identity';
import { withTenantTransaction, type TenantTx } from '../platform/middleware/tenancy';
import type { Pass, PassTarget } from './plan-run/browsers';
import { referencedId, type FrozenTests, type TestLink } from './plan-run/definitions';
import { planLanes, type Lane, type RunUnit } from './plan-run/lanes';

/** The browser a pass was asked for, as the identity of the units that run on it. */
export function browserIdentity(pass: Pass): UnitBrowser | null {
  if (!pass) return null;
  return {
    name: pass.name ?? pass.label,
    channel: pass.channel ?? null,
    device: pass.device ?? null,
    os: pass.machine?.os ?? null,
    osVersion: pass.machine?.osVersion ?? null,
    browserVersion: pass.machine?.browserVersion ?? null,
  };
}

/** A unit's id: opaque, scoped to its run, the same for the same coordinates of the same run. */
export function unitIdFor(executionId: string, coordinates: UnitCoordinates): string {
  return (
    'u_' +
    createHash('sha256')
      .update(`${executionId}\n${canonicalCoordinates(coordinates)}`)
      .digest('hex')
      .slice(0, 24)
  );
}

export type { PassTarget };

/** One row of the manifest, before it is written. */
export interface ManifestEntry {
  unitId: string;
  position: number;
  coordinates: UnitCoordinates;
  state: Extract<ExecutionUnitState, 'planned' | 'not_startable'>;
  reason: string | null;
}

export interface RunManifest {
  /** The lanes to run, each unit carrying its id. */
  lanes: Lane[];
  /** Every unit the run expects, in plan order: those that run first, then those that cannot. */
  entries: ManifestEntry[];
}

/**
 * The run's lanes and its manifest, from the requested browsers and what the probe said of each.
 *
 * Units run as `planLanes` lays them out; a requested browser that would not start contributes
 * the units it would have run, as `not_startable`. A unit's identity is the request — the browser
 * the plan named, not the headless or engine fallback that ran — so a fallback is the same unit.
 */
export function planManifest(
  executionId: string,
  tests: Pick<FrozenTests, 'links' | 'ui' | 'mobile'>,
  targets: PassTarget[],
  locales: string[] | null | undefined,
): RunManifest {
  const started = targets.filter((target) => target.started !== null);
  const requestedOf = new Map<Pass, Pass>(
    started.map((target) => [target.started as Pass, target.requested]),
  );
  const occurrence = occurrences(tests.links);
  const seen = new Map<string, number>();
  const entries: ManifestEntry[] = [];

  const identify = (
    unit: RunUnit,
    requested: Pass,
  ): { unitId: string; coordinates: UnitCoordinates } => {
    const base: UnitCoordinates = {
      testType: unit.link.testType as UnitCoordinates['testType'],
      testId: referencedId(unit.link) ?? null,
      occurrence: occurrence.get(unit.link) ?? 0,
      browser: unit.browserChoice ? browserIdentity(requested ?? unit.browserChoice) : null,
      locale: unit.locale ?? null,
      device: unit.mobileTarget?.key ?? null,
      bddRow: unit.bddRowIndex ?? null,
    };
    // Two requests for the very same browser are two units all the same.
    const key = canonicalCoordinates(base);
    const repeat = seen.get(key) ?? 0;
    seen.set(key, repeat + 1);
    const coordinates = repeat ? { ...base, duplicate: repeat } : base;
    return { unitId: unitIdFor(executionId, coordinates), coordinates };
  };
  const add = (unit: RunUnit, requested: Pass, blocked?: string): RunUnit => {
    const { unitId, coordinates } = identify(unit, requested);
    entries.push({
      unitId,
      position: entries.length,
      coordinates,
      state: blocked === undefined ? 'planned' : 'not_startable',
      reason: blocked ?? null,
    });
    return { ...unit, unitId };
  };

  const lanes = planLanes(
    tests,
    started.map((target) => target.started as Pass),
    locales,
  ).map((lane) => ({
    ...lane,
    units: lane.units.map((unit) =>
      add(unit, unit.browserChoice ? requestedOf.get(unit.browserChoice) : undefined),
    ),
  }));

  // What a browser that would not start would have run: its own browser's units only — the
  // manual, mobile and BDD units run once per run, in a lane that did start.
  for (const target of targets) {
    if (target.started !== null || !target.requested) continue;
    for (const lane of planLanes(tests, [target.requested], locales))
      for (const unit of lane.units)
        if (unit.browserChoice)
          add(unit, target.requested, target.failure ?? 'The browser could not start.');
  }
  return { lanes, entries };
}

/** Which occurrence of its test each link is: 0, then 1 for the same test again, and so on. */
function occurrences(links: TestLink[]): Map<TestLink, number> {
  const counts = new Map<string, number>();
  const result = new Map<TestLink, number>();
  for (const link of links) {
    const key = `${link.testType}:${referencedId(link) ?? 'missing'}`;
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    result.set(link, n);
  }
  return result;
}

/** The manifest was written before, and not with these units. */
export class ManifestMismatchError extends Error {
  constructor(executionId: string) {
    super(`The run ${executionId} already has a different manifest.`);
    this.name = 'ManifestMismatchError';
  }
}

const INSERT_CHUNK = 500;

/**
 * Writes the manifest, before any unit starts. Written once: writing the same one again changes
 * nothing, and writing a different one is refused rather than merged.
 */
export async function writeManifest(
  executionId: string,
  organizationId: number,
  entries: ManifestEntry[],
): Promise<void> {
  await withTenantTransaction(async (tx) => {
    const existing = await tx
      .select({ unitId: executionUnits.unitId, position: executionUnits.position })
      .from(executionUnits)
      .where(eq(executionUnits.executionId, executionId));
    if (existing.length) {
      const same =
        existing.length === entries.length &&
        existing.every((row) => entries[row.position]?.unitId === row.unitId);
      if (!same) throw new ManifestMismatchError(executionId);
      return;
    }
    for (let i = 0; i < entries.length; i += INSERT_CHUNK) {
      await tx.insert(executionUnits).values(
        entries.slice(i, i + INSERT_CHUNK).map((entry) => ({
          executionId,
          organizationId,
          unitId: entry.unitId,
          position: entry.position,
          coordinates: entry.coordinates,
          state: entry.state,
          reason: entry.reason,
        })),
      );
    }
  });
}

/** A try asked for a unit the run's manifest does not hold, or holds as finished. */
export class AttemptRefusedError extends Error {
  constructor(ref: ExecutionUnitRef, why: string) {
    super(`No attempt at unit ${ref.unitId}: ${why}`);
    this.name = 'AttemptRefusedError';
  }
}

const THIS_WORKER = `${os.hostname()}:${process.pid}`;

/**
 * The next attempt at a unit, assigned and validated before the try produces anything: the unit
 * must be in this run's manifest and still owe its result. Numbers only grow: 1, 2, 3…
 */
export async function beginAttempt(ref: ExecutionUnitRef): Promise<ExecutionAttemptRef> {
  return withTenantTransaction(async (tx) => {
    const [unit] = await tx
      .select({ state: executionUnits.state, organizationId: executionUnits.organizationId })
      .from(executionUnits)
      .where(
        and(eq(executionUnits.executionId, ref.executionId), eq(executionUnits.unitId, ref.unitId)),
      )
      .for('update');
    if (!unit) throw new AttemptRefusedError(ref, 'it is not in the run’s manifest.');
    if (unit.state === 'recorded' || unit.state === 'not_startable')
      throw new AttemptRefusedError(ref, `it is ${unit.state.replace('_', ' ')}.`);
    const [{ last }] = await tx
      .select({ last: max(executionUnitAttempts.attempt) })
      .from(executionUnitAttempts)
      .where(
        and(
          eq(executionUnitAttempts.executionId, ref.executionId),
          eq(executionUnitAttempts.unitId, ref.unitId),
        ),
      );
    const attempt = (last ?? 0) + 1;
    await tx.insert(executionUnitAttempts).values({
      executionId: ref.executionId,
      organizationId: unit.organizationId,
      unitId: ref.unitId,
      attempt,
      worker: THIS_WORKER,
    });
    if (unit.state !== 'running')
      await tx
        .update(executionUnits)
        .set({ state: 'running', updatedAt: sql`now()` })
        .where(
          and(
            eq(executionUnits.executionId, ref.executionId),
            eq(executionUnits.unitId, ref.unitId),
          ),
        );
    return { ...ref, attempt };
  });
}

/** What an attempt ended with, besides its status: recorded with it, before the unit's result. */
export interface AttemptRecord {
  failureReason?: string | null;
  evidence?: AttemptEvidenceRecord | null;
}

/**
 * Closes an attempt with its own outcome — its status, its reason and the stored paths of what it
 * left behind — so a try that a re-run replaces keeps its account, not only its number.
 */
export async function finishAttempt(
  ref: ExecutionAttemptRef,
  status: string,
  record: AttemptRecord = {},
): Promise<void> {
  await withTenantTransaction(async (tx) => {
    await tx
      .update(executionUnitAttempts)
      .set({
        state: 'finished',
        status,
        failureReason: record.failureReason?.slice(0, 4000) ?? null,
        evidence: record.evidence ?? null,
        finishedAt: sql`now()`,
      })
      .where(
        and(
          eq(executionUnitAttempts.executionId, ref.executionId),
          eq(executionUnitAttempts.unitId, ref.unitId),
          eq(executionUnitAttempts.attempt, ref.attempt),
        ),
      );
  });
}

/**
 * One line of a run's report: an expected unit with its result, or — for rows written before the
 * manifest, or by a worker without it — a result with no unit, as it always was.
 */
export interface UnitReportEntry {
  unitId: string | null;
  state: ExecutionUnitState | 'legacy';
  coordinates: UnitCoordinates | null;
  reason: string | null;
  result: ReportTestCaseResult | null;
}

/**
 * The report of a run in one model, whatever wrote it: the manifest's units in plan order with
 * the result each one has (or none yet), then any result that names no unit. A historical row is
 * never matched to a unit by its name or position.
 */
export function unitReport(
  units: Array<Pick<ExecutionUnit, 'unitId' | 'position' | 'state' | 'coordinates' | 'reason'>>,
  rows: ReportTestCaseResult[],
): UnitReportEntry[] {
  const byUnit = new Map(
    rows.filter((row) => row.executionUnitId).map((row) => [row.executionUnitId!, row]),
  );
  return [
    ...[...units]
      .sort((a, b) => a.position - b.position)
      .map((unit) => ({
        unitId: unit.unitId,
        state: unit.state,
        coordinates: unit.coordinates,
        reason: unit.reason,
        result: byUnit.get(unit.unitId) ?? null,
      })),
    ...rows
      .filter((row) => !row.executionUnitId)
      .map((row) => ({
        unitId: null,
        state: 'legacy' as const,
        coordinates: null,
        reason: null,
        result: row,
      })),
  ];
}

/** Units the run expected and has no result for: those that never ran, or whose result was lost. */
export const unaccountedUnits = (report: UnitReportEntry[]): UnitReportEntry[] =>
  report.filter((entry) => entry.unitId !== null && entry.result === null);

/**
 * Every attempt of a run — or of one of its units — by unit, each unit's in order. Inside the
 * caller's tenant transaction.
 */
export async function readAttempts(
  tx: TenantTx,
  executionId: string,
  unitId?: string,
): Promise<Map<string, ExecutionUnitAttempt[]>> {
  const rows = await tx
    .select()
    .from(executionUnitAttempts)
    .where(
      unitId
        ? and(
            eq(executionUnitAttempts.executionId, executionId),
            eq(executionUnitAttempts.unitId, unitId),
          )
        : eq(executionUnitAttempts.executionId, executionId),
    )
    .orderBy(asc(executionUnitAttempts.unitId), asc(executionUnitAttempts.attempt));
  const byUnit = new Map<string, ExecutionUnitAttempt[]>();
  for (const row of rows) byUnit.set(row.unitId, [...(byUnit.get(row.unitId) ?? []), row]);
  return byUnit;
}

/** How a caller sees one stored path: a link it may open, and whether raw evidence was withheld. */
export interface EvidenceLinker {
  link(storedPath: string | null | undefined): string | null;
  restricted(storedPath: string | null | undefined): boolean;
}

function linksOf(
  linker: EvidenceLinker,
  stored: Pick<AttemptEvidenceRecord, 'screenshotUrl' | 'videoUrl' | 'traceUrl' | 'harUrl'>,
): EvidenceLinks {
  const paths = [stored.screenshotUrl, stored.videoUrl, stored.traceUrl, stored.harUrl];
  return {
    screenshotUrl: linker.link(stored.screenshotUrl),
    videoUrl: linker.link(stored.videoUrl),
    traceUrl: linker.link(stored.traceUrl),
    harUrl: linker.link(stored.harUrl),
    restricted: paths.some((storedPath) => linker.restricted(storedPath)),
  };
}

/**
 * One unit's attempts as a caller may see them: every try in order, each with its own evidence and
 * its dataset rows, linked only where the caller may open the file. A projection: never the
 * database row itself, which holds the worker's name and the stored paths.
 */
export function unitEvidenceView(
  unitId: string,
  decidingAttempt: number | null,
  attempts: ExecutionUnitAttempt[],
  linker: EvidenceLinker,
): UnitEvidenceView {
  return {
    unitId,
    decidingAttempt,
    attempts: attempts.map((row): AttemptView => ({
      attempt: row.attempt,
      state: row.state,
      status: row.status ?? null,
      failureReason: row.failureReason ?? null,
      startedAt: new Date(row.startedAt).toISOString(),
      finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
      ...linksOf(linker, row.evidence ?? {}),
      rows: (row.evidence?.rows ?? []).map((slice) => ({
        datasetRow: slice.datasetRow,
        status: slice.status,
        error: slice.error ?? null,
        ...linksOf(linker, slice),
      })),
    })),
  };
}

/** A run's manifest, in plan order. Empty for a run from before it existed. */
export async function readManifest(executionId: string): Promise<ExecutionUnit[]> {
  return withTenantTransaction((tx) =>
    tx
      .select()
      .from(executionUnits)
      .where(eq(executionUnits.executionId, executionId))
      .orderBy(asc(executionUnits.position)),
  );
}

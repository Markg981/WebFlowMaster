import { desc, eq, inArray, max } from 'drizzle-orm';
import { testVersions } from '@shared/schema';
import type { TenantTx } from '../platform/middleware/tenancy';
import { describeChange, snapshotOf } from './test-versions';
import {
  typedSnapshotOf,
  describeTypedChange,
  type VersionedTestType,
} from '@shared/test-versioning';
import { targetColumn, targetValues } from './test-version-target';
import {
  DEPENDENCY_PROTOCOL,
  captureDependencies,
  dependencyFingerprint,
  describeDependencyChange,
  readVersionBundle,
  versionSnapshotWith,
} from './executable-definition';

/**
 * Writing down what a test was, every time it is saved.
 *
 * Always inside the caller's transaction, never in one of its own: a version that survives a
 * save which then rolled back is a false record, and a save that commits with no version is an
 * invisible change. The two belong together or not at all — the same rule the audit log follows.
 *
 * Nothing here filters by organization. RLS does that, and the caller's transaction is already
 * bound to one tenant.
 */

export interface VersionableTest {
  name: string;
  url: string;
  sequence: unknown;
  elements: unknown;
  preconditions?: unknown;
  cleanups?: unknown;
  dataset?: unknown;
  bdd?: unknown;
}

export interface RecordedVersion {
  version: number;
  summary: string;
}

/**
 * The version each of these tests is on right now, in one query.
 *
 * Read once before a run rather than per result: a plan with forty tests on three browsers
 * writes a hundred and twenty rows, and asking the database for the same forty answers a
 * hundred and twenty times is how a report becomes the slow part of a run.
 *
 * A test with no history at all is absent from the map rather than reported as version 0 —
 * it can only be one saved before versions were recorded, and the result should say it does
 * not know instead of inventing a number.
 */
export async function currentVersionsOf(
  tx: TenantTx,
  testIds: number[],
  testType: VersionedTestType = 'ui',
): Promise<Map<number, number>> {
  const column = targetColumn(testVersions, testType);
  const versions = new Map<number, number>();
  const wanted = Array.from(new Set(testIds));
  if (wanted.length === 0) return versions;

  const rows = await tx
    .select({ testId: column, version: max(testVersions.version) })
    .from(testVersions)
    .where(inArray(column, wanted))
    .groupBy(column);

  for (const row of rows) {
    const version = Number(row.version);
    if (Number.isFinite(version) && version > 0) versions.set(row.testId!, version);
  }
  return versions;
}

/**
 * Records the test as it now is, unless it is exactly what the last version already says.
 *
 * A save that changed nothing — the builder re-saving an untouched sequence, a PUT that only
 * repeated the current values — produces no row. Otherwise a history fills up with versions
 * that differ in nothing, and the one real edit in the middle of them is impossible to find.
 *
 * The version number is the previous one plus one, read inside this transaction. Two saves of
 * the same test at the same instant would both compute the same number and the unique index
 * would fail the second — which is the right failure: loudly, rather than two rows both
 * claiming to be version 4 and "restore version 4" meaning either of them.
 */
export async function recordTestVersion(
  tx: TenantTx,
  input: {
    testId: number;
    organizationId: number;
    /** Who saved it. Null when a background job did, so the history can say "not a person". */
    userId: number | null;
    test: VersionableTest;
    /** Set when this version exists because somebody restored an older one. */
    restoredFromVersion?: number | null;
  },
): Promise<RecordedVersion | null> {
  const [latest] = await tx
    .select()
    .from(testVersions)
    .where(eq(testVersions.testId, input.testId))
    .orderBy(desc(testVersions.version))
    .limit(1);

  const snapshot = snapshotOf(input.test);
  // What the test calls, captured in this transaction with the version it belongs to (C04). Its
  // fingerprint takes part in "did anything change?": a group edited since the last version is a
  // reason for a new one when the test is saved again, and the only way a published test picks
  // the edit up — through a new version, reviewed like any other.
  const dependencies = await captureDependencies(tx, snapshot.sequence);
  const previousRead = latest ? readVersionBundle(latest.snapshot) : null;
  const previousBundle = previousRead?.kind === 'ok' ? previousRead.bundle : null;
  const contentChange = describeChange(latest ? snapshotOf(latest) : null, snapshot);
  // A first version says how it was created; a legacy one gains its record on the next save.
  const dependencyChange =
    latest && (previousBundle || dependencies.fingerprint !== emptyFingerprint())
      ? describeDependencyChange(previousBundle, dependencies)
      : '';
  const summary = joinSummary(contentChange, dependencyChange);
  if (summary === '') return null;

  const version = (latest?.version ?? 0) + 1;
  await tx.insert(testVersions).values({
    organizationId: input.organizationId,
    testId: input.testId,
    version,
    name: snapshot.name,
    url: snapshot.url,
    sequence: snapshot.sequence,
    elements: snapshot.elements,
    preconditions: snapshot.preconditions ?? null,
    cleanups: snapshot.cleanups ?? null,
    dataset: snapshot.dataset ?? null,
    bdd: (snapshot.bdd as import('@shared/bdd').BddTest | null) ?? null,
    snapshot: versionSnapshotWith(dependencies),
    summary,
    restoredFromVersion: input.restoredFromVersion ?? null,
    createdBy: input.userId,
  });

  return { version, summary };
}

let empty: string | null = null;
/** The fingerprint of a test that calls nothing shared. */
function emptyFingerprint(): string {
  empty ??= dependencyFingerprint({
    protocol: DEPENDENCY_PROTOCOL,
    groups: [],
    elements: [],
    customActions: [],
    missing: { groups: [], elements: [], customActions: [] },
  });
  return empty;
}

/** "3 steps added." and "step group "Login" changed" as one sentence. */
function joinSummary(content: string, dependencies: string): string {
  if (!dependencies) return content;
  const phrase = `${dependencies.charAt(0).toUpperCase()}${dependencies.slice(1)}.`;
  return content ? `${content.replace(/\.$/, '')}; ${dependencies}.` : phrase;
}

/** Immutable latest definitions: version and execution content come from the same row. */
export async function currentContentOf(
  tx: TenantTx,
  testIds: number[],
  testType: 'api' | 'mobile',
): Promise<Map<number, { version: number; snapshot: Record<string, unknown> }>> {
  const content = new Map<number, { version: number; snapshot: Record<string, unknown> }>();
  const wanted = [...new Set(testIds)];
  if (!wanted.length) return content;
  const column = targetColumn(testVersions, testType);
  const rows = await tx
    .selectDistinctOn([column], {
      testId: column,
      version: testVersions.version,
      snapshot: testVersions.snapshot,
    })
    .from(testVersions)
    .where(inArray(column, wanted))
    .orderBy(column, desc(testVersions.version));
  for (const row of rows)
    if (row.testId !== null && row.snapshot && !content.has(row.testId))
      content.set(row.testId, { version: row.version, snapshot: row.snapshot });
  return content;
}
export async function recordTypedTestVersion(
  tx: TenantTx,
  input: {
    testType: 'api' | 'mobile';
    testId: number;
    organizationId: number;
    userId: number | null;
    test: Record<string, unknown>;
    restoredFromVersion?: number | null;
  },
): Promise<RecordedVersion | null> {
  const column = targetColumn(testVersions, input.testType);
  const [latest] = await tx
    .select()
    .from(testVersions)
    .where(eq(column, input.testId))
    .orderBy(desc(testVersions.version))
    .limit(1);
  const snapshot = typedSnapshotOf(input.testType, input.test);
  const summary = describeTypedChange(latest?.snapshot ?? null, snapshot);
  if (!summary) return null;
  const version = (latest?.version ?? 0) + 1;
  await tx.insert(testVersions).values({
    organizationId: input.organizationId,
    ...targetValues(input.testType, input.testId),
    version,
    name: String(snapshot.name),
    url: input.testType === 'api' ? String(snapshot.url) : '',
    sequence: [],
    elements: [],
    snapshot,
    summary,
    createdBy: input.userId,
    restoredFromVersion: input.restoredFromVersion ?? null,
  });
  return { version, summary };
}

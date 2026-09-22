import { desc, eq } from 'drizzle-orm';
import { testVersions } from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';
import { describeChange, snapshotOf } from './test-versions';

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
  dataset?: unknown;
}

export interface RecordedVersion {
  version: number;
  summary: string;
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
  const summary = describeChange(latest ? snapshotOf(latest) : null, snapshot);
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
    dataset: snapshot.dataset ?? null,
    summary,
    restoredFromVersion: input.restoredFromVersion ?? null,
    createdBy: input.userId,
  });

  return { version, summary };
}

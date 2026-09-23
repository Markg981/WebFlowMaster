import { and, asc, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  apiTests,
  reportTestCaseResults,
  testQuarantines,
  tests,
  users,
  type TestQuarantine,
} from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';
import { recordAudit, type AuditActor } from './audit';

/**
 * Quarantine: a test set aside while it is unreliable.
 *
 * The flaky analysis says which tests change their verdict with nothing to explain it. Knowing
 * did not help the pipeline. The same test still failed the nightly run one night in three, and
 * the team learnt that a red build means "run it again", which is how a real failure gets through.
 *
 * A quarantined test still runs and its result is still recorded. Keeping the evidence is the
 * point: whoever fixes it can see the fix hold before releasing it. What changes is only what its
 * failure means. It does not fail the run, stop the plan under a failure policy, file an issue or
 * turn a pipeline red. A person quarantines a test, with a reason, and a person releases it.
 * Row-level security decides who may do either (migration 0035).
 */

export class QuarantineError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = 'QuarantineError';
  }
}

export type TestRef = { type: 'ui' | 'api'; id: number };

export const refKey = (ref: TestRef) => `${ref.type}:${ref.id}`;

/** The open quarantines of these tests, by refKey. */
export async function openQuarantinesOf(
  tx: TenantTx,
  refs: TestRef[],
): Promise<Map<string, Pick<TestQuarantine, 'id' | 'reason' | 'quarantinedAt'>>> {
  const uiIds = refs.filter((r) => r.type === 'ui').map((r) => r.id);
  const apiIds = refs.filter((r) => r.type === 'api').map((r) => r.id);
  const found = new Map<string, Pick<TestQuarantine, 'id' | 'reason' | 'quarantinedAt'>>();
  if (uiIds.length === 0 && apiIds.length === 0) return found;
  const which = [
    ...(uiIds.length ? [inArray(testQuarantines.testId, uiIds)] : []),
    ...(apiIds.length ? [inArray(testQuarantines.apiTestId, apiIds)] : []),
  ];
  const rows = await tx
    .select()
    .from(testQuarantines)
    .where(and(isNull(testQuarantines.releasedAt), which.length === 1 ? which[0] : or(...which)));
  for (const row of rows) {
    const ref: TestRef = row.testType === 'ui' ? { type: 'ui', id: row.testId! } : { type: 'api', id: row.apiTestId! };
    found.set(refKey(ref), { id: row.id, reason: row.reason, quarantinedAt: row.quarantinedAt });
  }
  return found;
}

/** A result as the verdict needs it. */
export interface VerdictRow {
  status: string;
  quarantined?: boolean | null;
}

const isFailure = (status: string) => status === 'Failed' || status === 'Error';

/**
 * The failures that decide a run, and the ones that do not.
 *
 * A quarantined test's failure is counted and shown, but it is not what makes a run "failed":
 * that is the whole of what quarantine changes. Every other rule for deciding a run stays where
 * it is (server/test-execution-service.ts).
 */
export function failuresOf(rows: VerdictRow[]): { holding: number; quarantined: number } {
  let holding = 0;
  let quarantined = 0;
  for (const row of rows) {
    if (!isFailure(row.status)) continue;
    if (row.quarantined) quarantined++;
    else holding++;
  }
  return { holding, quarantined };
}

/** What a quarantined test has done since it was set aside: the evidence for releasing it. */
export interface QuarantineEvidence {
  runs: number;
  passed: number;
  failed: number;
  /** Passes in a row, counting back from the latest result. */
  passingStreak: number;
  lastRunAt: string | null;
  lastStatus: string | null;
}

/** Pure, so the rule is tested without a database: results in any order. */
export function evidenceFrom(results: Array<{ status: string; startedAt: Date | string }>): QuarantineEvidence {
  const ordered = [...results].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  // Skipped results say nothing either way: the test did not answer.
  const judged = ordered.filter((r) => r.status === 'Passed' || isFailure(r.status));
  let passingStreak = 0;
  for (const row of judged) {
    if (row.status !== 'Passed') break;
    passingStreak++;
  }
  return {
    runs: judged.length,
    passed: judged.filter((r) => r.status === 'Passed').length,
    failed: judged.filter((r) => isFailure(r.status)).length,
    passingStreak,
    lastRunAt: judged[0] ? new Date(judged[0].startedAt).toISOString() : null,
    lastStatus: judged[0]?.status ?? null,
  };
}

/** Every open quarantine the caller can see, with its test's name and what it has done since. */
export async function listOpenQuarantines(tx: TenantTx) {
  const rows = await tx
    .select({
      quarantine: testQuarantines,
      uiName: tests.name,
      apiName: apiTests.name,
      quarantinedByName: users.username,
    })
    .from(testQuarantines)
    .leftJoin(tests, eq(tests.id, testQuarantines.testId))
    .leftJoin(apiTests, eq(apiTests.id, testQuarantines.apiTestId))
    .leftJoin(users, eq(users.id, testQuarantines.quarantinedBy))
    .where(isNull(testQuarantines.releasedAt))
    .orderBy(desc(testQuarantines.quarantinedAt));

  return Promise.all(
    rows.map(async ({ quarantine, uiName, apiName, quarantinedByName }) => {
      const results = await tx
        .select({ status: reportTestCaseResults.status, startedAt: reportTestCaseResults.startedAt })
        .from(reportTestCaseResults)
        .where(
          and(
            quarantine.testType === 'ui'
              ? eq(reportTestCaseResults.uiTestId, quarantine.testId!)
              : eq(reportTestCaseResults.apiTestId, quarantine.apiTestId!),
            gte(reportTestCaseResults.startedAt, quarantine.quarantinedAt),
          ),
        )
        .orderBy(asc(reportTestCaseResults.startedAt));
      return {
        id: quarantine.id,
        testType: quarantine.testType,
        testId: quarantine.testType === 'ui' ? quarantine.testId! : quarantine.apiTestId!,
        testName: (quarantine.testType === 'ui' ? uiName : apiName) ?? null,
        reason: quarantine.reason,
        quarantinedAt: quarantine.quarantinedAt.toISOString(),
        quarantinedBy: quarantinedByName ?? null,
        evidence: evidenceFrom(results),
      };
    }),
  );
}

const isUniqueViolation = (error: unknown) => /unique|duplicate/i.test((error as Error)?.message ?? '');
const isPolicyViolation = (error: unknown) => /row-level security/i.test((error as Error)?.message ?? '');

/** Sets a test aside. The test must be one the caller can see; RLS decides whether they may change it. */
export async function quarantineTest(
  tx: TenantTx,
  input: { ref: TestRef; reason: string; organizationId: number; actor: AuditActor },
): Promise<TestQuarantine> {
  const table = input.ref.type === 'ui' ? tests : apiTests;
  const [test] = await tx.select({ id: table.id, name: table.name }).from(table).where(eq(table.id, input.ref.id)).limit(1);
  if (!test) throw new QuarantineError('test_not_found', 'Test not found.', 404);

  let row: TestQuarantine;
  try {
    [row] = await tx
      .insert(testQuarantines)
      .values({
        organizationId: input.organizationId,
        testType: input.ref.type,
        testId: input.ref.type === 'ui' ? input.ref.id : null,
        apiTestId: input.ref.type === 'api' ? input.ref.id : null,
        reason: input.reason,
        quarantinedBy: input.actor.id,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) throw new QuarantineError('already_quarantined', 'This test is already in quarantine.', 409);
    if (isPolicyViolation(error)) throw new QuarantineError('project_read_only', "You can view this test's project but not change it.", 403);
    throw error;
  }

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TEST_QUARANTINED,
    actor: input.actor,
    targetType: input.ref.type === 'ui' ? 'test' : 'api_test',
    targetId: input.ref.id,
    metadata: { name: test.name, reason: input.reason, quarantineId: row.id },
  });
  return row;
}

/** Brings a test back: its failures count again from the next run. */
export async function releaseQuarantine(
  tx: TenantTx,
  input: { quarantineId: number; note: string | null; actor: AuditActor },
): Promise<TestQuarantine> {
  const [existing] = await tx.select().from(testQuarantines).where(eq(testQuarantines.id, input.quarantineId)).limit(1);
  if (!existing) throw new QuarantineError('not_found', 'Quarantine not found.', 404);
  if (existing.releasedAt) throw new QuarantineError('already_released', 'This test has already been released.', 409);

  const [released] = await tx
    .update(testQuarantines)
    .set({ releasedAt: new Date(), releasedBy: input.actor.id, releaseNote: input.note })
    .where(and(eq(testQuarantines.id, input.quarantineId), isNull(testQuarantines.releasedAt)))
    .returning();
  // Seen but not changed: a viewer on the test's restricted project.
  if (!released) throw new QuarantineError('project_read_only', "You can view this test's project but not change it.", 403);

  const testId = existing.testType === 'ui' ? existing.testId! : existing.apiTestId!;
  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TEST_QUARANTINE_RELEASED,
    actor: input.actor,
    targetType: existing.testType === 'ui' ? 'test' : 'api_test',
    targetId: testId,
    metadata: { quarantineId: existing.id, reason: existing.reason, note: input.note, since: existing.quarantinedAt.toISOString() },
  });
  return released;
}

/**
 * The external case id of a test (`tests.external_case_id`, migration 0120): normalised, tied to
 * its source, and unique per project among non-archived tests.
 *
 * The partial unique index is the last line of defence; these helpers refuse a clash first, with
 * the id of the test that holds the case, so a route can answer with a code instead of a bare
 * 23505 (which the test routes read as "someone else saved first").
 */
import { and, eq, isNull, ne, inArray } from 'drizzle-orm';
import { tests } from '@shared/schema';
import { QA_HUB_SOURCE, normaliseHubCaseId } from '@shared/testcases-hub';
import type { TenantTx } from '../platform/middleware/tenancy';

const QA_ID = /^[A-Za-z0-9]+_TC_\d{1,6}$/i;

export class ExternalCaseIdError extends Error {
  constructor(
    readonly code: 'external_case_id_invalid' | 'external_case_id_conflict',
    message: string,
    readonly existingTestId: number | null = null,
  ) {
    super(message);
  }
}

/** The normalised id, or null for an empty one. Throws for an id that is not a QA hub id. */
export function normaliseExternalCaseId(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  if (!QA_ID.test(trimmed))
    throw new ExternalCaseIdError(
      'external_case_id_invalid',
      'The case id must look like NCC_TC_00301.',
    );
  return normaliseHubCaseId(trimmed);
}

/** The live (non-archived) test of the project that holds the case, if any. */
export async function findTestByExternalCaseId(
  tx: TenantTx,
  where: { projectId: number | null; caseId: string; excludeTestId?: number | null },
): Promise<{ id: number; name: string; status: string } | null> {
  const [row] = await tx
    .select({ id: tests.id, name: tests.name, status: tests.status })
    .from(tests)
    .where(
      and(
        eq(tests.externalSource, QA_HUB_SOURCE),
        eq(tests.externalCaseId, where.caseId),
        ne(tests.status, 'archived'),
        where.projectId == null ? isNull(tests.projectId) : eq(tests.projectId, where.projectId),
        where.excludeTestId != null ? ne(tests.id, where.excludeTestId) : undefined,
      ),
    )
    .orderBy(tests.id)
    .limit(1);
  return row ?? null;
}

/** The ids of `caseIds` that the project already holds, id to test id. One query per batch. */
export async function testsByExternalCaseIds(
  tx: TenantTx,
  projectId: number | null,
  caseIds: string[],
): Promise<Map<string, { id: number; name: string }>> {
  const found = new Map<string, { id: number; name: string }>();
  if (caseIds.length === 0) return found;
  const rows = await tx
    .select({ id: tests.id, name: tests.name, caseId: tests.externalCaseId })
    .from(tests)
    .where(
      and(
        eq(tests.externalSource, QA_HUB_SOURCE),
        inArray(tests.externalCaseId, caseIds),
        ne(tests.status, 'archived'),
        projectId == null ? isNull(tests.projectId) : eq(tests.projectId, projectId),
      ),
    )
    .orderBy(tests.id);
  for (const row of rows) if (row.caseId && !found.has(row.caseId)) found.set(row.caseId, row);
  return found;
}

/**
 * The two columns to write for a save: the normalised id with its source, or both null. Throws
 * ExternalCaseIdError when the id is malformed or another live test of the project holds it.
 */
export async function externalCaseColumns(
  tx: TenantTx,
  input: { externalCaseId: string | null | undefined; projectId: number | null; testId?: number },
): Promise<{ externalCaseId: string | null; externalSource: string | null }> {
  const caseId = normaliseExternalCaseId(input.externalCaseId);
  if (caseId == null) return { externalCaseId: null, externalSource: null };
  const holder = await findTestByExternalCaseId(tx, {
    projectId: input.projectId,
    caseId,
    excludeTestId: input.testId ?? null,
  });
  if (holder)
    throw new ExternalCaseIdError(
      'external_case_id_conflict',
      `Test ${holder.id} already holds the case ${caseId} in this project.`,
      holder.id,
    );
  return { externalCaseId: caseId, externalSource: QA_HUB_SOURCE };
}

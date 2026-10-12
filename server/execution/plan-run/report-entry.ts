/** One test's row in the run report: what it is built from, and how it is saved. */
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import {
  tests as testsTable,
  apiTests as apiTestsTable,
  mobileTests as mobileTestsTable,
  reportTestCaseResults as reportTestCaseResultsTable,
  type ApiTest,
  type InsertReportTestCaseResult,
  type Test,
} from '@shared/schema';
import { passLabel } from '@shared/locales';
import type { NetworkSummary } from '@shared/network';
import type { ExecutionSnapshot } from '../execution-snapshot';
import { withTenantTransaction } from '../../middleware/tenancy';
import { mobileDeviceLabel } from '../../mobile/mobile-runner';
import type { Logger } from './context';
import { referencedId, type FrozenTests, type MobileEntry } from './definitions';
import type { RunUnit } from './lanes';

/** How one test ended, in the report's terms. */
export interface UnitOutcome {
  status: InsertReportTestCaseResult['status'];
  failureReason?: string;
  /** Runs it took: more than one when the plan re-runs failures. */
  attempts?: number;
  screenshotUrl?: string;
  videoUrl?: string;
  traceUrl?: string;
  harUrl?: string;
  network?: NetworkSummary;
  /** The steps, a manual or mobile log, or an API test's protocol and performance, as JSON. */
  detailedLog?: string;
}

export interface ReportEntryInput {
  organizationId: number;
  executionId: string;
  unit: RunUnit;
  testName: string;
  definition: Test | ApiTest | undefined;
  mobile: MobileEntry | undefined;
  versions: FrozenTests['versions'];
  inQuarantine: boolean;
  outcome: UnitOutcome;
  startedAt: number;
  completedAt: number;
}

/** The report row for one unit. Pure: the caller saves it. */
export function buildReportEntry(input: ReportEntryInput): InsertReportTestCaseResult {
  const { unit, outcome, definition } = input;
  const { link } = unit;
  const id = referencedId(link);
  return {
    id: uuidv4(),
    // Same organization as the test plan execution this result belongs to.
    organizationId: input.organizationId,
    testPlanExecutionId: input.executionId,
    uiTestId: link.testType === 'ui' ? link.testId : null,
    apiTestId: link.testType === 'api' ? link.apiTestId : null,
    mobileTestId: link.testType === 'mobile' ? (link.mobileTestId ?? null) : null,
    testType: link.testType,
    testName: input.testName,
    // Null when the plan named no browser, which is every run made before the matrix
    // existed: the report should not claim to know something the run never decided.
    // With a language, the language too: "chromium · it-IT" (shared/locales.ts).
    // A mobile test names the device it ran on instead.
    browser: input.mobile
      ? mobileDeviceLabel(input.mobile.test)
      : passLabel(unit.browserChoice?.label, unit.locale),
    // The version actually executed, including published API/mobile content.
    testVersion: id ? (input.versions[link.testType].get(id) ?? null) : null,
    status: outcome.status,
    attempts: outcome.attempts ?? 1,
    quarantined: input.inQuarantine,
    reasonForFailure: outcome.failureReason,
    screenshotUrl: outcome.screenshotUrl,
    videoUrl: outcome.videoUrl ?? null,
    traceUrl: outcome.traceUrl ?? null,
    harUrl: outcome.harUrl ?? null,
    networkSummary: outcome.network ?? null,
    detailedLog: outcome.detailedLog,
    startedAt: new Date(input.startedAt),
    completedAt: new Date(input.completedAt),
    durationMs: input.completedAt - input.startedAt,
    module: definition?.module || null,
    featureArea: definition?.featureArea || null,
    scenario: definition?.scenario || null,
    component: definition?.component || null,
    priority: definition?.priority || null,
    severity: definition?.severity || null, // This is designed severity. Runtime severity could differ.
  };
}

/**
 * Saves a report row. A row that cannot be saved is logged and skipped: the result goes missing
 * from the detailed report, but the run completes.
 */
export async function saveReportEntry(
  logger: Logger,
  snapshot: ExecutionSnapshot,
  entry: InsertReportTestCaseResult,
): Promise<void> {
  try {
    await withTenantTransaction(async (tx) => {
      // A frozen test remains executable after deletion. Keep its identity in provenance,
      // but only link the result to a live row. Locks protect this check from concurrent deletes.
      if (snapshot.definitions && entry.uiTestId) {
        const [live] = await tx
          .select({ id: testsTable.id })
          .from(testsTable)
          .where(eq(testsTable.id, entry.uiTestId))
          .for('key share');
        if (!live) entry.uiTestId = null;
      }
      if (snapshot.definitions && entry.apiTestId) {
        const [live] = await tx
          .select({ id: apiTestsTable.id })
          .from(apiTestsTable)
          .where(eq(apiTestsTable.id, entry.apiTestId))
          .for('key share');
        if (!live) entry.apiTestId = null;
      }
      if (snapshot.mobileDefinitions && entry.mobileTestId) {
        const [live] = await tx
          .select({ id: mobileTestsTable.id })
          .from(mobileTestsTable)
          .where(eq(mobileTestsTable.id, entry.mobileTestId))
          .for('key share');
        if (!live) entry.mobileTestId = null;
      }
      await tx.insert(reportTestCaseResultsTable).values(entry);
    });
  } catch (dbInsertError: unknown) {
    logger.error({
      message: 'Failed to insert into reportTestCaseResultsTable',
      entry,
      error: (dbInsertError as Error).message,
    });
  }
}

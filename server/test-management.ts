import { asc, desc, eq } from 'drizzle-orm';
import {
  reportTestCaseResults,
  testCaseLinks,
  testManagementConnections,
  testManagementPublications,
  testPlanExecutions,
  testPlans,
  type TestManagementConnection,
  type TestManagementPublication,
} from '@shared/schema';
import { outcomeOf } from '@shared/requirements';
import { caseKeyFromName, type PublishedOutcome, type TestManagementProvider } from '@shared/test-management';
import { withTenantTransaction } from './middleware/tenancy';
import { decryptSecret } from './crypto';
import { readExecutionSnapshot } from './execution-snapshot';
import { reportReferenceFor } from './report-links';
import type { ProviderDeps } from './issue-providers';
import { publishResults, type CaseResult, type ConnectionConfig } from './test-management-providers';

/**
 * Publishing a finished run to the organization's TestRail, Xray or Zephyr Scale.
 *
 * Which case each result is: the test's own link for that connection, or the key written in its
 * name ("[C123] Login"). Results of tests with neither are counted as unmapped and not sent — a
 * case the tool has never heard of would fail the whole import. Two tests on one case make one
 * result, failed if either failed.
 *
 * Every publication is recorded, whatever came of it, and nothing here throws at the caller: the
 * run already has its verdict, and a TestRail that is down must cost a line in the report, not
 * the run.
 */

export function toConnectionConfig(row: TestManagementConnection): ConnectionConfig {
  return {
    provider: row.provider as TestManagementProvider,
    baseUrl: row.baseUrl,
    username: row.username,
    token: decryptSecret(row.encryptedToken, row.tokenIv, row.tokenAuthTag),
    projectKey: row.projectKey,
    suiteId: row.suiteId,
    testPlanKey: row.testPlanKey,
  };
}

interface ResultRow {
  uiTestId: number | null;
  apiTestId: number | null;
  testName: string;
  browser: string | null;
  status: string;
  reasonForFailure: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
}

const MAX_REASON = 1000;
const OUTCOME_WORDS: Record<PublishedOutcome, string> = {
  passed: 'Passed',
  failed: 'Failed',
  pending: 'Waiting for a manual verdict',
  skipped: 'Skipped',
  notRun: 'Not run',
};

/**
 * The results of a run as cases of the tool: one per case, with every browser's status and the
 * reason for a failure in its comment, and a link back to the report.
 */
export function casesOf(
  provider: TestManagementProvider,
  rows: ResultRow[],
  linkOf: (type: 'ui' | 'api', id: number) => string | undefined,
  reportLine: string,
): { cases: CaseResult[]; unmapped: string[] } {
  const byCase = new Map<string, ResultRow[]>();
  const unmapped = new Set<string>();
  for (const row of rows) {
    const linked = row.uiTestId != null ? linkOf('ui', row.uiTestId) : row.apiTestId != null ? linkOf('api', row.apiTestId) : undefined;
    const key = linked ?? caseKeyFromName(provider, row.testName);
    if (!key) {
      unmapped.add(row.testName);
      continue;
    }
    byCase.set(key, [...(byCase.get(key) ?? []), row]);
  }

  const cases: CaseResult[] = [];
  for (const [caseKey, results] of Array.from(byCase)) {
    const outcome = outcomeOf(results.map((r) => r.status)) as PublishedOutcome;
    const lines = [`${OUTCOME_WORDS[outcome]} in WebFlowMaster.`];
    for (const r of results) {
      const where = r.browser ? ` (${r.browser})` : '';
      lines.push(`${r.testName}${where}: ${r.status}`);
      if (r.reasonForFailure && /fail|error/i.test(r.status)) {
        const reason = r.reasonForFailure.trim();
        lines.push(reason.length > MAX_REASON ? `${reason.slice(0, MAX_REASON)}… (truncated)` : reason);
      }
    }
    lines.push(reportLine);
    const starts = results.map((r) => r.startedAt?.getTime()).filter((t): t is number => t != null);
    const ends = results.map((r) => r.completedAt?.getTime()).filter((t): t is number => t != null);
    const durations = results.map((r) => r.durationMs).filter((d): d is number => d != null);
    cases.push({
      caseKey,
      outcome,
      comment: lines.join('\n'),
      startedAt: starts.length ? new Date(Math.min(...starts)) : null,
      finishedAt: ends.length ? new Date(Math.max(...ends)) : null,
      // The browsers ran side by side or one after another; the longest is the honest figure.
      durationMs: durations.length ? Math.max(...durations) : null,
    });
  }
  return { cases, unmapped: Array.from(unmapped) };
}

export interface PublishOptions {
  /** Another connection than the plan's, from the report. */
  connectionId?: string | null;
  requestedBy?: number | null;
  deps?: ProviderDeps;
}

/**
 * Publishes one run. Null when there is nowhere to publish it: the plan names no connection and
 * none was asked for.
 */
export async function publishExecution(executionId: string, options: PublishOptions = {}): Promise<TestManagementPublication | null> {
  const loaded = await withTenantTransaction(async (tx) => {
    const [execution] = await tx
      .select({
        id: testPlanExecutions.id,
        organizationId: testPlanExecutions.organizationId,
        planId: testPlanExecutions.testPlanId,
        planName: testPlans.name,
        planConnectionId: testPlans.testManagementId,
        snapshot: testPlanExecutions.configurationSnapshot,
        startedAt: testPlanExecutions.startedAt,
        completedAt: testPlanExecutions.completedAt,
        environment: testPlanExecutions.environment,
      })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlans.id, testPlanExecutions.testPlanId))
      .where(eq(testPlanExecutions.id, executionId))
      .limit(1);
    if (!execution) return null;
    // Asked for, else what the run was set to publish to, else — for a run from before runs
    // recorded it — what its plan publishes to now.
    const snapshot = readExecutionSnapshot(execution.snapshot);
    const connectionId =
      options.connectionId ?? (snapshot?.testManagement ? snapshot.testManagement.connectionId : execution.planConnectionId) ?? null;
    if (!connectionId) return null;
    const [connection] = await tx.select().from(testManagementConnections).where(eq(testManagementConnections.id, connectionId)).limit(1);
    const rows = await tx
      .select({
        uiTestId: reportTestCaseResults.uiTestId,
        apiTestId: reportTestCaseResults.apiTestId,
        testName: reportTestCaseResults.testName,
        browser: reportTestCaseResults.browser,
        status: reportTestCaseResults.status,
        reasonForFailure: reportTestCaseResults.reasonForFailure,
        startedAt: reportTestCaseResults.startedAt,
        completedAt: reportTestCaseResults.completedAt,
        durationMs: reportTestCaseResults.durationMs,
      })
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, executionId))
      .orderBy(asc(reportTestCaseResults.startedAt));
    const links = connection ? await tx.select().from(testCaseLinks).where(eq(testCaseLinks.connectionId, connection.id)) : [];
    return { execution, connection: connection ?? null, rows, links };
  });
  if (!loaded) return null;
  const { execution, connection, rows, links } = loaded;

  const record = (values: Omit<typeof testManagementPublications.$inferInsert, 'organizationId' | 'testPlanExecutionId' | 'requestedBy'>) =>
    withTenantTransaction(async (tx) => {
      const [row] = await tx
        .insert(testManagementPublications)
        .values({ ...values, organizationId: execution.organizationId, testPlanExecutionId: executionId, requestedBy: options.requestedBy ?? null })
        .returning();
      return row;
    });

  if (!connection) {
    return record({ connectionId: null, connectionName: '(deleted)', provider: 'unknown', status: 'failed', message: 'The test management connection this plan names no longer exists.' });
  }

  const provider = connection.provider as TestManagementProvider;
  const linkMap = new Map(links.map((l) => [`${l.testType}:${l.testType === 'ui' ? l.testId : l.apiTestId}`, l.caseKey]));
  const { cases, unmapped } = casesOf(provider, rows, (type, id) => linkMap.get(`${type}:${id}`), reportReferenceFor(execution.planId, executionId));
  const base = { connectionId: connection.id, connectionName: connection.name, provider, unmappedCount: unmapped.length };

  if (cases.length === 0) {
    return record({
      ...base,
      status: 'nothing_to_publish',
      message: rows.length === 0 ? 'The run has no results.' : `No test of this run is linked to a case: ${unmapped.slice(0, 10).join(', ')}${unmapped.length > 10 ? '…' : ''}.`,
    });
  }

  const title = `${execution.planName ?? 'WebFlowMaster'} — ${(execution.completedAt ?? execution.startedAt ?? new Date()).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const description = [
    `Automated run published by WebFlowMaster.`,
    execution.environment ? `Environment: ${execution.environment}` : '',
    reportReferenceFor(execution.planId, executionId),
    unmapped.length ? `Not published, no case linked: ${unmapped.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const outcome = await publishResults(
      toConnectionConfig(connection),
      { title, description, results: cases, startedAt: execution.startedAt, finishedAt: execution.completedAt },
      options.deps,
    );
    return record({
      ...base,
      status: 'published',
      externalKey: outcome.externalKey,
      externalUrl: outcome.externalUrl,
      publishedCount: outcome.published,
      message: outcome.problems.length ? outcome.problems.join('\n').slice(0, 4000) : null,
    });
  } catch (error: any) {
    return record({ ...base, status: 'failed', message: String(error?.message ?? error).slice(0, 4000) });
  }
}

/** A run's publications, newest first, for its report. */
export async function publicationsOf(executionId: string): Promise<TestManagementPublication[]> {
  return withTenantTransaction((tx) =>
    tx.select().from(testManagementPublications).where(eq(testManagementPublications.testPlanExecutionId, executionId)).orderBy(desc(testManagementPublications.createdAt), desc(testManagementPublications.id)),
  );
}

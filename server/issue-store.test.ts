import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'drizzle-orm';
import { privilegedDb } from './db';
import { issueLinks, issueTrackers } from '@shared/schema';
import { createTestOrganization, createTestUser } from './tests/factories';
import { encryptSecret } from './crypto';
import { fileFailure, markResolved, toConfig } from './issue-store';
import { runWithTenant } from './middleware/tenancy';

vi.mock('./logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * Filing a failure, once.
 *
 * The property the whole feature rests on: the second night's failure is a comment, not a
 * second issue. Everything else here is about not letting a tracker's bad day become the run's
 * — a failed filing is an outcome, never an exception.
 */

let organizationId: number;
let userId: number;
let tracker: typeof issueTrackers.$inferSelect;

const failure = {
  planId: 'plan-1',
  planName: 'Nightly',
  executionId: 'exec-1',
  testName: 'Checkout',
  browser: 'chromium',
  status: 'Failed',
  reason: 'Timed out',
};

beforeAll(async () => {
  organizationId = await createTestOrganization('Issues Org');
  userId = await createTestUser(organizationId, 'issues-user');
});

beforeEach(async () => {
  await privilegedDb.delete(issueLinks);
  await privilegedDb.delete(issueTrackers);
  // A link points at the plan and the runs it came from, so those rows have to exist here for
  // the same reason they exist in production: the foreign keys are what keep a link honest.
  await privilegedDb.execute(sql`DELETE FROM test_plan_executions`);
  await privilegedDb.execute(sql`DELETE FROM test_plans`);
  await privilegedDb.execute(
    sql`INSERT INTO test_plans (id, name, user_id, organization_id) VALUES ('plan-1', 'Nightly', ${userId}, ${organizationId})`,
  );
  for (const executionId of ['exec-1', 'exec-2', 'exec-3']) {
    await privilegedDb.execute(
      sql`INSERT INTO test_plan_executions (id, test_plan_id, organization_id, status, started_at)
          VALUES (${executionId}, 'plan-1', ${organizationId}, 'completed', ${new Date()})`,
    );
  }
  const encrypted = encryptSecret('token-123');
  const [row] = await privilegedDb
    .insert(issueTrackers)
    .values({
      id: uuidv4(),
      organizationId,
      name: 'Jira',
      provider: 'jira',
      baseUrl: 'https://acme.atlassian.net',
      projectKey: 'SHOP',
      issueType: 'Bug',
      userEmail: 'qa@acme.test',
      encryptedToken: encrypted.encryptedValue,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      createdBy: userId,
    })
    .returning();
  tracker = row;
});

/** A Jira that answers whatever the test needs it to, and records what it was asked. */
function fakeJira(overrides: { createStatus?: number; commentStatus?: number } = {}) {
  const calls: { url: string; body: any }[] = [];
  const fetchImpl = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    const isComment = String(url).includes('/comment');
    const status = isComment ? (overrides.commentStatus ?? 201) : (overrides.createStatus ?? 201);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(isComment ? { id: '1' } : { id: '10001', key: 'SHOP-412' }),
    };
  });
  return { fetchImpl, calls };
}

const inTenant = <T>(work: () => Promise<T>) => runWithTenant(organizationId, work);

describe('fileFailure', () => {
  it('files the failure and writes down which issue it became', async () => {
    const jira = fakeJira();

    const outcome = await inTenant(() => fileFailure({ organizationId, tracker, failure }, jira));

    expect(outcome).toMatchObject({ action: 'created', issueKey: 'SHOP-412' });
    const [link] = await privilegedDb.select().from(issueLinks);
    expect(link).toMatchObject({ issueKey: 'SHOP-412', testName: 'Checkout', occurrences: 1 });
  });

  it('comments on the same issue the second night instead of opening another', async () => {
    // This is the feature. Seven issues for one failing test is a board nobody reads.
    const jira = fakeJira();
    await inTenant(() => fileFailure({ organizationId, tracker, failure }, jira));

    const outcome = await inTenant(() =>
      fileFailure({ organizationId, tracker, failure: { ...failure, executionId: 'exec-2' } }, jira),
    );

    expect(outcome).toMatchObject({ action: 'commented', issueKey: 'SHOP-412', occurrences: 2 });
    expect(await privilegedDb.select().from(issueLinks)).toHaveLength(1);
    expect(jira.calls.filter((call) => call.url.endsWith('/comment'))).toHaveLength(1);
  });

  it('counts the occurrences and remembers the latest run', async () => {
    const jira = fakeJira();
    await inTenant(() => fileFailure({ organizationId, tracker, failure }, jira));
    await inTenant(() => fileFailure({ organizationId, tracker, failure: { ...failure, executionId: 'exec-2' } }, jira));
    await inTenant(() => fileFailure({ organizationId, tracker, failure: { ...failure, executionId: 'exec-3' } }, jira));

    const [link] = await privilegedDb.select().from(issueLinks);
    expect(link.occurrences).toBe(3);
  });

  it('files a different issue for a different browser', async () => {
    const jira = fakeJira();
    await inTenant(() => fileFailure({ organizationId, tracker, failure }, jira));

    await inTenant(() => fileFailure({ organizationId, tracker, failure: { ...failure, browser: 'webkit' } }, jira));

    expect(await privilegedDb.select().from(issueLinks)).toHaveLength(2);
  });

  it('reports a tracker that refused, and writes no link for an issue that does not exist', async () => {
    const jira = fakeJira({ createStatus: 403 });

    const outcome = await inTenant(() => fileFailure({ organizationId, tracker, failure }, jira));

    expect(outcome.action).toBe('failed');
    expect(outcome.error).toContain('403');
    expect(await privilegedDb.select().from(issueLinks)).toHaveLength(0);
  });

  it('never throws, whatever the tracker does', async () => {
    // The caller is a run whose verdict is already written. An exception here would turn a
    // recorded result into a crashed job.
    const fetchImpl = vi.fn().mockRejectedValue(new Error('socket hang up'));

    const outcome = await inTenant(() => fileFailure({ organizationId, tracker, failure }, { fetchImpl }));

    expect(outcome.action).toBe('failed');
  });
});

describe('markResolved', () => {
  it('says on the issue that the test passed again', async () => {
    const jira = fakeJira();
    await inTenant(() => fileFailure({ organizationId, tracker, failure }, jira));

    const outcome = await inTenant(() =>
      markResolved({ tracker, failure: { ...failure, status: 'Passed', executionId: 'exec-2' } }, jira),
    );

    expect(outcome.action).toBe('commented');
    const [link] = await privilegedDb.select().from(issueLinks);
    expect(link.resolvedAt).not.toBeNull();
  });

  it('says nothing when nothing was ever filed', async () => {
    const jira = fakeJira();

    const outcome = await inTenant(() => markResolved({ tracker, failure }, jira));

    expect(outcome.action).toBe('skipped');
    expect(jira.calls).toHaveLength(0);
  });

  it('does not repeat itself on every later green run', async () => {
    const jira = fakeJira();
    await inTenant(() => fileFailure({ organizationId, tracker, failure }, jira));
    await inTenant(() => markResolved({ tracker, failure }, jira));

    const second = await inTenant(() => markResolved({ tracker, failure }, jira));

    expect(second.action).toBe('skipped');
  });

  it('re-opens the count when it fails again after passing', async () => {
    const jira = fakeJira();
    await inTenant(() => fileFailure({ organizationId, tracker, failure }, jira));
    await inTenant(() => markResolved({ tracker, failure }, jira));

    await inTenant(() => fileFailure({ organizationId, tracker, failure: { ...failure, executionId: 'exec-3' } }, jira));

    const [link] = await privilegedDb.select().from(issueLinks);
    expect(link.resolvedAt).toBeNull();
    expect(link.occurrences).toBe(2);
  });
});

describe('toConfig', () => {
  it('hands the provider the token in the clear, and nothing else does', () => {
    expect(toConfig(tracker).token).toBe('token-123');
  });
});

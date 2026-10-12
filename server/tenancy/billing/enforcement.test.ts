import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../../db';
import {
  organizationSubscriptions,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  tests as testsTable,
  users,
} from '@shared/schema';
import type { SubscriptionStatus } from '@shared/billing';
import { createTestOrganization } from '../../tests/factories';
import { runWithTenant, withTenantTransaction } from '../../middleware/tenancy';

vi.mock('../../queue', () => ({
  TEST_EXECUTION_QUEUE_NAME: 'test-queue',
  testExecutionQueue: {
    add: async (_n: string, _d: unknown, o: { jobId: string }) => ({ id: o.jobId }),
  },
}));

const { createExecutionOrchestrator } = await import('../../execution/execution-orchestrator');
const { beginExecutionUsage } = await import('../execution-usage');
const { changeSubscription } = await import('./service');
const { assertSubscriptionAllowsRuns, SubscriptionSuspendedError } = await import('./enforcement');
const { quotaErrorBody, quotaErrorStatus } = await import('../tenant-quotas');

/**
 * Where a subscription says no: at the orchestrator, which every plan run passes through, and at
 * beginExecutionUsage, which every direct execution passes through. And where it never does.
 */

let organizationId: number;
let userId: number;
let planId: string;

const queue = () => ({
  async add(_name: string, _data: Record<string, unknown>, options: { jobId: string }) {
    return { id: options.jobId };
  },
});

async function setStatus(status: SubscriptionStatus, pastDueSince?: Date) {
  await changeSubscription(
    organizationId,
    { status },
    {
      source: 'manual',
      provider: 'manual',
      type: 'test',
      idempotencyKey: `enforce-${organizationId}-${status}-${uuidv4()}`,
      actor: null,
      now: pastDueSince ?? new Date(),
    },
  );
}

beforeEach(async () => {
  organizationId = await createTestOrganization('Enforced');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `enforce-${uuidv4().slice(0, 8)}`, password: 'x', organizationId })
    .returning();
  userId = user.id;
  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({
    id: planId,
    name: 'Plan',
    userId,
    organizationId,
    maxParallelTests: 1,
    visualTestingEnabled: false,
  } as never);
  const [test] = await privilegedDb
    .insert(testsTable)
    .values({
      userId,
      organizationId,
      name: 'one',
      url: 'https://example.test',
      sequence: [],
      elements: [],
    })
    .returning();
  await privilegedDb
    .insert(testPlanSelectedTests)
    .values({ testPlanId: planId, testType: 'ui', testId: test.id, organizationId } as never);
});
afterEach(() => vi.unstubAllEnvs());

const enqueue = () =>
  createExecutionOrchestrator(queue()).enqueue({
    planId,
    requestedByUserId: userId,
    trigger: 'manual',
  });

describe('starting a plan run', () => {
  it.each(['active', 'trialing'] as const)('is allowed while %s', async (status) => {
    await setStatus(status);
    const run = await enqueue();
    expect(run.status).toBe('queued');
  });

  it.each(['suspended', 'cancelled'] as const)(
    'is refused with 402 subscription_suspended while %s',
    async (status) => {
      await setStatus(status);
      const error = await enqueue().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SubscriptionSuspendedError);
      expect(quotaErrorStatus(error)).toBe(402);
      expect(quotaErrorBody(error)).toMatchObject({ code: 'subscription_suspended', status });
      expect(
        await privilegedDb
          .select()
          .from(testPlanExecutions)
          .where(eq(testPlanExecutions.organizationId, organizationId)),
      ).toHaveLength(0);
    },
  );

  it('is allowed while past_due within the grace period, and refused once it has run out', async () => {
    vi.stubEnv('BILLING_PAST_DUE_GRACE_DAYS', '7');
    await setStatus('past_due', new Date(Date.now() - 2 * 24 * 60 * 60_000));
    expect((await enqueue()).status).toBe('queued');
    await privilegedDb
      .update(organizationSubscriptions)
      .set({ pastDueSince: new Date(Date.now() - 8 * 24 * 60 * 60_000) })
      .where(eq(organizationSubscriptions.organizationId, organizationId));
    await expect(enqueue()).rejects.toMatchObject({ code: 'subscription_suspended', status: 402 });
    vi.stubEnv('BILLING_PAST_DUE_GRACE_DAYS', '30');
    expect((await enqueue()).status).toBe('queued');
  });
});

describe('a direct execution', () => {
  it('is refused at beginExecutionUsage while suspended, except for a shard of an admitted run', async () => {
    await setStatus('suspended');
    const begin = (kind: 'browser' | 'shard') =>
      runWithTenant(organizationId, () =>
        withTenantTransaction((tx) => beginExecutionUsage(tx, organizationId, kind, uuidv4())),
      );
    await expect(begin('browser')).rejects.toMatchObject({ code: 'subscription_suspended' });
    await expect(begin('shard')).resolves.toBeUndefined();
  });

  it('the check itself passes for an organization with no subscription row at all', async () => {
    await privilegedDb
      .delete(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, organizationId));
    await expect(
      runWithTenant(organizationId, () =>
        withTenantTransaction((tx) => assertSubscriptionAllowsRuns(tx, organizationId)),
      ),
    ).resolves.toBeUndefined();
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { organizations, testPlanExecutions, testPlans } from '@shared/schema';
import { privilegedDb, SESSION_TIME_ZONE } from './db';
import { createTestOrganization, createTestUser } from './tests/factories';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { transitionExecution } from './execution-state';

/**
 * The database and the application agree on what time it is.
 *
 * The timestamp columns carry no time zone and two things write them: the application, in UTC,
 * and the database's own `now()` for every defaulted column, in whatever zone the session is in.
 * The test database's session was an hour ahead, so a run's queued_at — a default — landed an
 * hour after its started_at, written by the worker. Nothing compared the two until the lifecycle
 * did.
 */

/** Close enough to be the same moment, far enough apart to survive a slow machine. */
const SAME_MOMENT_MS = 5_000;

let organizationId: number;
let userId: number;
const planId = 'time-zone-plan';

beforeAll(async () => {
  organizationId = await createTestOrganization('Time zone org');
  userId = await createTestUser(organizationId, 'time-zone-user');
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Time zone plan', userId, organizationId });
});

describe('the database session', () => {
  it('is on UTC', async () => {
    const result = await privilegedDb.execute(sql`select current_setting('TimeZone') as zone`);

    expect((result.rows[0] as { zone: string }).zone).toBe(SESSION_TIME_ZONE);
  });

  it('is still on UTC inside a tenant transaction, where every request runs', async () => {
    // withTenantTransaction switches role for the transaction; a setting that did not survive
    // that switch would leave every request-path default on the old zone.
    const zone = await runWithTenant(organizationId, () =>
      withTenantTransaction(async (tx) => {
        const result = await tx.execute(sql`select current_setting('TimeZone') as zone`);
        return (result.rows[0] as { zone: string }).zone;
      }),
    );

    expect(zone).toBe(SESSION_TIME_ZONE);
  });
});

describe('a column the database fills in', () => {
  it('records the same moment the application would have', async () => {
    const before = Date.now();
    const id = await createTestOrganization('Defaulted timestamp org');

    const [row] = await privilegedDb.select().from(organizations).where(eq(organizations.id, id));

    expect(Math.abs(row.createdAt.getTime() - before)).toBeLessThan(SAME_MOMENT_MS);
  });

  it('puts a run’s queued time before its start time, whichever side wrote which', async () => {
    // The case that surfaced this: queued_at left to the default, started_at written by the
    // worker. Before the fix the run started an hour before anyone asked for it.
    const id = 'time-zone-execution';
    await privilegedDb.insert(testPlanExecutions).values({ id, testPlanId: planId, organizationId, status: 'queued' });

    const started = await runWithTenant(organizationId, () => transitionExecution(id, 'running'));

    expect(started).not.toBeNull();
    expect(started!.startedAt!.getTime()).toBeGreaterThanOrEqual(started!.queuedAt.getTime());
    expect(started!.startedAt!.getTime() - started!.queuedAt.getTime()).toBeLessThan(SAME_MOMENT_MS);
  });
});

import { sql } from 'drizzle-orm';
import {
  apiTests,
  environments,
  projects,
  secrets,
  stepGroups,
  testPlanSchedules,
  testPlans,
  tests,
} from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';

/**
 * What happens to what a member made when the member is removed.
 *
 * Removing a person used to delete, through ON DELETE CASCADE, the environments (with their
 * secrets), API tests and schedules they had created — the organization's credentials and
 * schedules gone because somebody left — and to fail outright for anyone who had created a project,
 * a test, a plan or a step group. Neither is what removing a person means. What a member creates
 * belongs to the organization; the person's account is the only thing that should go.
 *
 * So before the account is deleted, everything it created is handed to another member of the same
 * organization: the owner removing them, unless the request names someone else. The `user_id` of
 * these rows is still read as "whose" in places (a plan's schedules run on behalf of its creator,
 * the API tester lists a person's own tests), which is why the rows get a new owner rather than a
 * null one.
 *
 * What is genuinely the person's goes with them, through the constraints (migration 0040): their
 * preferences, second factor, API keys, project memberships and API tester history. The audit
 * trail keeps their name. A table added later that references users and is in neither list fails
 * the removal with a foreign key error, and the test in member-removal.test.ts fails before that:
 * it checks every constraint on users against this list.
 */
export const TRANSFERRED_ON_REMOVAL = [
  { table: projects, name: 'projects' },
  { table: tests, name: 'tests' },
  { table: apiTests, name: 'api_tests' },
  { table: testPlans, name: 'test_plans' },
  { table: testPlanSchedules, name: 'test_plan_schedules' },
  { table: stepGroups, name: 'step_groups' },
  { table: environments, name: 'environments' },
  { table: secrets, name: 'secrets' },
] as const;

export type TransferCounts = Record<(typeof TRANSFERRED_ON_REMOVAL)[number]['name'], number>;

/**
 * Hands every row `fromUserId` created to `toUserId`, inside the caller's tenant transaction.
 *
 * Both must be members of `organizationId`; the caller checks that. Every statement also carries
 * the organization predicate, on top of the row policies, so a wrong id can only ever move this
 * organization's rows.
 */
export async function transferMemberContent(
  tx: TenantTx,
  organizationId: number,
  fromUserId: number,
  toUserId: number,
): Promise<TransferCounts> {
  const counts = {} as TransferCounts;
  for (const { table, name } of TRANSFERRED_ON_REMOVAL) {
    // SQL rather than the update builder: TenantTx is a union over two drivers, and the builder's
    // overloads collapse across it (see organization.routes.ts). The columns are the table's own.
    const moved = await tx.execute(sql`
      UPDATE ${table} SET ${sql.identifier('user_id')} = ${toUserId}
      WHERE ${table.userId} = ${fromUserId} AND ${table.organizationId} = ${organizationId}
      RETURNING 1
    `);
    counts[name] = moved.rows.length;
  }
  return counts;
}

import { sql } from 'drizzle-orm';
import {
  apiKeys,
  apiTestHistory,
  apiTests,
  dashboards,
  environments,
  passwordResets,
  projectMembers,
  projects,
  secrets,
  stepGroups,
  customActions,
  testPlanSchedules,
  testPlans,
  tests,
  userDashboardLayouts,
  userDashboardPreferences,
} from '@shared/schema';
import type { TenantTx } from '../platform/middleware/tenancy';

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
  { table: customActions, name: 'custom_actions' },
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

/**
 * What is the person's *in this organization* and goes when they leave it while their account
 * stays (a member of several organizations, migration 0086): the rows the constraints above would
 * cascade on the account, restricted to the organization being left. API keys of another
 * organization, or their second factor, are not this organization's to touch. Every table here is
 * org-scoped, so the policy restricts the delete as well as the predicate does.
 */
export const PERSONAL_IN_ORGANIZATION = [
  { table: apiKeys, column: apiKeys.userId, name: 'api_keys' },
  { table: projectMembers, column: projectMembers.userId, name: 'project_members' },
  { table: passwordResets, column: passwordResets.userId, name: 'password_resets' },
  { table: apiTestHistory, column: apiTestHistory.userId, name: 'api_test_history' },
  {
    table: userDashboardLayouts,
    column: userDashboardLayouts.userId,
    name: 'user_dashboard_layouts',
  },
  {
    table: userDashboardPreferences,
    column: userDashboardPreferences.userId,
    name: 'user_dashboard_preferences',
  },
  { table: dashboards, column: dashboards.creatorId, name: 'dashboards' },
] as const;

/** Deletes the person's own rows of one organization, inside the caller's tenant transaction. */
export async function removePersonalRowsInOrganization(
  tx: TenantTx,
  organizationId: number,
  userId: number,
): Promise<void> {
  for (const { table, column } of PERSONAL_IN_ORGANIZATION) {
    await tx.execute(sql`
      DELETE FROM ${table}
      WHERE ${column} = ${userId} AND ${table.organizationId} = ${organizationId}
    `);
  }
}

-- Removing a member (DELETE /api/organization/members/:userId) did two wrong things, depending on
-- what the member had made:
--
-- - environments, their secrets, API tests and schedules referenced the member ON DELETE CASCADE,
--   so removing a person silently deleted the organization's environments, credentials, API tests
--   and schedules that person had created;
-- - projects, tests, plans, step groups and user_settings referenced the member with no action, so
--   removing anyone who had created one of those, or saved a preference, failed with a foreign key
--   error.
--
-- What a member creates belongs to the organization, not to the person. The route now hands it to
-- another member before deleting the account (server/member-removal.ts). These constraints are the
-- other half: organization data can never again be deleted because a person was, and a table the
-- transfer forgets makes the removal fail rather than lose rows. What is genuinely the person's
-- own goes with them: their preferences here, and (already) their second factor, API keys, project
-- memberships and API tester history.

ALTER TABLE "environments" DROP CONSTRAINT "environments_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "secrets" DROP CONSTRAINT "secrets_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "api_tests" DROP CONSTRAINT "api_tests_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "api_tests" ADD CONSTRAINT "api_tests_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "test_plan_schedules" DROP CONSTRAINT "test_plan_schedules_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "test_plan_schedules" ADD CONSTRAINT "test_plan_schedules_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION;
--> statement-breakpoint

-- A person's own preferences. app_user holds no grant on user_settings (0006), so the route could
-- not delete the row itself; the cascade runs as the table's owner.
ALTER TABLE "user_settings" DROP CONSTRAINT "user_settings_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Who sent an invitation is provenance, like an audit entry's actor: kept while the person exists,
-- forgotten when they do not. app_user cannot update invitations (0008), which is why this is the
-- constraint's job rather than the route's.
ALTER TABLE "invitations" ALTER COLUMN "invited_by_user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_invited_by_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_fkey"
  FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;

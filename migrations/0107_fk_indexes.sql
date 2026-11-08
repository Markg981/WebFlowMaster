-- Indexes for the foreign keys that parent deletes and project/test lookups walk (audit finding B-07).
-- Chosen from scripts/db/fk-index-audit.mjs: FK columns with no leading index, on ON DELETE CASCADE /
-- SET NULL paths of tests, api_tests, projects, tags, browser_grids and executions, or filtered by
-- project. Plain CREATE INDEX (not CONCURRENTLY): the migrator runs each file in a transaction.
CREATE INDEX IF NOT EXISTS "test_suite_items_test_id_idx" ON "test_suite_items" ("test_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_suite_items_api_test_id_idx" ON "test_suite_items" ("api_test_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_case_links_test_id_idx" ON "test_case_links" ("test_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_case_links_api_test_id_idx" ON "test_case_links" ("api_test_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_publications_api_test_id_idx" ON "test_publications" ("api_test_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "impact_rules_tag_id_idx" ON "impact_rules" ("tag_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bdd_execution_profiles_project_id_idx" ON "bdd_execution_profiles" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_suites_project_id_idx" ON "test_suites" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_tests_project_id_idx" ON "mobile_tests" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_plans_browser_grid_id_idx" ON "test_plans" ("browser_grid_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_links_ui_test_id_idx" ON "issue_links" ("ui_test_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_links_first_execution_id_idx" ON "issue_links" ("first_execution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "healing_proposals_project_id_idx" ON "healing_proposals" ("project_id");

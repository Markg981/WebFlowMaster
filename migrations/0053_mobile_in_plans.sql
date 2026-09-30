-- Mobile app tests in plans (shared/mobile.ts): a plan can include them beside web and API tests,
-- and each run records their results like any other.
--
-- A mobile test runs on a device of a cloud grid, not in the plan's browsers, so it names the grid
-- it runs on itself; a plan run uses that grid for it, whatever the plan's "run on" says.
ALTER TABLE "mobile_tests" ADD COLUMN "grid_id" text REFERENCES "browser_grids"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "test_plan_selected_tests" ADD COLUMN "mobile_test_id" integer REFERENCES "mobile_tests"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "test_plan_selected_tests_mobile_test_id_idx" ON "test_plan_selected_tests" ("mobile_test_id");
--> statement-breakpoint
ALTER TABLE "report_test_case_results" ADD COLUMN "mobile_test_id" integer REFERENCES "mobile_tests"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Every link stays inside one organization, whoever writes it (see 0034).
ALTER TABLE "mobile_tests" ADD CONSTRAINT "mobile_tests_grid_id_same_org_fk" FOREIGN KEY ("grid_id", "organization_id") REFERENCES "browser_grids" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "test_plan_selected_tests" ADD CONSTRAINT "test_plan_selected_tests_mobile_test_id_same_org_fk" FOREIGN KEY ("mobile_test_id", "organization_id") REFERENCES "mobile_tests" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "report_test_case_results" ADD CONSTRAINT "report_test_case_results_mobile_test_id_same_org_fk" FOREIGN KEY ("mobile_test_id", "organization_id") REFERENCES "mobile_tests" ("id", "organization_id");

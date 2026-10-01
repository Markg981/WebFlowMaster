-- A mobile app test in a restricted project is the project's, like a web or an API test (0031):
-- seen by its members only, changed only by those who may edit there. mobile_tests.project_id has
-- been there since 0052, with nothing choosing it and no policy reading it.
CREATE POLICY project_read ON "mobile_tests" AS RESTRICTIVE FOR SELECT USING (app_project_visible(project_id));
--> statement-breakpoint
CREATE POLICY project_insert ON "mobile_tests" AS RESTRICTIVE FOR INSERT WITH CHECK (app_project_editable(project_id));
--> statement-breakpoint
CREATE POLICY project_update ON "mobile_tests" AS RESTRICTIVE FOR UPDATE USING (app_project_editable(project_id)) WITH CHECK (app_project_editable(project_id));
--> statement-breakpoint
CREATE POLICY project_delete ON "mobile_tests" AS RESTRICTIVE FOR DELETE USING (app_project_editable(project_id));
--> statement-breakpoint
-- A test's runs are the test: their steps and screenshots show its app and its screens.
CREATE POLICY project_read ON "mobile_test_runs" AS RESTRICTIVE FOR SELECT
  USING (app_test_visible(NULL, NULL, mobile_test_id));
--> statement-breakpoint
CREATE POLICY project_insert ON "mobile_test_runs" AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_test_editable(NULL, NULL, mobile_test_id));
--> statement-breakpoint
CREATE POLICY project_update ON "mobile_test_runs" AS RESTRICTIVE FOR UPDATE
  USING (app_test_editable(NULL, NULL, mobile_test_id))
  WITH CHECK (app_test_editable(NULL, NULL, mobile_test_id));
--> statement-breakpoint
CREATE POLICY project_delete ON "mobile_test_runs" AS RESTRICTIVE FOR DELETE
  USING (app_test_editable(NULL, NULL, mobile_test_id));

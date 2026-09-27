-- A tag on a test in a restricted project is the test's, like its quarantine (migration 0035).
--
-- test_tags was left with the organization's policy alone, so a member who is only a viewer on a
-- restricted project could still change what its tests carry from the library — and since a
-- dynamic suite runs whatever carries its tags, that is changing which plans run the test. The
-- assignment route only checked that the test was visible, which a viewer's test is.
--
-- The functions of migration 0035 already say it: seen when the test is, changed when its
-- project can be.
CREATE POLICY project_read ON "test_tags" AS RESTRICTIVE FOR SELECT
  USING (app_quarantine_visible(test_id, api_test_id));
--> statement-breakpoint
CREATE POLICY project_insert ON "test_tags" AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_quarantine_editable(test_id, api_test_id));
--> statement-breakpoint
CREATE POLICY project_update ON "test_tags" AS RESTRICTIVE FOR UPDATE
  USING (app_quarantine_editable(test_id, api_test_id))
  WITH CHECK (app_quarantine_editable(test_id, api_test_id));
--> statement-breakpoint
CREATE POLICY project_delete ON "test_tags" AS RESTRICTIVE FOR DELETE
  USING (app_quarantine_editable(test_id, api_test_id));

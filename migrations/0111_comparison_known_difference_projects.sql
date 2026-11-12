-- A known difference of a restricted project is the project's own (migration 0031), as its tests
-- are: a caller outside the project neither sees it nor saves one there, and changing one is an
-- edit of the project. A known difference of the whole organization (project_id NULL) stays open.
CREATE POLICY project_read ON comparison_known_differences AS RESTRICTIVE FOR SELECT
  USING (app_project_visible(project_id));
--> statement-breakpoint
CREATE POLICY project_insert ON comparison_known_differences AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_project_editable(project_id));
--> statement-breakpoint
CREATE POLICY project_update ON comparison_known_differences AS RESTRICTIVE FOR UPDATE
  USING (app_project_editable(project_id)) WITH CHECK (app_project_editable(project_id));
--> statement-breakpoint
CREATE POLICY project_delete ON comparison_known_differences AS RESTRICTIVE FOR DELETE
  USING (app_project_editable(project_id));

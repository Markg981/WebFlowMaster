-- Tags on mobile app tests (shared/mobile.ts), like on web and API tests (0018): a tag names what a
-- test is for, and a dynamic suite runs whatever carries its tags — mobile tests included now.
ALTER TABLE "test_tags" ADD COLUMN "mobile_test_id" integer REFERENCES "mobile_tests"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "test_tags" DROP CONSTRAINT "test_tags_one_target";
--> statement-breakpoint
ALTER TABLE "test_tags" ADD CONSTRAINT "test_tags_one_target" CHECK (
  ("test_id" IS NOT NULL AND "api_test_id" IS NULL AND "mobile_test_id" IS NULL)
  OR ("test_id" IS NULL AND "api_test_id" IS NOT NULL AND "mobile_test_id" IS NULL)
  OR ("test_id" IS NULL AND "api_test_id" IS NULL AND "mobile_test_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "test_tags_mobile_unique" ON "test_tags" ("tag_id", "mobile_test_id") WHERE "mobile_test_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "test_tags_mobile_test_id_idx" ON "test_tags" ("mobile_test_id");
--> statement-breakpoint
ALTER TABLE "test_tags" ADD CONSTRAINT "test_tags_mobile_test_id_same_org_fk" FOREIGN KEY ("mobile_test_id", "organization_id") REFERENCES "mobile_tests" ("id", "organization_id");
--> statement-breakpoint
-- Seen when the test is, changed when its project can be (0035, 0045) — for any of the three kinds.
-- A row of a mobile test named neither of the two ids the old functions read, so under them it
-- could be neither seen nor written.
CREATE FUNCTION app_test_visible(p_test_id integer, p_api_test_id integer, p_mobile_test_id integer) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM tests WHERE id = p_test_id)
        OR EXISTS (SELECT 1 FROM api_tests WHERE id = p_api_test_id)
        OR EXISTS (SELECT 1 FROM mobile_tests WHERE id = p_mobile_test_id)
$$;
--> statement-breakpoint
CREATE FUNCTION app_test_editable(p_test_id integer, p_api_test_id integer, p_mobile_test_id integer) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT app_test_visible(p_test_id, p_api_test_id, p_mobile_test_id)
       AND app_project_editable(COALESCE(
             (SELECT project_id FROM tests WHERE id = p_test_id),
             (SELECT project_id FROM api_tests WHERE id = p_api_test_id),
             (SELECT project_id FROM mobile_tests WHERE id = p_mobile_test_id)))
$$;
--> statement-breakpoint
DROP POLICY project_read ON "test_tags";
--> statement-breakpoint
DROP POLICY project_insert ON "test_tags";
--> statement-breakpoint
DROP POLICY project_update ON "test_tags";
--> statement-breakpoint
DROP POLICY project_delete ON "test_tags";
--> statement-breakpoint
CREATE POLICY project_read ON "test_tags" AS RESTRICTIVE FOR SELECT
  USING (app_test_visible(test_id, api_test_id, mobile_test_id));
--> statement-breakpoint
CREATE POLICY project_insert ON "test_tags" AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_test_editable(test_id, api_test_id, mobile_test_id));
--> statement-breakpoint
CREATE POLICY project_update ON "test_tags" AS RESTRICTIVE FOR UPDATE
  USING (app_test_editable(test_id, api_test_id, mobile_test_id))
  WITH CHECK (app_test_editable(test_id, api_test_id, mobile_test_id));
--> statement-breakpoint
CREATE POLICY project_delete ON "test_tags" AS RESTRICTIVE FOR DELETE
  USING (app_test_editable(test_id, api_test_id, mobile_test_id));

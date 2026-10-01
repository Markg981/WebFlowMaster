-- Quarantine for mobile app tests (0035): a mobile test set aside still runs and is still recorded;
-- its failure does not fail the run. One open quarantine per test, as for the other kinds.
ALTER TABLE "test_quarantines" ADD COLUMN "mobile_test_id" integer REFERENCES "mobile_tests"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "test_quarantines" DROP CONSTRAINT "test_quarantines_one_test";
--> statement-breakpoint
ALTER TABLE "test_quarantines" ADD CONSTRAINT "test_quarantines_one_test" CHECK (
  ("test_type" = 'ui' AND "test_id" IS NOT NULL AND "api_test_id" IS NULL AND "mobile_test_id" IS NULL)
  OR ("test_type" = 'api' AND "api_test_id" IS NOT NULL AND "test_id" IS NULL AND "mobile_test_id" IS NULL)
  OR ("test_type" = 'mobile' AND "mobile_test_id" IS NOT NULL AND "test_id" IS NULL AND "api_test_id" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "test_quarantines_open_mobile_unique" ON "test_quarantines" ("mobile_test_id") WHERE "released_at" IS NULL AND "mobile_test_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_quarantines" ADD CONSTRAINT "test_quarantines_mobile_test_id_same_org_fk" FOREIGN KEY ("mobile_test_id", "organization_id") REFERENCES "mobile_tests" ("id", "organization_id");
--> statement-breakpoint
-- Seen and changed with the test, for any of the three kinds (0056's functions).
DROP POLICY project_read ON "test_quarantines";
--> statement-breakpoint
DROP POLICY project_insert ON "test_quarantines";
--> statement-breakpoint
DROP POLICY project_update ON "test_quarantines";
--> statement-breakpoint
CREATE POLICY project_read ON "test_quarantines" AS RESTRICTIVE FOR SELECT
  USING (app_test_visible(test_id, api_test_id, mobile_test_id));
--> statement-breakpoint
CREATE POLICY project_insert ON "test_quarantines" AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_test_editable(test_id, api_test_id, mobile_test_id));
--> statement-breakpoint
CREATE POLICY project_update ON "test_quarantines" AS RESTRICTIVE FOR UPDATE
  USING (app_test_editable(test_id, api_test_id, mobile_test_id))
  WITH CHECK (app_test_editable(test_id, api_test_id, mobile_test_id));

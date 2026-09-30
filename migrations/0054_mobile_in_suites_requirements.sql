-- Mobile app tests (shared/mobile.ts) in static suites, as a requirement's coverage and linked to a
-- test management case, like web and API tests (0034, 0050, 0051). Each link names exactly one
-- test, of the type it says; a test is in a suite, a requirement or a connection once.
ALTER TABLE "test_suite_items" ADD COLUMN "mobile_test_id" integer REFERENCES "mobile_tests"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "test_suite_items" DROP CONSTRAINT "test_suite_items_one_test";
--> statement-breakpoint
ALTER TABLE "test_suite_items" ADD CONSTRAINT "test_suite_items_one_test" CHECK (
  ("test_type" = 'ui' AND "test_id" IS NOT NULL AND "api_test_id" IS NULL AND "mobile_test_id" IS NULL)
  OR ("test_type" = 'api' AND "api_test_id" IS NOT NULL AND "test_id" IS NULL AND "mobile_test_id" IS NULL)
  OR ("test_type" = 'mobile' AND "mobile_test_id" IS NOT NULL AND "test_id" IS NULL AND "api_test_id" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "test_suite_items_suite_mobile_unique" ON "test_suite_items" ("suite_id", "mobile_test_id") WHERE "mobile_test_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "requirement_tests" ADD COLUMN "mobile_test_id" integer REFERENCES "mobile_tests"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "requirement_tests" DROP CONSTRAINT "requirement_tests_one_test";
--> statement-breakpoint
ALTER TABLE "requirement_tests" ADD CONSTRAINT "requirement_tests_one_test" CHECK (
  ("test_type" = 'ui' AND "test_id" IS NOT NULL AND "api_test_id" IS NULL AND "mobile_test_id" IS NULL)
  OR ("test_type" = 'api' AND "api_test_id" IS NOT NULL AND "test_id" IS NULL AND "mobile_test_id" IS NULL)
  OR ("test_type" = 'mobile' AND "mobile_test_id" IS NOT NULL AND "test_id" IS NULL AND "api_test_id" IS NULL)
);
--> statement-breakpoint
CREATE INDEX "requirement_tests_mobile_test_id_idx" ON "requirement_tests" ("mobile_test_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_tests_mobile_unique" ON "requirement_tests" ("requirement_id", "mobile_test_id") WHERE "mobile_test_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_case_links" ADD COLUMN "mobile_test_id" integer REFERENCES "mobile_tests"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "test_case_links" DROP CONSTRAINT "test_case_links_one_test";
--> statement-breakpoint
ALTER TABLE "test_case_links" ADD CONSTRAINT "test_case_links_one_test" CHECK (
  ("test_type" = 'ui' AND "test_id" IS NOT NULL AND "api_test_id" IS NULL AND "mobile_test_id" IS NULL)
  OR ("test_type" = 'api' AND "api_test_id" IS NOT NULL AND "test_id" IS NULL AND "mobile_test_id" IS NULL)
  OR ("test_type" = 'mobile' AND "mobile_test_id" IS NOT NULL AND "test_id" IS NULL AND "api_test_id" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "test_case_links_mobile_unique" ON "test_case_links" ("connection_id", "mobile_test_id") WHERE "mobile_test_id" IS NOT NULL;
--> statement-breakpoint
-- A report row's mobile test, for a requirement's latest outcome (0053 added the column).
CREATE INDEX "report_test_case_results_mobile_test_id_idx" ON "report_test_case_results" ("mobile_test_id");
--> statement-breakpoint
-- Every link stays inside one organization, whoever writes it (see 0034).
ALTER TABLE "test_suite_items" ADD CONSTRAINT "test_suite_items_mobile_test_id_same_org_fk" FOREIGN KEY ("mobile_test_id", "organization_id") REFERENCES "mobile_tests" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "requirement_tests" ADD CONSTRAINT "requirement_tests_mobile_test_id_same_org_fk" FOREIGN KEY ("mobile_test_id", "organization_id") REFERENCES "mobile_tests" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "test_case_links" ADD CONSTRAINT "test_case_links_mobile_test_id_same_org_fk" FOREIGN KEY ("mobile_test_id", "organization_id") REFERENCES "mobile_tests" ("id", "organization_id");

-- Requirements, and which tests cover them (shared/requirements.ts).
--
-- QA teams are asked "is story SHOP-142 tested, and does it pass?" and the answer was in nobody's
-- data: a test knew its steps, a run knew its results, and neither knew what it was for. A
-- requirement is an epic, a user story or a plain requirement — typed in, or imported from the
-- organization's Jira or Azure DevOps — and the tests linked to it are its coverage. Its state is
-- worked out from the latest result of each of those tests, never stored.
CREATE TABLE "requirements" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  -- SHOP-142, 4711, or a key of the organization's own choosing (REQ-12).
  "key" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  -- 'epic' | 'story' | 'requirement'.
  "kind" text DEFAULT 'story' NOT NULL,
  -- The epic of a story. A requirement deleted leaves its children without one.
  "parent_id" integer REFERENCES "requirements"("id") ON DELETE SET NULL,
  -- Where it was imported from, and what the tracker says of it; null for one typed in.
  "tracker_id" text REFERENCES "issue_trackers"("id") ON DELETE SET NULL,
  "url" text,
  "external_type" text,
  "external_status" text,
  "synced_at" timestamp,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "requirements_kind_known" CHECK ("kind" IN ('epic', 'story', 'requirement')),
  CONSTRAINT "requirements_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  CONSTRAINT "requirements_id_organization_unique" UNIQUE ("id", "organization_id")
);
--> statement-breakpoint
CREATE INDEX "requirements_organization_id_idx" ON "requirements" ("organization_id");
--> statement-breakpoint
CREATE INDEX "requirements_parent_id_idx" ON "requirements" ("parent_id");
--> statement-breakpoint
-- One requirement per key: importing SHOP-142 twice updates it.
CREATE UNIQUE INDEX "requirements_organization_key_unique" ON "requirements" ("organization_id", lower("key"));
--> statement-breakpoint
CREATE TABLE "requirement_tests" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "requirement_id" integer NOT NULL REFERENCES "requirements"("id") ON DELETE CASCADE,
  "test_type" text NOT NULL,
  "test_id" integer REFERENCES "tests"("id") ON DELETE CASCADE,
  "api_test_id" integer REFERENCES "api_tests"("id") ON DELETE CASCADE,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "requirement_tests_one_test" CHECK (
    ("test_type" = 'ui' AND "test_id" IS NOT NULL AND "api_test_id" IS NULL)
    OR ("test_type" = 'api' AND "api_test_id" IS NOT NULL AND "test_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "requirement_tests_requirement_id_idx" ON "requirement_tests" ("requirement_id");
--> statement-breakpoint
CREATE INDEX "requirement_tests_test_id_idx" ON "requirement_tests" ("test_id");
--> statement-breakpoint
CREATE INDEX "requirement_tests_api_test_id_idx" ON "requirement_tests" ("api_test_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_tests_ui_unique" ON "requirement_tests" ("requirement_id", "test_id") WHERE "test_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_tests_api_unique" ON "requirement_tests" ("requirement_id", "api_test_id") WHERE "api_test_id" IS NOT NULL;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['requirements', 'requirement_tests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
      WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_user', t);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "requirements_id_seq" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "requirement_tests_id_seq" TO app_user;
--> statement-breakpoint
-- Every link stays inside one organization, whoever writes it (see 0034).
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_parent_id_same_org_fk" FOREIGN KEY ("parent_id", "organization_id") REFERENCES "requirements" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_tracker_id_same_org_fk" FOREIGN KEY ("tracker_id", "organization_id") REFERENCES "issue_trackers" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "requirement_tests" ADD CONSTRAINT "requirement_tests_requirement_id_same_org_fk" FOREIGN KEY ("requirement_id", "organization_id") REFERENCES "requirements" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "requirement_tests" ADD CONSTRAINT "requirement_tests_test_id_same_org_fk" FOREIGN KEY ("test_id", "organization_id") REFERENCES "tests" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "requirement_tests" ADD CONSTRAINT "requirement_tests_api_test_id_same_org_fk" FOREIGN KEY ("api_test_id", "organization_id") REFERENCES "api_tests" ("id", "organization_id");

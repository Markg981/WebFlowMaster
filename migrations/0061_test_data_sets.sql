-- Shared test data (shared/test-data.ts): named tables of values an organization keeps once and
-- every test reuses, as {{data.<name>.<column>}} or as the rows a UI test runs over. A test that
-- uses a set as its rows keeps a marker in its own dataset column, so no column is added there.
CREATE TABLE "test_data_sets" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "name" text NOT NULL,
  "description" text,
  "columns" jsonb NOT NULL,
  "rows" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "test_data_sets_name_format" CHECK ("name" ~ '^[a-z][a-z0-9_]{0,49}$')
);
--> statement-breakpoint
CREATE INDEX "test_data_sets_organization_id_idx" ON "test_data_sets" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "test_data_sets_organization_name_idx" ON "test_data_sets" ("organization_id", "name");
--> statement-breakpoint
ALTER TABLE "test_data_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "test_data_sets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "test_data_sets"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "test_data_sets" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "test_data_sets_id_seq" TO app_user;

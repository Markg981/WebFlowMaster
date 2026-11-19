-- The data fixture library (docs/superpowers/specs/2026-11-19-data-fixtures-design.md, release 2).
--
-- A fixture kept once per project instead of once per test: its versions are frozen once written,
-- and a test names it by id (tests.data_fixtures, kind 'ref'). As in 0110, the single-column
-- foreign keys carry the ON DELETE behaviour and the composite ones hold the organization; users
-- are linked through organization_memberships, as in 0089.
CREATE TABLE "data_fixture_library" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES organizations(id),
  "project_id" integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "kind" text NOT NULL DEFAULT 'sql',
  "tags" text[] NOT NULL DEFAULT '{}',
  "current_version" integer NOT NULL DEFAULT 1,
  "created_by" integer REFERENCES users(id) ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT data_fixture_library_id_organization_unique UNIQUE (id, organization_id),
  CONSTRAINT data_fixture_library_kind_check CHECK (kind IN ('sql')),
  CONSTRAINT data_fixture_library_key_check CHECK (key ~ '^[a-z0-9][a-z0-9_-]{0,79}$')
);
--> statement-breakpoint
ALTER TABLE "data_fixture_library" ADD CONSTRAINT data_fixture_library_project_id_same_org_fk
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id);
--> statement-breakpoint
ALTER TABLE "data_fixture_library" ADD CONSTRAINT data_fixture_library_created_by_same_org_fk
  FOREIGN KEY (created_by, organization_id)
  REFERENCES organization_memberships (user_id, organization_id)
  ON DELETE SET NULL (created_by);
--> statement-breakpoint
CREATE UNIQUE INDEX "data_fixture_library_project_key_unique" ON "data_fixture_library" ("project_id", "key");
--> statement-breakpoint
CREATE INDEX "data_fixture_library_org_idx" ON "data_fixture_library" ("organization_id");
--> statement-breakpoint
CREATE TABLE "data_fixture_versions" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES organizations(id),
  "fixture_id" integer NOT NULL REFERENCES data_fixture_library(id) ON DELETE CASCADE,
  "version" integer NOT NULL,
  "definition" jsonb NOT NULL,
  "note" text,
  "created_by" integer REFERENCES users(id) ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "data_fixture_versions" ADD CONSTRAINT data_fixture_versions_fixture_id_same_org_fk
  FOREIGN KEY (fixture_id, organization_id) REFERENCES data_fixture_library (id, organization_id);
--> statement-breakpoint
ALTER TABLE "data_fixture_versions" ADD CONSTRAINT data_fixture_versions_created_by_same_org_fk
  FOREIGN KEY (created_by, organization_id)
  REFERENCES organization_memberships (user_id, organization_id)
  ON DELETE SET NULL (created_by);
--> statement-breakpoint
CREATE UNIQUE INDEX "data_fixture_versions_fixture_version_unique" ON "data_fixture_versions" ("fixture_id", "version");
--> statement-breakpoint
ALTER TABLE "data_fixture_library" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "data_fixture_library" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "data_fixture_library"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "data_fixture_library" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "data_fixture_library_id_seq" TO app_user;
--> statement-breakpoint
ALTER TABLE "data_fixture_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "data_fixture_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "data_fixture_versions"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
-- A version is history: the application adds one and reads them, never rewrites one (as
-- test_versions, migration 0018). Deleting the fixture removes them through the cascade.
GRANT SELECT, INSERT ON TABLE "data_fixture_versions" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "data_fixture_versions_id_seq" TO app_user;

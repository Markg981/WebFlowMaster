-- Two things a suite needs once it stops being small: a way to say what a test is for, and a
-- way to find out what it used to be.

-- 1. A word an organization uses for a group of tests.
--
-- A test could be filed under a project and nothing else, so "the smoke tests", "everything
-- that touches checkout" and "the ones that are slow" existed only in people's heads and in
-- the names they typed. A plan was then assembled by hand, one test at a time, and stayed
-- assembled: a test written next week is in no plan until somebody remembers to add it.
--
-- The name is unique per organization and compared without case, because "Smoke" and "smoke"
-- are one tag that two people typed differently — and two tags that look identical in a list
-- are worse than none, since a filter on one silently omits the tests filed under the other.
CREATE TABLE "tags" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tags_organization_id_idx" ON "tags" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tags_organization_name_unique" ON "tags" ("organization_id", lower("name"));
--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "tags"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tags" TO app_user;
--> statement-breakpoint

-- 2. Which tests carry which tag.
--
-- Shaped like test_plan_selected_tests, and for the same reason: a plan may hold UI tests and
-- API tests, so a tag that could only be put on one of the two would describe half a suite.
-- Exactly one of the two ids is set, which the CHECK enforces rather than leaving to whoever
-- writes the next insert.
--
-- Both sides cascade. A deleted test takes its tags with it — the alternative is a filter that
-- counts rows nobody can open.
CREATE TABLE "test_tags" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "tag_id" text NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
  "test_id" integer REFERENCES "tests"("id") ON DELETE CASCADE,
  "api_test_id" integer REFERENCES "api_tests"("id") ON DELETE CASCADE,
  "test_type" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "test_tags_one_target" CHECK (
    ("test_id" IS NOT NULL AND "api_test_id" IS NULL)
    OR ("test_id" IS NULL AND "api_test_id" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "test_tags_organization_id_idx" ON "test_tags" ("organization_id");
--> statement-breakpoint
CREATE INDEX "test_tags_tag_id_idx" ON "test_tags" ("tag_id");
--> statement-breakpoint
CREATE INDEX "test_tags_test_id_idx" ON "test_tags" ("test_id");
--> statement-breakpoint
CREATE INDEX "test_tags_api_test_id_idx" ON "test_tags" ("api_test_id");
--> statement-breakpoint
-- A tag is on a test or it is not; putting it on twice is not a stronger statement.
CREATE UNIQUE INDEX "test_tags_ui_unique" ON "test_tags" ("tag_id", "test_id") WHERE "test_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "test_tags_api_unique" ON "test_tags" ("tag_id", "api_test_id") WHERE "api_test_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_tags" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "test_tags" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "test_tags"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "test_tags" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "test_tags_id_seq" TO app_user;
--> statement-breakpoint

-- 3. What a test used to be.
--
-- Saving a test overwrote it, and that was the whole history: re-record a flow, save over the
-- old one, and yesterday's version was gone. Which matters most exactly when it hurts most —
-- a test that passed last week and fails today, with nothing to say whether the application
-- changed or the test did.
--
-- A row is written on every save, including the first, so version 1 is the test as created and
-- the newest row always matches the live test. Restoring writes the old content back as a new
-- version rather than deleting the ones after it: history that can be rewritten is not history.
--
-- The snapshot is self-contained — name, url, sequence, elements, preconditions, dataset — so
-- reading a version never depends on what the live test happens to be now.
--
-- created_by is ON DELETE SET NULL: a member who leaves must be removable, and their work
-- stays in the history with an author nobody can name any more rather than vanishing.
CREATE TABLE "test_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "test_id" integer NOT NULL REFERENCES "tests"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "sequence" jsonb NOT NULL,
  "elements" jsonb NOT NULL,
  "preconditions" jsonb,
  "dataset" jsonb,
  -- What changed since the version before it, worked out when the row is written. Stored
  -- rather than computed on read, so listing a history does not mean loading every snapshot.
  "summary" text,
  -- Set when this version exists because somebody restored an older one.
  "restored_from_version" integer,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "test_versions_organization_id_idx" ON "test_versions" ("organization_id");
--> statement-breakpoint
CREATE INDEX "test_versions_test_id_idx" ON "test_versions" ("test_id");
--> statement-breakpoint
-- Two rows claiming to be version 4 of the same test would make "restore version 4" ambiguous.
CREATE UNIQUE INDEX "test_versions_test_version_unique" ON "test_versions" ("test_id", "version");
--> statement-breakpoint
ALTER TABLE "test_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "test_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "test_versions"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
-- No DELETE. The application cannot erase a version, for the same reason it cannot rewrite the
-- audit log: a history the application can edit is not evidence of anything. Deleting the test
-- takes its versions with it, through the cascade above, which is a different thing.
GRANT SELECT, INSERT ON TABLE "test_versions" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "test_versions_id_seq" TO app_user;

-- Two tables that exist to stop the same thing being written down forty times.

-- 1. A named sequence of steps that many tests can call.
--
-- A test's `sequence` is a flat list, so a login written once is written once per test. Forty
-- tests that log in hold forty copies of the same six steps, and a change to the login flow is
-- forty edits — which is not how it goes: it is thirty-nine edits and one test that fails
-- tomorrow for a reason nobody connects to today's change.
--
-- The group is referenced, not copied: a test holds a step that names the group, and the
-- runner expands it at execution time. That is the whole point — editing the group changes
-- what every test does next time it runs.
--
-- project_id is nullable and ON DELETE SET NULL, exactly as `tests` has it: a group can be
-- scoped to one application or shared across the organization, and deleting a project must
-- not delete the work.
CREATE TABLE "step_groups" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "description" text,
  "sequence" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "step_groups_organization_id_idx" ON "step_groups" ("organization_id");
--> statement-breakpoint
CREATE INDEX "step_groups_project_id_idx" ON "step_groups" ("project_id");
--> statement-breakpoint
ALTER TABLE "step_groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "step_groups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "step_groups"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "step_groups" TO app_user;
--> statement-breakpoint

-- 2. The elements of an application, in one place instead of inside each test.
--
-- `detected_elements` belongs to a single test, so the same button is recorded once per test
-- that touches it. When the application changes that button, every copy is wrong separately —
-- and the AI healing pass repairs the copy in the test that happened to run, leaving the other
-- thirty-nine to fail one by one, each one looking like a new problem.
--
-- Elements belong to a project because a selector is a fact about one application: two
-- applications in the same organization have nothing to say to each other, and pooling them
-- would make every list a search problem.
--
-- Nothing is forced to use this. A step may name an element here; a step that does not keeps
-- the selector it has always had, and runs exactly as before. See server/step-elements.ts.
CREATE TABLE "project_elements" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "selector" text NOT NULL,
  -- What the selector was when a person (or the recorder) first wrote it down. Healing moves
  -- `selector`; this stays, so "what did this used to be?" has an answer.
  "original_selector" text,
  -- The iframe chain the element lives in, ' >> ' separated and outermost first, as element
  -- detection records it.
  "frame_selector" text,
  "tag" text,
  "element_type" text,
  "text" text,
  "attributes" jsonb,
  -- Set when the healing pass repaired this element, so a list can show what the application
  -- has been moving underneath the suite.
  "healed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "project_elements_organization_id_idx" ON "project_elements" ("organization_id");
--> statement-breakpoint
CREATE INDEX "project_elements_project_id_idx" ON "project_elements" ("project_id");
--> statement-breakpoint
-- One name per project: the name is how a person finds an element, and two "Save button"s in
-- one application make the repository worse than the copies it replaces.
CREATE UNIQUE INDEX "project_elements_project_name_unique" ON "project_elements" ("project_id", "name");
--> statement-breakpoint
ALTER TABLE "project_elements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_elements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "project_elements"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "project_elements" TO app_user;

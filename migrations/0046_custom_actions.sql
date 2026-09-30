-- An organization's own steps: a name, parameters, and JavaScript that runs in the page under
-- test (shared/custom-actions.ts).
--
-- Referenced by tests as `customAction:<id>` and expanded when a test runs, like step_groups,
-- so editing one changes every test that uses it. The script runs in the browser page only —
-- never on the runner, which every organization shares — so it needs no more trust than a
-- `Run JavaScript` step already has.
CREATE TABLE "custom_actions" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "description" text,
  "parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "script" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "custom_actions_organization_id_idx" ON "custom_actions" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "custom_actions_organization_name_idx" ON "custom_actions" ("organization_id", "name");
--> statement-breakpoint
ALTER TABLE "custom_actions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_actions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "custom_actions"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "custom_actions" TO app_user;

-- Which tests a change affects (server/test-impact.ts). Each rule maps the files a pattern matches
-- to a tag; a run asked for with the files a commit changed runs the tests carrying the tags those
-- files map to. A rule with no tag marks files that affect no test (documentation, say).
CREATE TABLE "impact_rules" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "pattern" text NOT NULL,
  "tag_id" text REFERENCES "tags"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "impact_rules_organization_id_idx" ON "impact_rules" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "impact_rules_organization_pattern_tag_idx" ON "impact_rules" ("organization_id", "pattern", coalesce("tag_id", ''));
--> statement-breakpoint
-- A rule names a tag of its own organization (migration 0034).
ALTER TABLE "impact_rules" ADD CONSTRAINT "impact_rules_tag_id_same_org_fk"
  FOREIGN KEY ("tag_id", "organization_id") REFERENCES "tags"("id", "organization_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "impact_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "impact_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "impact_rules"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "impact_rules" TO app_user;

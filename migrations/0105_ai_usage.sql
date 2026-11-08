-- ai_usage: calls made to the external AI provider per organization and UTC day, for the daily
-- cap (server/authoring/ai-consent.ts, AI_DAILY_CALL_LIMIT). One row per organization and day.
CREATE TABLE "ai_usage" (
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "day" text NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  PRIMARY KEY ("organization_id", "day")
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "ai_usage"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ai_usage" TO app_user;

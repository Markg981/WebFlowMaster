-- Local agents (shared/agents.ts): processes inside a customer's network that lend browsers to
-- runs over connections they open themselves, so an application that is not on the internet can
-- be tested without a VPN or an inbound port.
--
-- An agent authenticates with a token shown once when it is created and stored here only as a
-- hash. Plans name a pool rather than an agent, so machines can be added, drained or replaced
-- without touching them.
CREATE TABLE "agents" (
  "id" text PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "name" text NOT NULL,
  "pool" text DEFAULT 'default' NOT NULL,
  "token_prefix" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp,
  "hostname" text,
  "agent_version" text,
  "playwright_version" text,
  "browsers" jsonb,
  "revoked_at" timestamp,
  CONSTRAINT "agents_pool_format" CHECK ("pool" ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  CONSTRAINT "agents_name_given" CHECK (length(trim("name")) > 0)
);
--> statement-breakpoint
CREATE INDEX "agents_organization_id_idx" ON "agents" ("organization_id");
--> statement-breakpoint
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "agents"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
-- No DELETE: revoking keeps the row, so a run's report can still say which agent ran it.
GRANT SELECT, INSERT, UPDATE ON TABLE "agents" TO app_user;
--> statement-breakpoint
ALTER TABLE "test_plans" ADD COLUMN "agent_pool" text;
--> statement-breakpoint
ALTER TABLE "test_plans" ADD CONSTRAINT "test_plans_agent_pool_format" CHECK ("agent_pool" IS NULL OR "agent_pool" ~ '^[a-z0-9][a-z0-9_-]{0,39}$');

-- Browsers in the cloud (BrowserStack, LambdaTest) or on a Playwright server of one's own, for
-- plans that need an OS, a browser or a version the runners do not have (server/browser-grids.ts).
--
-- The access key is encrypted with the same AES-256-GCM scheme as `secrets` and never sent back
-- to a client, exactly like an issue tracker's token.
CREATE TABLE "browser_grids" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "name" text NOT NULL,
  -- 'browserstack' | 'lambdatest' | 'playwright_server' (shared/browser-grids.ts).
  "provider" text NOT NULL,
  -- The account for BrowserStack and LambdaTest; null for a Playwright server.
  "username" text,
  -- The ws(s):// address, for a Playwright server; null for the others, whose address is known.
  "endpoint" text,
  -- The access key, or a Playwright server's token. Optional only for a server that needs none.
  "encrypted_key" text,
  "key_iv" text,
  "key_auth_tag" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  -- What a same-organization foreign key points at (see 0034).
  CONSTRAINT "browser_grids_id_organization_unique" UNIQUE ("id", "organization_id")
);
--> statement-breakpoint
CREATE INDEX "browser_grids_organization_id_idx" ON "browser_grids" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "browser_grids_organization_name_unique" ON "browser_grids" ("organization_id", lower("name"));
--> statement-breakpoint
ALTER TABLE "browser_grids" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "browser_grids" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "browser_grids"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "browser_grids" TO app_user;
--> statement-breakpoint
-- A plan runs on a grid, on a pool of local agents, or on the server's runners — never two.
ALTER TABLE "test_plans" ADD COLUMN "browser_grid_id" text REFERENCES "browser_grids"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- And only at a grid of its own organization, whatever the application checks.
ALTER TABLE "test_plans" ADD CONSTRAINT "test_plans_browser_grid_id_same_org_fk" FOREIGN KEY ("browser_grid_id", "organization_id") REFERENCES "browser_grids" ("id", "organization_id");

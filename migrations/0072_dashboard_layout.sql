CREATE TABLE "user_dashboard_layouts" (
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "widgets" jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("organization_id", "user_id"),
  CONSTRAINT "dashboard_widgets_array" CHECK (jsonb_typeof("widgets") = 'array' AND jsonb_array_length("widgets") = 5)
);
--> statement-breakpoint
ALTER TABLE "user_dashboard_layouts"
  ADD CONSTRAINT "user_dashboard_layouts_user_id_same_org_fk"
  FOREIGN KEY ("user_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "user_dashboard_layouts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_dashboard_layouts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY personal_layout ON "user_dashboard_layouts"
  USING (
    NULLIF(current_setting('app.current_org', true), '')::int = organization_id
    AND (NULLIF(current_setting('app.current_user', true), '') IS NULL
      OR NULLIF(current_setting('app.current_user', true), '')::int = user_id)
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_org', true), '')::int = organization_id
    AND (NULLIF(current_setting('app.current_user', true), '') IS NULL
      OR NULLIF(current_setting('app.current_user', true), '')::int = user_id)
  );
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "user_dashboard_layouts" TO app_user;

-- Projects an organization can close to some of its members.
--
-- Every member saw every test of the organization, and every editor could change any of them.
-- A team that brought in a contractor for one application, or keeps a project for a customer
-- other customers' testers must not see, had no way to say so.
--
-- A project is open by default, and then nothing changes: the organization role applies. A
-- restricted one is visible to the organization's owners and to its members only, and each
-- member has a role on it — viewer or editor — that can narrow what their organization role
-- allows but never widen it: an editor who is a viewer on a project can read its tests and not
-- change them; a viewer stays a viewer everywhere.
--
-- Enforced here, in row-level security, rather than route by route: the tests, API tests, step
-- groups and elements of a project are reached from dozens of handlers, and the one that forgot
-- the check would be the leak. withTenantTransaction binds the requesting user
-- (app.current_user, app.current_user_role); a transaction with no user bound is the system — the
-- worker running a plan, a retention sweep — and sees what the organization's RLS lets it see,
-- as before. Plans, runs and reports stay organization-wide: a plan may run a restricted
-- project's tests, and its report names them.
ALTER TABLE "projects" ADD COLUMN "restricted" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "project_members" (
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "role" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("project_id", "user_id"),
  CONSTRAINT "project_members_role_known" CHECK ("role" IN ('viewer', 'editor'))
);
--> statement-breakpoint
CREATE INDEX "project_members_organization_id_idx" ON "project_members" ("organization_id");
--> statement-breakpoint
CREATE INDEX "project_members_user_id_idx" ON "project_members" ("user_id");
--> statement-breakpoint
ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "project_members"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "project_members" TO app_user;
--> statement-breakpoint

-- Who is asking. Null means the system: no user is bound to the transaction.
CREATE FUNCTION app_principal_id() RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user', true), '')::int
$$;
--> statement-breakpoint
CREATE FUNCTION app_principal_sees_everything() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app_principal_id() IS NULL OR current_setting('app.current_user_role', true) = 'owner'
$$;
--> statement-breakpoint

-- A restricted project is not there at all for someone who is not on it. Only reads, updates
-- and deletes are narrowed: creating a project is an ordinary editor's right, and it is created
-- open.
CREATE POLICY project_access ON "projects" AS RESTRICTIVE
  USING (
    NOT restricted
    OR app_principal_sees_everything()
    OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = projects.id AND m.user_id = app_principal_id())
  )
  WITH CHECK (true);
--> statement-breakpoint

-- Something in a project is visible when its project is, which RLS on projects has just decided.
CREATE FUNCTION app_project_visible(p_project_id integer) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_project_id IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = p_project_id)
$$;
--> statement-breakpoint
-- …and changeable when its project is open, or the requester is an editor on it. The
-- organization role has already been checked by the route (requireRole): this only narrows.
CREATE FUNCTION app_project_editable(p_project_id integer) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_project_id IS NULL
    OR app_principal_sees_everything()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = p_project_id
        AND (
          NOT p.restricted
          OR EXISTS (
            SELECT 1 FROM project_members m
            WHERE m.project_id = p.id AND m.user_id = app_principal_id() AND m.role = 'editor'
          )
        )
    )
$$;
--> statement-breakpoint

-- The same four policies on each table whose rows belong to a project.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tests', 'api_tests', 'step_groups', 'project_elements'] LOOP
    EXECUTE format('CREATE POLICY project_read ON %I AS RESTRICTIVE FOR SELECT USING (app_project_visible(project_id))', t);
    EXECUTE format('CREATE POLICY project_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (app_project_editable(project_id))', t);
    EXECUTE format('CREATE POLICY project_update ON %I AS RESTRICTIVE FOR UPDATE USING (app_project_editable(project_id)) WITH CHECK (app_project_editable(project_id))', t);
    EXECUTE format('CREATE POLICY project_delete ON %I AS RESTRICTIVE FOR DELETE USING (app_project_editable(project_id))', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- A test's history is the test: its every past version, steps and all.
CREATE POLICY project_read ON "test_versions" AS RESTRICTIVE FOR SELECT
  USING (EXISTS (SELECT 1 FROM tests t WHERE t.id = test_versions.test_id));

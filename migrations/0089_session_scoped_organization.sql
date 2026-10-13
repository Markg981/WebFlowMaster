-- The organization a request acts in belongs to the session, not to the account
-- (server/identity/auth.ts, server/tenancy/organization-memberships.ts). Two browsers of one person
-- can act in two organizations, so users.organization_id — now only where the account last
-- switched to — no longer says which organization a person's rows belong to.
--
-- The two-column guards that tied a row's person to its organization pointed at
-- users(id, organization_id). Pointing there, they refused a run, a key or a comment made by a
-- session acting in an organization other than the one the row names, and refused the switch
-- itself for anyone who had made one. What they mean is "this person is a member of this
-- organization": the membership. Same names, same columns, new parent.
--
-- What a removed membership does to them: what is the person's own in that organization (keys,
-- project seats, reset links, dashboards and their layouts, provider sessions and provisioning
-- rows) goes with it, as removePersonalRowsInOrganization already deletes; who requested a run and
-- who wrote or resolved a comment are forgotten, as when the account itself is deleted.
--
-- The old guards kept every such pair equal to a user row, and every user row has its membership
-- (migration 0086's trigger), so nothing below should find a row without one. The clean-up only
-- makes the validation unable to fail on a database that somehow disagrees.
DELETE FROM api_keys t WHERE NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.user_id = t.user_id AND m.organization_id = t.organization_id);
--> statement-breakpoint
DELETE FROM project_members t WHERE NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.user_id = t.user_id AND m.organization_id = t.organization_id);
--> statement-breakpoint
DELETE FROM password_resets t WHERE NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.user_id = t.user_id AND m.organization_id = t.organization_id);
--> statement-breakpoint
DELETE FROM user_dashboard_layouts t WHERE NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.user_id = t.user_id AND m.organization_id = t.organization_id);
--> statement-breakpoint
DELETE FROM user_dashboard_preferences t WHERE NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.user_id = t.user_id AND m.organization_id = t.organization_id);
--> statement-breakpoint
DELETE FROM dashboards t WHERE NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.user_id = t.creator_id AND m.organization_id = t.organization_id);
--> statement-breakpoint
DELETE FROM sso_saml_sessions t WHERE t.user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.user_id = t.user_id AND m.organization_id = t.organization_id);
--> statement-breakpoint
DELETE FROM scim_users t WHERE t.user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.user_id = t.user_id AND m.organization_id = t.organization_id);
--> statement-breakpoint
UPDATE test_plan_executions t SET requested_by_user_id = NULL
WHERE t.requested_by_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.user_id = t.requested_by_user_id AND m.organization_id = t.organization_id);
--> statement-breakpoint
UPDATE comments t SET author_id = NULL
WHERE t.author_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.user_id = t.author_id AND m.organization_id = t.organization_id);
--> statement-breakpoint
UPDATE comments t SET resolved_by = NULL
WHERE t.resolved_by IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.user_id = t.resolved_by AND m.organization_id = t.organization_id);
--> statement-breakpoint
ALTER TABLE api_keys DROP CONSTRAINT api_keys_user_id_same_org_fk;
--> statement-breakpoint
ALTER TABLE api_keys ADD CONSTRAINT api_keys_user_id_same_org_fk
  FOREIGN KEY (user_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE project_members DROP CONSTRAINT project_members_user_id_same_org_fk;
--> statement-breakpoint
ALTER TABLE project_members ADD CONSTRAINT project_members_user_id_same_org_fk
  FOREIGN KEY (user_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE password_resets DROP CONSTRAINT password_resets_user_id_same_org_fk;
--> statement-breakpoint
ALTER TABLE password_resets ADD CONSTRAINT password_resets_user_id_same_org_fk
  FOREIGN KEY (user_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE user_dashboard_layouts DROP CONSTRAINT user_dashboard_layouts_user_id_same_org_fk;
--> statement-breakpoint
ALTER TABLE user_dashboard_layouts ADD CONSTRAINT user_dashboard_layouts_user_id_same_org_fk
  FOREIGN KEY (user_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE user_dashboard_preferences DROP CONSTRAINT user_dashboard_preferences_user_id_same_org_fk;
--> statement-breakpoint
ALTER TABLE user_dashboard_preferences ADD CONSTRAINT user_dashboard_preferences_user_id_same_org_fk
  FOREIGN KEY (user_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE dashboards DROP CONSTRAINT dashboards_creator_id_same_org_fk;
--> statement-breakpoint
ALTER TABLE dashboards ADD CONSTRAINT dashboards_creator_id_same_org_fk
  FOREIGN KEY (creator_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE sso_saml_sessions DROP CONSTRAINT sso_saml_sessions_user_id_same_org_fk;
--> statement-breakpoint
ALTER TABLE sso_saml_sessions ADD CONSTRAINT sso_saml_sessions_user_id_same_org_fk
  FOREIGN KEY (user_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE scim_users DROP CONSTRAINT scim_users_user_id_same_org_fk;
--> statement-breakpoint
ALTER TABLE scim_users ADD CONSTRAINT scim_users_user_id_same_org_fk
  FOREIGN KEY (user_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE test_plan_executions DROP CONSTRAINT test_plan_executions_requested_by_user_id_same_org_fk;
--> statement-breakpoint
ALTER TABLE test_plan_executions ADD CONSTRAINT test_plan_executions_requested_by_user_id_same_org_fk
  FOREIGN KEY (requested_by_user_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id)
  ON DELETE SET NULL (requested_by_user_id);
--> statement-breakpoint
ALTER TABLE comments DROP CONSTRAINT comments_author_id_same_org_fk;
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comments_author_id_same_org_fk
  FOREIGN KEY (author_id, organization_id)
  REFERENCES organization_memberships (user_id, organization_id)
  ON DELETE SET NULL (author_id);
--> statement-breakpoint
ALTER TABLE comments DROP CONSTRAINT comments_resolved_by_same_org_fk;
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comments_resolved_by_same_org_fk
  FOREIGN KEY (resolved_by, organization_id)
  REFERENCES organization_memberships (user_id, organization_id)
  ON DELETE SET NULL (resolved_by);

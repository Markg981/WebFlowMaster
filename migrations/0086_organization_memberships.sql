-- A person may belong to several organizations (server/organization-memberships.ts).
--
-- users.organization_id and users.role used to be the whole story: one account, one
-- organization. They stay, and keep their meaning for every query, policy and role check that
-- reads them — but as the organization the account is acting in *now*, and its role there. This
-- table is the set of organizations the account may act in. Switching copies one of these rows
-- onto the user row and starts a new session.
CREATE TABLE organization_memberships (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor',
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT organization_memberships_user_org_unique UNIQUE (user_id, organization_id)
);
--> statement-breakpoint
CREATE INDEX organization_memberships_organization_id_idx ON organization_memberships(organization_id);
--> statement-breakpoint
-- Every account so far belongs to exactly the organization its row names: one membership each.
INSERT INTO organization_memberships (user_id, organization_id, role, created_at)
  SELECT id, organization_id, role, created_at FROM users;
--> statement-breakpoint
-- Org-scoped like the rest: inside an organization, who its members are is the organization's
-- business; what else a person belongs to is read on the privileged handle, as a session is.
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON organization_memberships
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
-- Owners list, re-role and remove members of their own organization inside a tenant transaction.
-- Joining — an existing account accepting an invitation, or single sign-on on a verified domain
-- — happens before the new organization is bound, on the privileged handle, as registration does.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organization_memberships TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE organization_memberships_id_seq TO app_user;
--> statement-breakpoint
-- The membership of the current organization follows the user row. Accounts are created, and
-- roles changed, in several places (registration, invitations, single sign-on, SCIM, owners'
-- settings); rather than teach each of them this table, the database keeps the one row that
-- mirrors users.organization_id/users.role in step. A switch writes the same values it reads
-- from here, so the upsert is a no-op for it. SECURITY DEFINER: the trigger writes as the
-- table's owner, so an owner changing a member's role inside their tenant transaction does not
-- need the policy to admit the write for them.
CREATE FUNCTION app_sync_current_membership() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO organization_memberships (user_id, organization_id, role)
  VALUES (NEW.id, NEW.organization_id, NEW.role)
  ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER users_sync_current_membership
  AFTER INSERT OR UPDATE OF organization_id, role ON users
  FOR EACH ROW EXECUTE FUNCTION app_sync_current_membership();

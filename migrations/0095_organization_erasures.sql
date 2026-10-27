-- Record of organization erasures, outside the tenant tables (audit A-10).
--
-- Erasing an organization deletes its audit log with it, so the act left no trace except the
-- application log. This table is the durable one: who erased which organization, when, and how
-- much was removed. It deliberately has NO organization_id foreign key and NO row level security:
-- the row must outlive the organization it describes. app_user is granted nothing on it; only
-- privileged code (server/tenancy/organization-lifecycle.ts) writes it.
--
-- Additive: nothing reads or writes this before, and nothing is backfilled.
CREATE TABLE organization_erasures (
  id serial PRIMARY KEY,
  -- The id the organization had. Not a foreign key: the organization is gone by design.
  organization_id integer NOT NULL,
  organization_name text,
  -- Who asked, as the caller reported it; null for operator-initiated erasure.
  actor_user_id integer,
  actor_username text,
  erased_at timestamptz NOT NULL DEFAULT now(),
  -- Rows removed per table, and files removed or left behind in the artifact store.
  deleted_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  files_removed integer NOT NULL DEFAULT 0,
  files_failed jsonb NOT NULL DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE INDEX organization_erasures_organization_id_idx ON organization_erasures(organization_id);
--> statement-breakpoint
REVOKE ALL ON TABLE organization_erasures FROM app_user;

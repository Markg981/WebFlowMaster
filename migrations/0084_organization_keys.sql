-- Envelope encryption (server/crypto.ts, server/organization-keys.ts). Every organization gets a
-- data key of its own, generated the first time it stores a secret, kept here wrapped with
-- AES-256-GCM by the master key ENCRYPTION_KEY derives. Secrets written from now on are encrypted
-- with the organization's active key and carry a "v2:<key_version>:" prefix; values without the
-- prefix are still under the master key and decrypt as they always did. One active version per
-- organization; a retired version stays until nothing it encrypted is left, which
-- scripts/wfm-rotate-key.ts checks before deleting it.
CREATE TABLE organization_keys (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_version integer NOT NULL CHECK (key_version >= 1),
  -- Hex: 16-byte IV, 16-byte authentication tag, then the 32-byte key encrypted under the master
  -- key, bound to its organization and version through the additional authenticated data.
  wrapped_key text NOT NULL,
  -- The fingerprint of the master key that wrapped it (sha256 of the key, first 16 hex characters:
  -- the fingerprint the backup manifest records), so a rotation knows which rows to re-wrap.
  master_key_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  retired_at timestamp,
  CONSTRAINT organization_keys_version_unique UNIQUE (organization_id, key_version)
);
--> statement-breakpoint
CREATE INDEX organization_keys_organization_id_idx ON organization_keys(organization_id);
--> statement-breakpoint
CREATE UNIQUE INDEX organization_keys_active_unique ON organization_keys(organization_id) WHERE retired_at IS NULL;
--> statement-breakpoint
ALTER TABLE organization_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON organization_keys
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
-- Inside a tenant transaction the application reads its organization's keys through that
-- transaction, and creates the first one there; retiring and deleting versions is the operator's
-- rotation script, on the privileged handle. The worker and single sign-on, which decrypt before
-- any organization is bound, read through the privileged handle too.
GRANT SELECT, INSERT ON TABLE organization_keys TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE organization_keys_id_seq TO app_user;

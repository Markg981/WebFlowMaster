-- SCIM and "refuse whoever is in none of these groups" (server/scim.ts): an account the provider's
-- groups deactivated, as opposed to one the provider deactivated itself (active: false). Only the
-- first comes back on its own when the person joins a mapped group again.
ALTER TABLE "scim_users" ADD COLUMN IF NOT EXISTS "disabled_by_groups" boolean DEFAULT false NOT NULL;

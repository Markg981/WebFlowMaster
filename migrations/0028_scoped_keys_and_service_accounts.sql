-- Keys that can do only what they are for, held by an account that is not a person.
--
-- A key acted as whoever created it, with their whole role, on every endpoint the application
-- has — so the key in a pipeline that only starts runs could also delete tests, and when its
-- creator left the organization the pipeline broke with them.
--
--   api_keys.scopes     — what the key may do, through /api/v1 only. Null is a key made before
--                         scopes existed: it keeps doing what it did, as its user, everywhere.
--   users.kind          — 'person', who signs in with a password, or 'service', which never
--                         does and exists only to hold keys.
--   users.display_name  — what a service account is called ("GitHub Actions"); its username is
--                         generated, because usernames are unique across organizations.
--   users.disabled_at   — a service account is disabled, not deleted: the runs it started
--                         still name it.
ALTER TABLE "api_keys" ADD COLUMN "scopes" text[];
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN "kind" text DEFAULT 'person' NOT NULL,
  ADD COLUMN "display_name" text,
  ADD COLUMN "disabled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_kind_known" CHECK ("kind" IN ('person', 'service')),
  -- An organization's owners are people. A service account that could be made owner could
  -- change who else is one.
  ADD CONSTRAINT "users_service_not_owner" CHECK ("kind" = 'person' OR "role" <> 'owner');

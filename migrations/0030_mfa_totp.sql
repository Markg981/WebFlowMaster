-- A second factor at sign-in: a six-digit code from an authenticator app (TOTP, RFC 6238).
--
-- A password alone is one leaked spreadsheet away from somebody else's session, and this
-- application holds the credentials of the systems it tests. user_mfa keeps, per user:
--
--   secret_*          — the TOTP secret, AES-256-GCM encrypted like environment secrets.
--   pending_secret_*  — a secret being enrolled: shown once as a QR code, and enabled only
--                       when the user proves their app produces its codes.
--   enabled_at        — when MFA was switched on. Null while enrolling.
--   last_used_step    — the 30-second window of the last code accepted, so the same code
--                       cannot be used twice (a code read over a shoulder is still live for
--                       up to a minute).
--   recovery_codes    — SHA-256 hashes of one-time codes for a lost phone. Used ones are
--                       removed.
--
-- A table of its own rather than columns on users: the user row travels — the session,
-- /api/user, every req.user — and a secret on it would travel with it.
--
-- No grant to app_user, deliberately: nothing in a tenant transaction reads or writes this.
-- It is reached only by server/mfa.ts, for the user the request authenticated as.
CREATE TABLE "user_mfa" (
  "user_id" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "secret_encrypted" text,
  "secret_iv" text,
  "secret_auth_tag" text,
  "pending_secret_encrypted" text,
  "pending_secret_iv" text,
  "pending_secret_auth_tag" text,
  "enabled_at" timestamp,
  "last_used_step" bigint,
  "recovery_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- An organization can require it of every member who signs in with a password. API keys and
-- service accounts are not affected: a key is already something you have, not something you
-- know.
ALTER TABLE "organizations" ADD COLUMN "mfa_required" boolean DEFAULT false NOT NULL;

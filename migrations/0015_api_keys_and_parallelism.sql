-- Two things a pipeline needs that a browser session cannot provide.

-- 1. A credential that is not a person.
--
-- Everything reachable over the API is behind a passport session: a cookie, obtained by
-- posting a username and a password. A CI job has neither, so the only way to run a plan from
-- a pipeline was to store somebody's password in the pipeline — which is how a person's
-- account becomes a service account, and how their departure breaks the build.
--
-- The key itself is never stored. `hashed_key` is its SHA-256, which is what a request is
-- checked against; `prefix` is the first few characters, kept so a list of keys can be told
-- apart by eye. A key is shown exactly once, when it is created.
--
-- A key acts as the user who created it, with that user's role, so nothing downstream needs
-- to learn a second authorisation model. Revoking is a timestamp rather than a delete: a key
-- that ran ten thousand builds should still be nameable afterwards.
CREATE TABLE "api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "hashed_key" text NOT NULL UNIQUE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp,
  "expires_at" timestamp,
  "revoked_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "api_keys_organization_id_idx" ON "api_keys" ("organization_id");
--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" ("user_id");
--> statement-breakpoint

-- Same isolation as every other org-scoped table: FORCE so the table owner is subject to the
-- policy too, and NULLIF so a connection with no organization bound sees nothing rather than
-- raising a cast error on the empty-string GUC default.
--
-- The authenticating lookup does not go through this policy, and cannot: it runs before any
-- organization is known — that is the whole point of it — so it uses the privileged handle,
-- exactly as passport's deserializeUser does for `users`. Everything else, every way a key is
-- created, listed or revoked, is an ordinary request with an ambient organization.
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "api_keys"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint

-- No UPDATE of the secret itself is possible through the application: revocation is the only
-- mutation a route performs, and it writes `revoked_at`. The grant is table-wide because
-- column-level grants here would be a second place to forget; the narrowing that matters is
-- the policy above.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "api_keys" TO app_user;
--> statement-breakpoint

-- 2. How much of a plan may run at once.
--
-- A plan has always run its tests strictly one after another, and since browsers became a
-- matrix it runs them once per browser as well — so a suite of forty tests on three browsers
-- is a hundred and twenty sequential browser sessions, which is a nightly job, not a pipeline
-- step.
--
-- Default 1, which is exactly what every existing plan does today. Raising it is a decision
-- about the machine the runner is on, so it belongs to the plan rather than to the code.
ALTER TABLE "test_plans" ADD COLUMN "max_parallel_tests" integer DEFAULT 1 NOT NULL;

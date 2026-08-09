-- Invitations: a standing offer for a not-yet-registered username to join an organization.
--
-- A user belongs to exactly one organization, so "add a member" cannot mean re-parenting an
-- existing account — that strips them of their own organization's data without their consent,
-- which is why POST /api/organization/members refuses it. An invitation instead names a
-- username that does not exist yet; whoever registers with the token lands here rather than
-- in a fresh organization of their own.
CREATE TABLE "invitations" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "username" text NOT NULL,
  "role" text DEFAULT 'editor' NOT NULL,
  "token" text NOT NULL,
  "invited_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "expires_at" timestamp NOT NULL,
  "accepted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "invitations_token_unique" UNIQUE("token"),
  CONSTRAINT "invitations_org_username_unique" UNIQUE("organization_id", "username")
);
--> statement-breakpoint
CREATE INDEX "invitations_organization_id_idx" ON "invitations" ("organization_id");
--> statement-breakpoint

-- No RLS, for the same reason `users` has none: registration looks an invitation up by token
-- before any tenant context exists, and a policy reading app.current_org would make that
-- impossible. The routes that manage invitations therefore carry their own organization_id
-- predicate, exactly as the member routes do for `users`.
--
-- Grants follow 0006's rule of only what the code does: the routes list, create and revoke,
-- and registration marks one accepted. No UPDATE beyond that and no ownership of the token
-- namespace — token lookup at registration runs on the privileged handle, before app_user is
-- ever assumed.
GRANT SELECT, INSERT, DELETE ON TABLE "invitations" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "invitations_id_seq" TO app_user;

-- One invitation per username per organization was meant as one *pending* invitation, but the
-- constraint counted accepted ones too, which are kept for the audit trail. Once a member was
-- removed, the invitation they had accepted stopped the owner from inviting the same username
-- again ("That username has already been invited."). Only an invitation still waiting to be
-- accepted now holds the username.
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_org_username_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_org_username_pending_unique" ON "invitations" ("organization_id", "username") WHERE "accepted_at" IS NULL;

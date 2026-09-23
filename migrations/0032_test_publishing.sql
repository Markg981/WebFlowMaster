-- A test that is being edited is not the test that runs.
--
-- Saving a test changed what every plan ran from that moment: a half-finished re-recording
-- saved at six in the evening was what the nightly run executed at two in the morning, and the
-- failures it produced were the editor's, not the application's. Now the saved test is a
-- working copy, and a plan runs the version that was published — the history (test_versions)
-- already holds every version, so publishing is pointing at one of them.
--
--   tests.published_version — the version plans run. Null: never published, and plans run the
--                             working copy, exactly as before. Nothing changes for a test until
--                             somebody publishes it.
--   test_publications       — every publication, append-only: who put which version live, when
--                             and why (published, approved in review, rolled back, withdrawn).
--                             It is what a rollback is allowed to go back to.
--   test_reviews            — a request to publish a version, and its outcome. Approving
--                             publishes; the approver cannot be the author of the version.
--   organizations.test_review_required
--                           — publishing needs an approved review, and a plan skips a test
--                             that has never been published instead of running an unreviewed
--                             working copy. Rolling back to a version that was live before is
--                             always allowed: it is the way out of a bad publication at 2 a.m.
ALTER TABLE "tests" ADD COLUMN "published_version" integer;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "test_review_required" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "test_publications" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "test_id" integer NOT NULL REFERENCES "tests"("id") ON DELETE CASCADE,
  -- Null when the publication was withdrawn and plans went back to the working copy.
  "version" integer,
  "kind" text NOT NULL,
  "review_id" integer,
  "published_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "published_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "test_publications_kind_known" CHECK ("kind" IN ('publish', 'review', 'rollback', 'unpublish'))
);
--> statement-breakpoint
CREATE INDEX "test_publications_test_id_idx" ON "test_publications" ("test_id");
--> statement-breakpoint
CREATE INDEX "test_publications_organization_id_idx" ON "test_publications" ("organization_id");
--> statement-breakpoint
CREATE TABLE "test_reviews" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "test_id" integer NOT NULL REFERENCES "tests"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "note" text,
  "requested_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "requested_at" timestamp DEFAULT now() NOT NULL,
  "decided_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamp,
  "decision_comment" text,
  CONSTRAINT "test_reviews_status_known" CHECK ("status" IN ('pending', 'approved', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX "test_reviews_organization_status_idx" ON "test_reviews" ("organization_id", "status");
--> statement-breakpoint
CREATE INDEX "test_reviews_test_id_idx" ON "test_reviews" ("test_id");
--> statement-breakpoint
-- One open request per test: two pending reviews of the same test would be two reviewers
-- racing to publish different versions.
CREATE UNIQUE INDEX "test_reviews_one_pending_per_test" ON "test_reviews" ("test_id") WHERE "status" = 'pending';
--> statement-breakpoint

-- Organization-scoped like everything else, and — like a test's version history — visible only
-- where the test is (restricted projects, migration 0031).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['test_publications', 'test_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
      WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)$p$, t);
    EXECUTE format('CREATE POLICY project_read ON %I AS RESTRICTIVE FOR SELECT USING (EXISTS (SELECT 1 FROM tests WHERE tests.id = %I.test_id))', t, t);
  END LOOP;
END $$;
--> statement-breakpoint
-- The publication history is evidence, like the version history: added to, never rewritten.
GRANT SELECT, INSERT ON TABLE "test_publications" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "test_publications_id_seq" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "test_reviews" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "test_reviews_id_seq" TO app_user;

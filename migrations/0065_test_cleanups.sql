-- Cleanup calls of a UI test (server/cleanup-runner.ts): API calls made after the test, whatever its
-- outcome, to remove the data it created. Kept with the test and with each of its versions, like the
-- preconditions.
ALTER TABLE "tests" ADD COLUMN IF NOT EXISTS "cleanups" jsonb;
--> statement-breakpoint
ALTER TABLE "test_versions" ADD COLUMN IF NOT EXISTS "cleanups" jsonb;

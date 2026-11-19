-- Data fixtures (server/runtime/data-setup): the data a UI test needs in the application's database,
-- checked and created by script before it runs. Kept with the test and with each of its versions,
-- like the preconditions and the cleanups.
ALTER TABLE "tests" ADD COLUMN IF NOT EXISTS "data_fixtures" jsonb;
--> statement-breakpoint
ALTER TABLE "test_versions" ADD COLUMN IF NOT EXISTS "data_fixtures" jsonb;
--> statement-breakpoint
-- Whether a run on this environment may write the data a fixture finds missing. Off for every
-- environment until an owner turns it on: where it is off, a fixture only reads.
ALTER TABLE "environments" ADD COLUMN IF NOT EXISTS "data_setup" boolean NOT NULL DEFAULT false;

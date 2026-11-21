-- The data fixture ledger (docs/superpowers/specs/2026-11-19-data-fixtures-design.md, release 4).
--
-- One row for each fixture a run applied and has a teardown for: written when `apply` has made
-- the data, settled when the teardown has run. A worker that dies in between leaves a `pending`
-- row, which a person or the sweep can still run, so a killed run does not leave orphans for good.
-- `entry` holds the frozen teardown script and the parameter values apply used; `bindings` the
-- outputs ({{fx.*}}) and run values it reads. Neither holds a secret: the database address is
-- read again from the environment when the teardown runs. No foreign key to the run, the test or
-- the environment: the row has to outlive each of them (a retry that finds the environment gone
-- fails with that reason).
CREATE TABLE "fixture_ledger" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES organizations(id),
  "run_id" text NOT NULL,
  "test_id" integer,
  "environment_id" integer,
  "alias" text NOT NULL,
  "name" text NOT NULL,
  "policy" text NOT NULL DEFAULT 'always',
  "entry" jsonb NOT NULL,
  "bindings" jsonb NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "detail" text,
  "applied_at" timestamp NOT NULL DEFAULT now(),
  "claimed_at" timestamp,
  "settled_at" timestamp,
  CONSTRAINT fixture_ledger_policy_check CHECK (policy IN ('always', 'onSuccess', 'never')),
  CONSTRAINT fixture_ledger_status_check CHECK (status IN ('applying', 'pending', 'running', 'done', 'failed', 'kept'))
);
--> statement-breakpoint
CREATE INDEX "fixture_ledger_org_status_idx" ON "fixture_ledger" ("organization_id", "status");
--> statement-breakpoint
CREATE INDEX "fixture_ledger_run_idx" ON "fixture_ledger" ("run_id");
--> statement-breakpoint
ALTER TABLE "fixture_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fixture_ledger" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON "fixture_ledger"
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "fixture_ledger" TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "fixture_ledger_id_seq" TO app_user;

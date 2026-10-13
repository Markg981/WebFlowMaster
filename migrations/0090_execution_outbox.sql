-- The transactional outbox of run submissions (server/execution/execution-outbox.ts).
--
-- A run used to be committed first and handed to BullMQ after: a process that stopped between
-- the two left a `queued` row no job would ever come for, holding a place in the organization's
-- queue quota and a pipeline waiting on it. The run and the intention to publish its job are now
-- written in one transaction; the row here is deleted once the queue has the job, and the
-- dispatcher started by the web server publishes whatever a stopped process left behind.
CREATE TABLE execution_outbox (
  execution_id text PRIMARY KEY REFERENCES test_plan_executions(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES organizations(id),
  payload jsonb NOT NULL,
  priority integer NOT NULL DEFAULT 1,
  run_at timestamp NOT NULL DEFAULT now(),
  available_at timestamp NOT NULL DEFAULT now(),
  lease_until timestamp,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- The run is of the same organization as the row, as every cross-table link is.
ALTER TABLE execution_outbox ADD CONSTRAINT execution_outbox_execution_id_same_org_fk
  FOREIGN KEY (execution_id, organization_id) REFERENCES test_plan_executions (id, organization_id)
  ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX execution_outbox_available_at_idx ON execution_outbox(available_at);
--> statement-breakpoint
-- Org-scoped like the run it belongs to. The request that creates a run writes and publishes its
-- row inside the organization; the dispatcher only finds candidates on the privileged handle and
-- claims each one inside its own organization.
ALTER TABLE execution_outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE execution_outbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON execution_outbox
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE execution_outbox TO app_user;

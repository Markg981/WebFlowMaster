-- Delivery state of what a finished run owes outside (server/integrations/deliveries.ts).
--
-- Notifications were tried three times in memory and then forgotten: a worker restart or an
-- endpoint down for a minute lost them without a trace. Each is now a row written before the
-- first attempt; a sweep retries it with backoff and the run's page shows its state.
CREATE TABLE outbound_deliveries (
  id text PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  execution_id text NOT NULL REFERENCES test_plan_executions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  target text NOT NULL,
  endpoint text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE outbound_deliveries ADD CONSTRAINT outbound_deliveries_execution_id_same_org_fk
  FOREIGN KEY (execution_id, organization_id) REFERENCES test_plan_executions (id, organization_id)
  ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX outbound_deliveries_execution_idx ON outbound_deliveries(execution_id);
--> statement-breakpoint
CREATE INDEX outbound_deliveries_due_idx ON outbound_deliveries(status, next_attempt_at);
--> statement-breakpoint
ALTER TABLE outbound_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outbound_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON outbound_deliveries
  USING (NULLIF(current_setting('app.current_org', true), '')::int = organization_id)
  WITH CHECK (NULLIF(current_setting('app.current_org', true), '')::int = organization_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE outbound_deliveries TO app_user;

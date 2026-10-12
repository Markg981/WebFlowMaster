-- Run history and dashboard order runs by coalesce(started_at, queued_at) inside one
-- organization (server/routes/test-plans.routes.ts, server/analytics.ts). Found by the
-- volume test (npm run volume): at 12 months the dashboard recent-runs query seq-scanned
-- test_plan_executions. This expression index serves the range filter and the ORDER BY ... LIMIT.
CREATE INDEX IF NOT EXISTS test_plan_executions_org_run_time_idx
  ON test_plan_executions (organization_id, (coalesce(started_at, queued_at)) DESC);

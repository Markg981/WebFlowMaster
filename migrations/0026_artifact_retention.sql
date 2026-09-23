-- When a run's screenshots, videos and traces were removed by retention.
--
-- Nothing was ever removed: every run's evidence stayed on disk, or in the bucket, for good, and
-- the space it takes grows with every run. Retention now removes it once a run has been over for
-- ARTIFACT_RETENTION_DAYS. The run itself — its results, its steps, its verdict — stays; this is
-- what the report reads to say why its pictures are gone, and what the sweep reads to know it
-- has already been here.
ALTER TABLE "test_plan_executions" ADD COLUMN "artifacts_purged_at" timestamp;
--> statement-breakpoint
-- The sweep's question — finished long enough ago, not yet purged — answered from an index.
CREATE INDEX "test_plan_executions_retention_idx"
  ON "test_plan_executions" ("completed_at")
  WHERE "artifacts_purged_at" IS NULL;

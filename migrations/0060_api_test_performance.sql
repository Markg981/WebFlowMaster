-- An API test's minimal performance check: the request repeated, response times held against
-- thresholds (shared/api-performance.ts). Null means the test sends its request once.
ALTER TABLE "api_tests" ADD COLUMN IF NOT EXISTS "performance" jsonb;

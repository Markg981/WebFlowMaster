-- What the AI made of a failed result, asked for from its report (shared/failure-analysis.ts).
-- Kept so a second look costs nothing; null until somebody asks.
ALTER TABLE "report_test_case_results" ADD COLUMN "ai_analysis" jsonb;

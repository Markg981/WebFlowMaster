-- Network capture: a HAR of each test's requests, and the part of it the report shows.
--
-- A test that failed because an API answered 500 or a request took twelve seconds looks, in a
-- screenshot, exactly like one with a wrong selector. A plan can now keep a HAR per test (never,
-- on failure, always, as with video and trace). The failed and slowest requests are read out of
-- it into the result, so the report answers "was it the backend?" without anyone downloading
-- anything. Bodies are never recorded, and credentials (Authorization, cookies, API keys, tokens
-- in the URL, form bodies) are removed before the file is kept (shared/network.ts).
ALTER TABLE "test_plans" ADD COLUMN "capture_network" text DEFAULT 'never' NOT NULL;
--> statement-breakpoint
ALTER TABLE "report_test_case_results" ADD COLUMN "har_url" text;
--> statement-breakpoint
ALTER TABLE "report_test_case_results" ADD COLUMN "network_summary" jsonb;

-- What a run leaves behind, beyond a screenshot and a sentence.
--
-- A failure that happened at two in the morning is investigated from the report, and the
-- report holds one picture per step and the message the step died with. That is enough for
-- "the button was not there" and nothing else: a test that failed because a request was slow,
-- because a dialog appeared and vanished, or because the page moved under the click, looks
-- exactly like a test that failed because the selector is wrong.
--
-- Playwright can record both a video of the run and a trace — a step-by-step recording with
-- the DOM, the network and the console at each point, openable in its own viewer. The context
-- that runs every test has always been able to; nothing ever asked it to.
--
-- Three values, the same vocabulary as capture_screenshots: 'never', 'on_failure', 'always'.
-- Default 'never' because both cost disk on every run, and a suite that silently fills a
-- volume is a worse failure than a missing video.
--
-- 'on_failure' still records: Playwright writes a video when the context closes and cannot be
-- asked for one after the fact. What the setting decides is whether the file is kept.
ALTER TABLE "test_plans" ADD COLUMN "capture_video" text DEFAULT 'never' NOT NULL;
--> statement-breakpoint
ALTER TABLE "test_plans" ADD COLUMN "capture_trace" text DEFAULT 'never' NOT NULL;
--> statement-breakpoint

-- Where the report finds them. Nullable: most results have neither, and every result written
-- before this column existed has neither by definition.
ALTER TABLE "report_test_case_results" ADD COLUMN "video_url" text;
--> statement-breakpoint
ALTER TABLE "report_test_case_results" ADD COLUMN "trace_url" text;

-- The zone a schedule's time is meant in.
--
-- Everything was derived against UTC: getUTCHours() to build the cron pattern, tz:'UTC' in
-- cron-parser, timezone:"UTC" in node-cron. The interface was at least honest about it — the
-- fields read "(UTC)" — but it pushed the conversion onto the tester twice a year, and got
-- it wrong in a way nobody could attribute: a nightly regression set for 02:00 Italian time
-- ran at 03:00 local for half the year. The schedule had not changed. The clocks had.
--
-- Defaults to 'UTC' so every existing row keeps meaning exactly what it meant, and no
-- scheduled run moves as a result of this migration.
--
-- An IANA name ('Europe/Rome'), not an offset: an offset cannot express "02:00 local all year
-- round", which is the thing people actually want from a nightly job.
ALTER TABLE "test_plan_schedules"
  ADD COLUMN "timezone" text NOT NULL DEFAULT 'UTC';

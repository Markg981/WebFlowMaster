-- An environment's name was unique across the whole installation (0000's environments_name_unique):
-- once one organization had a "Staging", no other organization could create one, and the 409 it
-- got told it that somebody, somewhere, already used the name. Names belong to an organization,
-- as they already do for tags, suites and issue trackers: unique within it, compared without case,
-- because "Staging" and "staging" in one list are one environment typed twice.
--
-- The global constraint allowed "Staging" and "staging" to coexist in one organization, which the
-- new index does not. Those are renamed first, the later one getting its id appended, rather than
-- letting the migration fail on data nobody can see from here. Schedules that named the renamed
-- environment by its old name still resolve it: the lookup ignores case (server/scheduler-service.ts).

UPDATE "environments" AS later
SET "name" = later."name" || ' (' || later."id" || ')'
WHERE EXISTS (
  SELECT 1 FROM "environments" AS earlier
  WHERE earlier."organization_id" = later."organization_id"
    AND lower(earlier."name") = lower(later."name")
    AND earlier."id" < later."id"
);
--> statement-breakpoint
ALTER TABLE "environments" DROP CONSTRAINT "environments_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "environments_organization_name_unique" ON "environments" ("organization_id", lower("name"));

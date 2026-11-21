-- The QA hub case id as a real field on tests (external_case_id + external_source), unique per
-- project among non-archived tests, backfilled from the names the hub import wrote.
ALTER TABLE "tests" ADD COLUMN IF NOT EXISTS "external_case_id" text;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN IF NOT EXISTS "external_source" text;--> statement-breakpoint

-- Backfill rule. Non-archived tests only; the id is the leading `[NCC_TC_00301]` or legacy
-- `NCC_TC_0134 —` token, normalised like normaliseHubCaseId (upper-case prefix, number padded to 5).
-- Where several tests in one (organization, project) carry the same id, the field stays on ONE:
-- the test named in the canonical bracket form `[ID] ...` first, then the lowest test id. The
-- others stay null and are listed by the QA hub audit report (GET /api/v1/qa-hub/audit, `wfm hub audit`),
-- whose `duplicates` list names every id with more than one live test. Nothing is deleted or renamed, so the migration cannot fail on duplicates.
WITH parsed AS (
  SELECT t."id", t."organization_id", coalesce(t."project_id", 0) AS project_key,
         (t."name" ~ '^\s*\[') AS bracketed,
         upper(m[1]) || '_TC_' || CASE WHEN length(m[2]) >= 5 THEN m[2] ELSE lpad(m[2], 5, '0') END AS case_id
  FROM "tests" t,
       LATERAL regexp_match(t."name", '^\s*\[?([A-Za-z0-9]+)_TC_([0-9]{1,6})\]?(?=\s|$|—|–|:|-)', 'i') AS m
  WHERE t."status" <> 'archived' AND t."external_case_id" IS NULL AND m IS NOT NULL
),
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY "organization_id", project_key, case_id ORDER BY bracketed DESC, "id") AS rn
  FROM parsed
)
UPDATE "tests" t SET "external_case_id" = r.case_id, "external_source" = 'qa-hub'
FROM ranked r WHERE r."id" = t."id" AND r.rn = 1;--> statement-breakpoint

ALTER TABLE "tests" ADD CONSTRAINT "tests_external_source_check"
  CHECK ("external_case_id" IS NULL OR "external_source" IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tests_external_case_uniq"
  ON "tests" ("organization_id", coalesce("project_id", 0), "external_source", "external_case_id")
  WHERE "external_case_id" IS NOT NULL AND "status" <> 'archived';

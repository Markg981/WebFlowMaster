-- excel_test_case_id was globally UNIQUE (0000_spooky_hedge_knight.sql:72), from before this
-- table had an organization. Combined with the handler's onConflictDoNothing, that means one
-- tenant claiming an id makes every other tenant's attempt to map the same id answer
-- {success: true} while writing nothing: the caller is told their mapping was saved, and it
-- silently was not. Excel test-case ids come from customers' own spreadsheets, so a collision
-- across tenants is ordinary rather than exotic.
--
-- The identifier is only meaningful within an organization, so that is what it should be
-- unique within.
ALTER TABLE "excel_sequences_map" DROP CONSTRAINT IF EXISTS "excel_sequences_map_excel_test_case_id_unique";
--> statement-breakpoint
ALTER TABLE "excel_sequences_map"
  ADD CONSTRAINT "excel_sequences_map_org_excel_test_case_id_unique"
  UNIQUE ("organization_id", "excel_test_case_id");

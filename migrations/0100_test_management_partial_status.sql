-- A publication that reached the tool for some cases but not all is 'partial', not 'published'
-- (audit C-21).
ALTER TABLE "test_management_publications" DROP CONSTRAINT "test_management_publications_status_known";
--> statement-breakpoint
ALTER TABLE "test_management_publications" ADD CONSTRAINT "test_management_publications_status_known" CHECK ("status" IN ('published', 'partial', 'failed', 'nothing_to_publish'));

CREATE TABLE comments (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_id integer REFERENCES users(id) ON DELETE SET NULL,
  ui_test_id integer REFERENCES tests(id) ON DELETE CASCADE,
  api_test_id integer REFERENCES api_tests(id) ON DELETE CASCADE,
  mobile_test_id integer REFERENCES mobile_tests(id) ON DELETE CASCADE,
  result_id text REFERENCES report_test_case_results(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT comments_one_target CHECK (num_nonnulls(ui_test_id, api_test_id, mobile_test_id, result_id) = 1),
  CONSTRAINT comments_body_length CHECK (length(btrim(body)) BETWEEN 1 AND 5000)
);
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comments_author_id_same_org_fk
  FOREIGN KEY (author_id, organization_id) REFERENCES users(id, organization_id);
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comments_ui_test_id_same_org_fk
  FOREIGN KEY (ui_test_id, organization_id) REFERENCES tests(id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comments_api_test_id_same_org_fk
  FOREIGN KEY (api_test_id, organization_id) REFERENCES api_tests(id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comments_mobile_test_id_same_org_fk
  FOREIGN KEY (mobile_test_id, organization_id) REFERENCES mobile_tests(id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE report_test_case_results ADD CONSTRAINT report_test_case_results_id_organization_unique
  UNIQUE (id, organization_id);
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comments_result_id_same_org_fk
  FOREIGN KEY (result_id, organization_id) REFERENCES report_test_case_results(id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX comments_ui_idx ON comments(ui_test_id);
--> statement-breakpoint
CREATE INDEX comments_api_idx ON comments(api_test_id);
--> statement-breakpoint
CREATE INDEX comments_mobile_idx ON comments(mobile_test_id);
--> statement-breakpoint
CREATE INDEX comments_result_idx ON comments(result_id);
--> statement-breakpoint
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE comments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON comments
 USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::integer)
 WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::integer);
--> statement-breakpoint
-- Target SELECT policies carry project restrictions, including historical result discussions.
CREATE POLICY target_visible ON comments AS RESTRICTIVE
 USING (
   (ui_test_id IS NOT NULL AND EXISTS (SELECT 1 FROM tests t WHERE t.id = ui_test_id AND t.organization_id = comments.organization_id))
   OR (api_test_id IS NOT NULL AND EXISTS (SELECT 1 FROM api_tests t WHERE t.id = api_test_id AND t.organization_id = comments.organization_id))
   OR (mobile_test_id IS NOT NULL AND EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = mobile_test_id AND t.organization_id = comments.organization_id))
   OR (result_id IS NOT NULL AND EXISTS (SELECT 1 FROM report_test_case_results r WHERE r.id = result_id AND r.organization_id = comments.organization_id
     AND (r.ui_test_id IS NULL OR EXISTS (SELECT 1 FROM tests t WHERE t.id = r.ui_test_id))
     AND (r.api_test_id IS NULL OR EXISTS (SELECT 1 FROM api_tests t WHERE t.id = r.api_test_id))
     AND (r.mobile_test_id IS NULL OR EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = r.mobile_test_id))))
 );
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON comments TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE comments_id_seq TO app_user;
--> statement-breakpoint
-- Reports retain deleted tests by setting their originating FK to NULL. Remove discussions
-- while the originating test and its project visibility still exist, so private notes cannot
-- become organization-wide historical discussion after that SET NULL.
CREATE FUNCTION delete_originating_result_comments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM comments c
  USING report_test_case_results r
  WHERE c.result_id = r.id
    AND (
      (TG_TABLE_NAME = 'tests' AND r.ui_test_id = OLD.id)
      OR (TG_TABLE_NAME = 'api_tests' AND r.api_test_id = OLD.id)
      OR (TG_TABLE_NAME = 'mobile_tests' AND r.mobile_test_id = OLD.id)
    );
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER delete_ui_result_comments BEFORE DELETE ON tests
  FOR EACH ROW EXECUTE FUNCTION delete_originating_result_comments();
--> statement-breakpoint
CREATE TRIGGER delete_api_result_comments BEFORE DELETE ON api_tests
  FOR EACH ROW EXECUTE FUNCTION delete_originating_result_comments();
--> statement-breakpoint
CREATE TRIGGER delete_mobile_result_comments BEFORE DELETE ON mobile_tests
  FOR EACH ROW EXECUTE FUNCTION delete_originating_result_comments();
--> statement-breakpoint

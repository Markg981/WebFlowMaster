-- API/mobile definitions share immutable version, publication and review history.
ALTER TABLE api_tests ADD COLUMN published_version integer;
--> statement-breakpoint
ALTER TABLE mobile_tests ADD COLUMN published_version integer;
--> statement-breakpoint
ALTER TABLE mobile_test_runs ADD COLUMN test_version integer;
--> statement-breakpoint
ALTER TABLE mobile_test_runs ADD COLUMN test_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE test_versions ALTER COLUMN test_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE test_versions ADD COLUMN api_test_id integer REFERENCES api_tests(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE test_versions ADD COLUMN mobile_test_id integer REFERENCES mobile_tests(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE test_versions ADD CONSTRAINT test_versions_one_target CHECK (num_nonnulls(test_id, api_test_id, mobile_test_id) = 1);
--> statement-breakpoint
ALTER TABLE test_publications ALTER COLUMN test_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE test_publications ADD COLUMN api_test_id integer REFERENCES api_tests(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE test_publications ADD COLUMN mobile_test_id integer REFERENCES mobile_tests(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE test_publications ADD CONSTRAINT test_publications_one_target CHECK (num_nonnulls(test_id, api_test_id, mobile_test_id) = 1);
--> statement-breakpoint
ALTER TABLE test_reviews ALTER COLUMN test_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE test_reviews ADD COLUMN api_test_id integer REFERENCES api_tests(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE test_reviews ADD COLUMN mobile_test_id integer REFERENCES mobile_tests(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE test_reviews ADD CONSTRAINT test_reviews_one_target CHECK (num_nonnulls(test_id, api_test_id, mobile_test_id) = 1);
--> statement-breakpoint
ALTER TABLE test_versions ADD COLUMN snapshot jsonb;
--> statement-breakpoint
ALTER TABLE test_versions ADD CONSTRAINT test_versions_typed_snapshot CHECK (test_id IS NOT NULL OR snapshot IS NOT NULL);
--> statement-breakpoint
ALTER TABLE test_versions ADD CONSTRAINT test_versions_api_version_unique UNIQUE(api_test_id, version);
--> statement-breakpoint
ALTER TABLE test_versions ADD CONSTRAINT test_versions_mobile_version_unique UNIQUE(mobile_test_id, version);
--> statement-breakpoint
CREATE UNIQUE INDEX test_reviews_one_pending_per_api_test_id ON test_reviews(api_test_id) WHERE status = 'pending';
--> statement-breakpoint
CREATE UNIQUE INDEX test_reviews_one_pending_per_mobile_test_id ON test_reviews(mobile_test_id) WHERE status = 'pending';
--> statement-breakpoint
DROP POLICY project_read ON test_versions;
--> statement-breakpoint
CREATE POLICY project_read ON test_versions AS RESTRICTIVE FOR SELECT USING (EXISTS (SELECT 1 FROM tests t WHERE t.id = test_versions.test_id AND t.organization_id = test_versions.organization_id) OR EXISTS (SELECT 1 FROM api_tests t WHERE t.id = test_versions.api_test_id AND t.organization_id = test_versions.organization_id) OR EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = test_versions.mobile_test_id AND t.organization_id = test_versions.organization_id));
--> statement-breakpoint
CREATE POLICY project_insert ON test_versions AS RESTRICTIVE FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM tests t WHERE t.id = test_versions.test_id AND t.organization_id = test_versions.organization_id AND app_project_editable(t.project_id)) OR EXISTS (SELECT 1 FROM api_tests t WHERE t.id = test_versions.api_test_id AND t.organization_id = test_versions.organization_id AND app_project_editable(t.project_id)) OR EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = test_versions.mobile_test_id AND t.organization_id = test_versions.organization_id AND app_project_editable(t.project_id)));
--> statement-breakpoint
DROP POLICY project_read ON test_publications;
--> statement-breakpoint
CREATE POLICY project_read ON test_publications AS RESTRICTIVE FOR SELECT USING (EXISTS (SELECT 1 FROM tests t WHERE t.id = test_publications.test_id AND t.organization_id = test_publications.organization_id) OR EXISTS (SELECT 1 FROM api_tests t WHERE t.id = test_publications.api_test_id AND t.organization_id = test_publications.organization_id) OR EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = test_publications.mobile_test_id AND t.organization_id = test_publications.organization_id));
--> statement-breakpoint
CREATE POLICY project_insert ON test_publications AS RESTRICTIVE FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM tests t WHERE t.id = test_publications.test_id AND t.organization_id = test_publications.organization_id AND app_project_editable(t.project_id)) OR EXISTS (SELECT 1 FROM api_tests t WHERE t.id = test_publications.api_test_id AND t.organization_id = test_publications.organization_id AND app_project_editable(t.project_id)) OR EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = test_publications.mobile_test_id AND t.organization_id = test_publications.organization_id AND app_project_editable(t.project_id)));
--> statement-breakpoint
DROP POLICY project_read ON test_reviews;
--> statement-breakpoint
CREATE POLICY project_read ON test_reviews AS RESTRICTIVE FOR SELECT USING (EXISTS (SELECT 1 FROM tests t WHERE t.id = test_reviews.test_id AND t.organization_id = test_reviews.organization_id) OR EXISTS (SELECT 1 FROM api_tests t WHERE t.id = test_reviews.api_test_id AND t.organization_id = test_reviews.organization_id) OR EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = test_reviews.mobile_test_id AND t.organization_id = test_reviews.organization_id));
--> statement-breakpoint
CREATE POLICY project_insert ON test_reviews AS RESTRICTIVE FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM tests t WHERE t.id = test_reviews.test_id AND t.organization_id = test_reviews.organization_id AND app_project_editable(t.project_id)) OR EXISTS (SELECT 1 FROM api_tests t WHERE t.id = test_reviews.api_test_id AND t.organization_id = test_reviews.organization_id AND app_project_editable(t.project_id)) OR EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = test_reviews.mobile_test_id AND t.organization_id = test_reviews.organization_id AND app_project_editable(t.project_id)));
--> statement-breakpoint
CREATE POLICY project_update ON test_reviews AS RESTRICTIVE FOR UPDATE USING (EXISTS (SELECT 1 FROM tests t WHERE t.id = test_reviews.test_id AND t.organization_id = test_reviews.organization_id AND app_project_editable(t.project_id)) OR EXISTS (SELECT 1 FROM api_tests t WHERE t.id = test_reviews.api_test_id AND t.organization_id = test_reviews.organization_id AND app_project_editable(t.project_id)) OR EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = test_reviews.mobile_test_id AND t.organization_id = test_reviews.organization_id AND app_project_editable(t.project_id))) WITH CHECK (EXISTS (SELECT 1 FROM tests t WHERE t.id = test_reviews.test_id AND t.organization_id = test_reviews.organization_id AND app_project_editable(t.project_id)) OR EXISTS (SELECT 1 FROM api_tests t WHERE t.id = test_reviews.api_test_id AND t.organization_id = test_reviews.organization_id AND app_project_editable(t.project_id)) OR EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = test_reviews.mobile_test_id AND t.organization_id = test_reviews.organization_id AND app_project_editable(t.project_id)));
--> statement-breakpoint
INSERT INTO test_versions(organization_id,api_test_id,version,name,url,sequence,elements,snapshot,summary,created_by) SELECT t.organization_id,t.id,1,t.name,t.url,'[]'::jsonb,'[]'::jsonb,jsonb_build_object('name', t.name, 'method', t.method, 'url', t.url, 'queryParams', t.query_params, 'requestHeaders', t.request_headers, 'requestBody', t.request_body, 'assertions', t.assertions, 'extractions', t.extractions, 'performance', t.performance, 'authType', t.auth_type, 'authParams', t.auth_params, 'bodyType', t.body_type, 'bodyRawContentType', t.body_raw_content_type, 'bodyFormData', t.body_form_data, 'bodyUrlEncoded', t.body_url_encoded, 'bodyGraphqlQuery', t.body_graphql_query, 'bodyGraphqlVariables', t.body_graphql_variables, 'protoDefinition', t.proto_definition, 'module', t.module, 'featureArea', t.feature_area, 'scenario', t.scenario, 'component', t.component, 'priority', t.priority, 'severity', t.severity),'Baseline of current definition; earlier runs are unversioned.',t.user_id FROM api_tests t;
--> statement-breakpoint
INSERT INTO test_versions(organization_id,mobile_test_id,version,name,url,sequence,elements,snapshot,summary,created_by) SELECT t.organization_id,t.id,1,t.name,'','[]'::jsonb,'[]'::jsonb,jsonb_build_object('name', t.name, 'platform', t.platform, 'app', t.app, 'deviceName', t.device_name, 'osVersion', t.os_version, 'gridId', t.grid_id, 'steps', t.steps),'Baseline of current definition; earlier runs are unversioned.',t.created_by FROM mobile_tests t;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON test_versions, test_publications FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON test_versions, test_publications TO app_user;

--> statement-breakpoint
ALTER TABLE test_versions ADD CONSTRAINT test_versions_api_test_id_same_org_fk FOREIGN KEY(api_test_id,organization_id) REFERENCES api_tests(id,organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE test_versions ADD CONSTRAINT test_versions_mobile_test_id_same_org_fk FOREIGN KEY(mobile_test_id,organization_id) REFERENCES mobile_tests(id,organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE test_publications ADD CONSTRAINT test_publications_api_test_id_same_org_fk FOREIGN KEY(api_test_id,organization_id) REFERENCES api_tests(id,organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE test_publications ADD CONSTRAINT test_publications_mobile_test_id_same_org_fk FOREIGN KEY(mobile_test_id,organization_id) REFERENCES mobile_tests(id,organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE test_reviews ADD CONSTRAINT test_reviews_api_test_id_same_org_fk FOREIGN KEY(api_test_id,organization_id) REFERENCES api_tests(id,organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE test_reviews ADD CONSTRAINT test_reviews_mobile_test_id_same_org_fk FOREIGN KEY(mobile_test_id,organization_id) REFERENCES mobile_tests(id,organization_id) ON DELETE CASCADE;

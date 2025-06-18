ALTER TABLE api_tests ADD COLUMN auth_type TEXT;
ALTER TABLE api_tests ADD COLUMN auth_params TEXT; -- JSON stored as TEXT
ALTER TABLE api_tests ADD COLUMN body_type TEXT;
ALTER TABLE api_tests ADD COLUMN body_raw_content_type TEXT;
ALTER TABLE api_tests ADD COLUMN body_form_data TEXT; -- JSON stored as TEXT
ALTER TABLE api_tests ADD COLUMN body_url_encoded TEXT; -- JSON stored as TEXT
ALTER TABLE api_tests ADD COLUMN body_graphql_query TEXT;
ALTER TABLE api_tests ADD COLUMN body_graphql_variables TEXT;

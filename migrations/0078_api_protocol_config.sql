ALTER TABLE api_tests ADD COLUMN protocol_config jsonb;
--> statement-breakpoint
ALTER TABLE api_tests ADD CONSTRAINT api_tests_protocol_config_object CHECK (protocol_config IS NULL OR jsonb_typeof(protocol_config) = 'object');

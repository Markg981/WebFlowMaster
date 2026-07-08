CREATE TABLE "api_test_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"method" text NOT NULL,
	"url" text NOT NULL,
	"query_params" jsonb,
	"request_headers" jsonb,
	"request_body" text,
	"response_status" integer,
	"response_headers" jsonb,
	"response_body" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"project_id" integer,
	"name" text NOT NULL,
	"method" text NOT NULL,
	"url" text NOT NULL,
	"query_params" jsonb,
	"request_headers" jsonb,
	"request_body" text,
	"assertions" jsonb,
	"auth_type" text,
	"auth_params" jsonb,
	"body_type" text,
	"body_raw_content_type" text,
	"body_form_data" jsonb,
	"body_url_encoded" jsonb,
	"body_graphql_query" text,
	"body_graphql_variables" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"module" text,
	"feature_area" text,
	"scenario" text,
	"component" text,
	"priority" text DEFAULT 'Medium',
	"severity" text DEFAULT 'Major'
);
--> statement-breakpoint
CREATE TABLE "detected_elements" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_id" integer NOT NULL,
	"element_id" text NOT NULL,
	"selector" text NOT NULL,
	"original_selector" text,
	"type" text,
	"text" text,
	"tag" text,
	"attributes" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "environments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "excel_sequences_map" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_id" integer NOT NULL,
	"excel_test_case_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "excel_sequences_map_excel_test_case_id_unique" UNIQUE("excel_test_case_id")
);
--> statement-breakpoint
CREATE TABLE "execution_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_plan_execution_id" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"test_case_result_id" text,
	"correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_test_case_results" (
	"id" text PRIMARY KEY NOT NULL,
	"test_plan_execution_id" text NOT NULL,
	"ui_test_id" integer,
	"api_test_id" integer,
	"test_type" text NOT NULL,
	"test_name" text NOT NULL,
	"status" text NOT NULL,
	"reason_for_failure" text,
	"screenshot_url" text,
	"detailed_log" text,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"module" text,
	"feature_area" text,
	"scenario" text,
	"component" text,
	"priority" text,
	"severity" text
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"environment_id" integer NOT NULL,
	"key_name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "test_plan_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text,
	"test_plan_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"results" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"environment" text,
	"browsers" jsonb,
	"triggered_by" text DEFAULT 'manual' NOT NULL,
	"total_tests" integer,
	"passed_tests" integer,
	"failed_tests" integer,
	"skipped_tests" integer,
	"execution_duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "test_plan_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"test_plan_id" text NOT NULL,
	"schedule_name" text NOT NULL,
	"frequency" text NOT NULL,
	"next_run_at" timestamp NOT NULL,
	"environment" text,
	"browsers" jsonb,
	"notification_config_override" jsonb,
	"execution_parameters" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"retry_on_failure" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "test_plan_selected_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_plan_id" text NOT NULL,
	"test_id" integer,
	"api_test_id" integer,
	"test_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_plan_webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_plan_id" text NOT NULL,
	"token" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "test_plan_webhooks_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "test_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"test_machines_config" jsonb,
	"capture_screenshots" text DEFAULT 'on_failed_steps',
	"visual_testing_enabled" boolean DEFAULT false,
	"page_load_timeout" integer DEFAULT 30000,
	"element_timeout" integer DEFAULT 30000,
	"on_major_step_failure" text DEFAULT 'abort_and_run_next_test_case',
	"on_aborted_test_case" text DEFAULT 'delete_cookies_and_reuse_session',
	"on_test_suite_pre_requisite_failure" text DEFAULT 'stop_execution',
	"on_test_case_pre_requisite_failure" text DEFAULT 'stop_execution',
	"on_test_step_pre_requisite_failure" text DEFAULT 'abort_and_run_next_test_case',
	"re_run_on_failure" text DEFAULT 'none',
	"notification_settings" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_id" integer NOT NULL,
	"status" text NOT NULL,
	"results" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"project_id" integer,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"sequence" jsonb NOT NULL,
	"elements" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"module" text,
	"feature_area" text,
	"scenario" text,
	"component" text,
	"priority" text DEFAULT 'Medium',
	"severity" text DEFAULT 'Major'
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"theme" text DEFAULT 'light' NOT NULL,
	"default_test_url" text,
	"playwright_browser" text DEFAULT 'chromium' NOT NULL,
	"playwright_headless" boolean DEFAULT true NOT NULL,
	"playwright_default_timeout" integer DEFAULT 30000 NOT NULL,
	"playwright_wait_time" integer DEFAULT 1000 NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "api_test_history" ADD CONSTRAINT "api_test_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tests" ADD CONSTRAINT "api_tests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tests" ADD CONSTRAINT "api_tests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detected_elements" ADD CONSTRAINT "detected_elements_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_sequences_map" ADD CONSTRAINT "excel_sequences_map_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_test_plan_execution_id_test_plan_executions_id_fk" FOREIGN KEY ("test_plan_execution_id") REFERENCES "public"."test_plan_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_test_case_results" ADD CONSTRAINT "report_test_case_results_test_plan_execution_id_test_plan_executions_id_fk" FOREIGN KEY ("test_plan_execution_id") REFERENCES "public"."test_plan_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_test_case_results" ADD CONSTRAINT "report_test_case_results_ui_test_id_tests_id_fk" FOREIGN KEY ("ui_test_id") REFERENCES "public"."tests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_test_case_results" ADD CONSTRAINT "report_test_case_results_api_test_id_api_tests_id_fk" FOREIGN KEY ("api_test_id") REFERENCES "public"."api_tests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan_executions" ADD CONSTRAINT "test_plan_executions_schedule_id_test_plan_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."test_plan_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan_executions" ADD CONSTRAINT "test_plan_executions_test_plan_id_test_plans_id_fk" FOREIGN KEY ("test_plan_id") REFERENCES "public"."test_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan_schedules" ADD CONSTRAINT "test_plan_schedules_test_plan_id_test_plans_id_fk" FOREIGN KEY ("test_plan_id") REFERENCES "public"."test_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan_selected_tests" ADD CONSTRAINT "test_plan_selected_tests_test_plan_id_test_plans_id_fk" FOREIGN KEY ("test_plan_id") REFERENCES "public"."test_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan_selected_tests" ADD CONSTRAINT "test_plan_selected_tests_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan_selected_tests" ADD CONSTRAINT "test_plan_selected_tests_api_test_id_api_tests_id_fk" FOREIGN KEY ("api_test_id") REFERENCES "public"."api_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan_webhooks" ADD CONSTRAINT "test_plan_webhooks_test_plan_id_test_plans_id_fk" FOREIGN KEY ("test_plan_id") REFERENCES "public"."test_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plans" ADD CONSTRAINT "test_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE TABLE `api_test_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`method` text NOT NULL,
	`url` text NOT NULL,
	`query_params` text,
	`request_headers` text,
	`request_body` text,
	`response_status` integer,
	`response_headers` text,
	`response_body` text,
	`duration_ms` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `api_tests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`project_id` integer,
	`name` text NOT NULL,
	`method` text NOT NULL,
	`url` text NOT NULL,
	`query_params` text,
	`request_headers` text,
	`request_body` text,
	`assertions` text,
	`auth_type` text,
	`auth_params` text,
	`body_type` text,
	`body_raw_content_type` text,
	`body_form_data` text,
	`body_url_encoded` text,
	`body_graphql_query` text,
	`body_graphql_variables` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_name` text NOT NULL,
	`test_plan_id` text,
	`test_plan_name` text,
	`frequency` text NOT NULL,
	`next_run_at` integer NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer
);

CREATE TABLE `test_plan_selected_tests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_plan_id` text NOT NULL,
	`test_id` integer,
	`api_test_id` integer,
	`test_type` text NOT NULL,
	FOREIGN KEY (`test_plan_id`) REFERENCES `test_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`api_test_id`) REFERENCES `api_tests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`project_id` integer,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`sequence` text NOT NULL,
	`elements` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_tests`("id", "user_id", "project_id", "name", "url", "sequence", "elements", "status", "created_at", "updated_at") SELECT "id", "user_id", "project_id", "name", "url", "sequence", "elements", "status", "created_at", "updated_at" FROM `tests`;--> statement-breakpoint
DROP TABLE `tests`;--> statement-breakpoint
ALTER TABLE `__new_tests` RENAME TO `tests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `test_plans` ADD `test_machines_config` text;--> statement-breakpoint
ALTER TABLE `test_plans` ADD `capture_screenshots` text DEFAULT 'on_failed_steps';--> statement-breakpoint
ALTER TABLE `test_plans` ADD `visual_testing_enabled` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `test_plans` ADD `page_load_timeout` integer DEFAULT 30000;--> statement-breakpoint
ALTER TABLE `test_plans` ADD `element_timeout` integer DEFAULT 30000;--> statement-breakpoint
ALTER TABLE `test_plans` ADD `on_major_step_failure` text DEFAULT 'abort_and_run_next_test_case';--> statement-breakpoint
ALTER TABLE `test_plans` ADD `on_aborted_test_case` text DEFAULT 'delete_cookies_and_reuse_session';--> statement-breakpoint
ALTER TABLE `test_plans` ADD `on_test_suite_pre_requisite_failure` text DEFAULT 'stop_execution';--> statement-breakpoint
ALTER TABLE `test_plans` ADD `on_test_case_pre_requisite_failure` text DEFAULT 'stop_execution';--> statement-breakpoint
ALTER TABLE `test_plans` ADD `on_test_step_pre_requisite_failure` text DEFAULT 'abort_and_run_next_test_case';--> statement-breakpoint
ALTER TABLE `test_plans` ADD `re_run_on_failure` text DEFAULT 'none';--> statement-breakpoint
ALTER TABLE `test_plans` ADD `notification_settings` text;
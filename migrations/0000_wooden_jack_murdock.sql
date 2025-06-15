CREATE TABLE `test_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_id` integer NOT NULL,
	`status` text NOT NULL,
	`results` text,
	`started_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`sequence` text NOT NULL,
	`elements` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'light' NOT NULL,
	`default_test_url` text,
	`playwright_browser` text DEFAULT 'chromium' NOT NULL,
	`playwright_headless` integer DEFAULT true NOT NULL,
	`playwright_default_timeout` integer DEFAULT 30000 NOT NULL,
	`playwright_wait_time` integer DEFAULT 1000 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
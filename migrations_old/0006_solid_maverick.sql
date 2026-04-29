CREATE TABLE `test_plan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`test_plan_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`results` text,
	`started_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`test_plan_id`) REFERENCES `test_plans`(`id`) ON UPDATE no action ON DELETE cascade
);

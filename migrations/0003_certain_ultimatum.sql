PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_name` text NOT NULL,
	`test_plan_id` text NOT NULL,
	`frequency` text NOT NULL,
	`next_run_at` integer NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`test_plan_id`) REFERENCES `test_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_schedules`("id", "schedule_name", "test_plan_id", "frequency", "next_run_at", "created_at", "updated_at") SELECT "id", "schedule_name", "test_plan_id", "frequency", "next_run_at", "created_at", "updated_at" FROM `schedules`;--> statement-breakpoint
DROP TABLE `schedules`;--> statement-breakpoint
ALTER TABLE `__new_schedules` RENAME TO `schedules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
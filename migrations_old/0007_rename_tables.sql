-- Rename 'schedules' to 'test_plan_schedules'
ALTER TABLE `schedules` RENAME TO `test_plan_schedules`;

-- Rename 'test_plan_runs' to 'test_plan_executions'
ALTER TABLE `test_plan_runs` RENAME TO `test_plan_executions`;

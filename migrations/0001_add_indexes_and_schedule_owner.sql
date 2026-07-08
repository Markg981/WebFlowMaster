ALTER TABLE "test_plan_schedules" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "test_plan_schedules" ADD CONSTRAINT "test_plan_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_test_history_user_id_idx" ON "api_test_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_tests_user_id_idx" ON "api_tests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_tests_project_id_idx" ON "api_tests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "detected_elements_test_id_idx" ON "detected_elements" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "detected_elements_test_id_element_id_idx" ON "detected_elements" USING btree ("test_id","element_id");--> statement-breakpoint
CREATE INDEX "environments_user_id_idx" ON "environments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "excel_sequences_map_test_id_idx" ON "excel_sequences_map" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "execution_logs_execution_id_idx" ON "execution_logs" USING btree ("test_plan_execution_id");--> statement-breakpoint
CREATE INDEX "execution_logs_correlation_id_idx" ON "execution_logs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "projects_user_id_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_test_case_results_execution_id_idx" ON "report_test_case_results" USING btree ("test_plan_execution_id");--> statement-breakpoint
CREATE INDEX "report_test_case_results_ui_test_id_idx" ON "report_test_case_results" USING btree ("ui_test_id");--> statement-breakpoint
CREATE INDEX "report_test_case_results_api_test_id_idx" ON "report_test_case_results" USING btree ("api_test_id");--> statement-breakpoint
CREATE INDEX "secrets_environment_id_idx" ON "secrets" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "secrets_user_id_idx" ON "secrets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expire_idx" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "test_plan_executions_test_plan_id_idx" ON "test_plan_executions" USING btree ("test_plan_id");--> statement-breakpoint
CREATE INDEX "test_plan_executions_schedule_id_idx" ON "test_plan_executions" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "test_plan_executions_status_idx" ON "test_plan_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "test_plan_executions_started_at_idx" ON "test_plan_executions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "test_plan_schedules_test_plan_id_idx" ON "test_plan_schedules" USING btree ("test_plan_id");--> statement-breakpoint
CREATE INDEX "test_plan_schedules_user_id_idx" ON "test_plan_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "test_plan_schedules_active_next_run_idx" ON "test_plan_schedules" USING btree ("is_active","next_run_at");--> statement-breakpoint
CREATE INDEX "test_plan_selected_tests_test_plan_id_idx" ON "test_plan_selected_tests" USING btree ("test_plan_id");--> statement-breakpoint
CREATE INDEX "test_plan_selected_tests_test_id_idx" ON "test_plan_selected_tests" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "test_plan_selected_tests_api_test_id_idx" ON "test_plan_selected_tests" USING btree ("api_test_id");--> statement-breakpoint
CREATE INDEX "test_plan_webhooks_test_plan_id_idx" ON "test_plan_webhooks" USING btree ("test_plan_id");--> statement-breakpoint
CREATE INDEX "test_plans_user_id_idx" ON "test_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "test_runs_test_id_idx" ON "test_runs" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "tests_user_id_idx" ON "tests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tests_project_id_idx" ON "tests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tests_status_idx" ON "tests" USING btree ("status");
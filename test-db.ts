import 'dotenv/config';
import { db } from './server/db';
import { sql } from 'drizzle-orm';
import * as schema from './shared/schema';

async function checkAllTables() {
  const tables = [
    { name: 'users', columns: ['id', 'username', 'password', 'created_at'] },
    { name: 'user_settings', columns: ['user_id', 'theme', 'default_test_url', 'playwright_browser', 'playwright_headless', 'playwright_default_timeout', 'playwright_wait_time', 'language', 'updated_at'] },
    { name: 'projects', columns: ['id', 'name', 'user_id', 'created_at'] },
    { name: 'tests', columns: ['id', 'user_id', 'project_id', 'name', 'url', 'sequence', 'elements', 'status', 'created_at', 'updated_at', 'module', 'feature_area', 'scenario', 'component', 'priority', 'severity'] },
    { name: 'test_runs', columns: ['id', 'test_id', 'status', 'results', 'started_at', 'completed_at'] },
    { name: 'api_test_history', columns: ['id', 'user_id', 'method', 'url', 'query_params', 'request_headers', 'request_body', 'response_status', 'response_headers', 'response_body', 'duration_ms', 'created_at'] },
    { name: 'api_tests', columns: ['id', 'user_id', 'project_id', 'name', 'method', 'url', 'query_params', 'request_headers', 'request_body', 'assertions', 'auth_type', 'auth_params', 'body_type', 'body_raw_content_type', 'body_form_data', 'body_url_encoded', 'body_graphql_query', 'body_graphql_variables', 'created_at', 'updated_at', 'module', 'feature_area', 'scenario', 'component', 'priority', 'severity'] },
    { name: 'system_settings', columns: ['key', 'value'] },
    { name: 'test_plans', columns: ['id', 'user_id', 'name', 'description', 'test_machines_config', 'capture_screenshots', 'visual_testing_enabled', 'page_load_timeout', 'element_timeout', 'on_major_step_failure', 'on_aborted_test_case', 'on_test_suite_pre_requisite_failure', 'on_test_case_pre_requisite_failure', 'on_test_step_pre_requisite_failure', 're_run_on_failure', 'notification_settings', 'created_at', 'updated_at'] },
    { name: 'test_plan_schedules', columns: ['id', 'test_plan_id', 'schedule_name', 'frequency', 'next_run_at', 'environment', 'browsers', 'notification_config_override', 'execution_parameters', 'is_active', 'retry_on_failure', 'created_at', 'updated_at'] },
    { name: 'test_plan_executions', columns: ['id', 'schedule_id', 'test_plan_id', 'status', 'results', 'started_at', 'completed_at', 'environment', 'browsers', 'triggered_by', 'total_tests', 'passed_tests', 'failed_tests', 'skipped_tests', 'execution_duration_ms'] },
    { name: 'report_test_case_results', columns: ['id', 'test_plan_execution_id', 'ui_test_id', 'api_test_id', 'test_type', 'test_name', 'status', 'reason_for_failure', 'screenshot_url', 'detailed_log', 'started_at', 'completed_at', 'duration_ms', 'module', 'feature_area', 'scenario', 'component', 'priority', 'severity'] },
  ];

  for (const table of tables) {
    console.log(`\n--- Checking ${table.name} ---`);
    for (const col of table.columns) {
      try {
        await db.execute(sql`SELECT ${sql.identifier(col)} FROM ${sql.identifier(table.name)} LIMIT 1`);
        // console.log(`  ${col}: OK`);
      } catch (e) {
        console.log(`  ${col}: MISSING!`);
      }
    }
  }
}

checkAllTables();

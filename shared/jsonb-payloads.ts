/**
 * How each jsonb column survives a change to the shape of what it holds.
 *
 * - versioned: an object payload carrying schemaVersion, read through a VersionedPayload
 *   (payload-version.ts) that upgrades old rows on read. Changing the shape means bumping the
 *   version and adding an upgrade; old rows stay as they are.
 * - migration: the server reads and interprets the value, but it carries no version (an
 *   array, or a payload older than this catalog). Changing the shape means a data migration
 *   in migrations/ that rewrites existing rows, in the same PR as the code that reads the new
 *   shape.
 * - snapshot: a historical record (test versions, what a run was queued with). Never rewritten:
 *   run snapshots are fingerprinted for reproducibility and a version is what was published.
 *   Code that reads one, to restore it or run it again, accepts every shape ever written.
 * - opaque: stored and handed back as written, never interpreted (audit metadata, recorded
 *   headers, the session store, encrypted envelopes). No shape to migrate.
 *
 * server/jsonb-payloads.test.ts fails when a jsonb column is missing here, so a new column
 * cannot land without choosing one.
 */
export type JsonbStrategy = 'versioned' | 'migration' | 'snapshot' | 'opaque';

export const JSONB_PAYLOADS: Record<string, JsonbStrategy> = {
  'agents.bdd_profiles': 'migration',
  'agents.browsers': 'migration',
  'api_test_history.query_params': 'opaque',
  'api_test_history.request_headers': 'opaque',
  'api_test_history.response_headers': 'opaque',
  'api_tests.assertions': 'migration',
  'api_tests.auth_params': 'migration',
  'api_tests.body_form_data': 'migration',
  'api_tests.body_url_encoded': 'migration',
  'api_tests.extractions': 'migration',
  'api_tests.performance': 'migration',
  'api_tests.protocol_config': 'migration',
  'api_tests.query_params': 'migration',
  'api_tests.request_headers': 'migration',
  'audit_log.metadata': 'opaque',
  // A provider's webhook body, kept as received for the ledger: never interpreted again.
  'billing_events.payload': 'opaque',
  // Provider price ids by interval; the server reads them when it opens a checkout.
  'billing_plans.provider_price_ids': 'migration',
  'comments.mentioned_user_ids': 'migration',
  'custom_actions.parameters': 'migration',
  'dashboards.widgets': 'migration',
  'detected_elements.attributes': 'opaque',
  'execution_logs.metadata': 'opaque',
  // What one attempt left behind (AttemptEvidenceRecord, migration 0092): written once when the
  // attempt ends, read by the report and the API; a new shape needs a data migration.
  'execution_unit_attempts.evidence': 'migration',
  // Where a unit runs (shared/execution-identity.ts): written once with the manifest and never
  // rewritten — the unit id is a hash of it.
  'execution_units.coordinates': 'snapshot',
  // The group calls that led to a healed step, as the run read them (migration 0094): a record of
  // that run, never rewritten.
  'healing_proposals.call_path': 'snapshot',
  // The ids of the hub cases a case depends on, as the hub lists them: a plain array of strings.
  'hub_test_cases.depends_on': 'migration',
  'load_test_runs.definition': 'snapshot',
  'load_test_runs.summary': 'migration',
  'load_tests.stages': 'migration',
  'load_tests.steps': 'migration',
  'load_tests.thresholds': 'migration',
  'mobile_step_groups.steps': 'migration',
  'mobile_test_runs.steps': 'migration',
  'mobile_test_runs.test_snapshot': 'snapshot',
  'mobile_tests.device_matrix': 'migration',
  'mobile_tests.steps': 'migration',
  'organization_mail_settings.signing_secret': 'opaque',
  'organization_mail_settings.smtp_password': 'opaque',
  'organization_sso.role_mappings': 'migration',
  'project_elements.attributes': 'opaque',
  'report_test_case_results.ai_analysis': 'versioned',
  'report_test_case_results.network_summary': 'migration',
  'run_work_items.results': 'migration',
  'run_work_items.unit': 'migration',
  'runners.browsers': 'migration',
  'sessions.sess': 'opaque',
  'step_groups.sequence': 'migration',
  'test_data_sets.columns': 'migration',
  'test_data_sets.rows': 'migration',
  // A run's job data, handed to the queue as written and deleted once it is there. Its shape is
  // the job's, which the worker already reads compatibly across a rolling deploy.
  'execution_outbox.payload': 'opaque',
  'test_plan_executions.browsers': 'migration',
  'test_plan_executions.ci_context': 'migration',
  'test_plan_executions.configuration_snapshot': 'snapshot',
  'test_plan_executions.results': 'migration',
  'test_plan_schedules.browsers': 'migration',
  'test_plan_schedules.execution_parameters': 'migration',
  'test_plan_schedules.notification_config_override': 'migration',
  'test_plans.locales': 'migration',
  'test_plans.notification_settings': 'migration',
  'test_plans.test_machines_config': 'migration',
  'test_runs.results': 'migration',
  'test_suites.tag_ids': 'migration',
  'test_versions.bdd': 'snapshot',
  'test_versions.cleanups': 'snapshot',
  'test_versions.dataset': 'snapshot',
  'test_versions.elements': 'snapshot',
  'test_versions.preconditions': 'snapshot',
  'test_versions.sequence': 'snapshot',
  'test_versions.snapshot': 'snapshot',
  'tests.bdd': 'migration',
  'tests.cleanups': 'migration',
  'tests.dataset': 'migration',
  'tests.elements': 'migration',
  'tests.preconditions': 'migration',
  'tests.sequence': 'migration',
  'user_dashboard_layouts.widgets': 'migration',
  'user_mfa.recovery_codes': 'migration',
};

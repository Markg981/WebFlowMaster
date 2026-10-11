/** The organization-scoped tables, protected by row-level security. */

/**
 * Tables whose rows belong to exactly one organization and are therefore protected by an
 * RLS policy. Exported so tests can enumerate them from the schema rather than from a
 * hand-maintained list, which would be forgotten the first time a table is added.
 */
export const ORG_SCOPED_TABLES = [
  'browser_grids',
  'projects',
  'tests',
  'test_runs',
  'detected_elements',
  'api_tests',
  'api_test_history',
  'test_plans',
  'test_plan_schedules',
  'test_plan_executions',
  'test_plan_selected_tests',
  'test_plan_webhooks',
  'report_test_case_results',
  'execution_logs',
  'environments',
  'secrets',
  'excel_sequences_map',
  // audit_log is org-scoped like the rest, but its grants are narrower: SELECT and INSERT
  // only, so the application cannot rewrite history. See migration 0009.
  'audit_log',
  // Shared building blocks rather than per-test copies: a sequence many tests call, and the
  // elements of one application. Org-scoped and policed like everything else.
  'step_groups',
  'project_elements',
  // What a test is for, and what it used to be. test_versions is granted SELECT and INSERT
  // only — the application cannot rewrite its own history. See migration 0018.
  'tags',
  'test_tags',
  'test_versions',
  // Where a failure is filed, and which failure produced which issue.
  'issue_trackers',
  'issue_links',
  // api_keys is org-scoped and policed like the rest. Unlike `invitations`, which cannot be,
  // the one lookup that must happen before an organization is known — authenticating a
  // request that carries a key — is a privileged bootstrap read in middleware, the same shape
  // as passport's deserializeUser. Every other access is an ordinary request.
  'api_keys',
  // Who is on a restricted project. Org-scoped like the rest; what they see inside the
  // organization is narrowed further by the project policies of migration 0031.
  'project_members',
  // Which version of a test is live, and the reviews that put it there (migration 0032).
  // test_publications is SELECT and INSERT only: a publication history is evidence.
  'test_publications',
  'test_reviews',
  // Suites, their tests, and the plans that include them (migration 0034).
  'test_suites',
  'test_suite_items',
  'test_plan_suites',
  // Requirements and the tests that cover them (migration 0050).
  'requirements',
  'requirement_tests',
  // TestRail, Xray and Zephyr Scale connections, test-to-case links and publications (migration 0051).
  'test_management_connections',
  'test_case_links',
  'test_management_publications',
  // Tests of native mobile apps and their runs (migration 0052).
  'mobile_tests',
  'mobile_test_runs',
  'mobile_step_groups',
  'test_quarantines',
  'agents',
  'bdd_execution_profiles',
  'quota_execution_sessions',
  'quota_artifacts',
  'source_hosts',
  // One-time links to choose a new password (migration 0042). Redeeming one is the privileged
  // bootstrap in server/storage.ts; issuing and listing them happen inside the organization.
  'password_resets',
  // The organization's own steps (migration 0046).
  'custom_actions',
  // Shared test data (migration 0061).
  'test_data_sets',
  // The work of a run shared by several workers (migration 0067).
  'run_work_items',
  // Which files map to which tests' tags (migration 0068).
  'impact_rules',
  // Text messages the test numbers received (migration 0070).
  'sms_messages',
  'comments',
  'user_dashboard_layouts',
  'dashboards',
  'user_dashboard_preferences',
  'mail_deliveries',
  'mail_delivery_events',
  'organization_mail_settings',
  'organization_mail_templates',
  'mail_provider_requests',
  // The organization's data keys, wrapped by the master key (migration 0084). Policed like the
  // rest; app_user holds SELECT and INSERT only, and the export leaves it out.
  'organization_keys',
  // Which organizations a person belongs to (migration 0086). Inside an organization its own
  // members are visible; a person's other memberships are a bootstrap read, like a session.
  'organization_memberships',
] as const;

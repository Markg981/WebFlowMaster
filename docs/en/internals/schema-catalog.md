# Complete table and column catalog

Generated from `shared/schema.ts` with `node scripts/generate-schema-catalog.mjs`. No database connection is made. SQL migrations remain authoritative for indexes, constraints, RLS policies and effective grants; this catalog describes Drizzle declarations, not an installed environment.

Read the [domain schema](./database-schema) for explanations and relationships, then find the table here. Each row lists the TypeScript property, SQL name and complete builder: type, nullability, default and references declared on the column. Table callback constraints are not expanded here.

**70 tables / 780 declared columns.**

## Index

| SQL                                                           | TypeScript                   | Columns |
| ------------------------------------------------------------- | ---------------------------- | ------- |
| [organizations](#organizations)                               | `organizations`              | 16      |
| [quota_execution_sessions](#quota-execution-sessions)         | `quotaExecutionSessions`     | 6       |
| [quota_artifacts](#quota-artifacts)                           | `quotaArtifacts`             | 6       |
| [quota_installation_defaults](#quota-installation-defaults)   | `quotaInstallationDefaults`  | 4       |
| [users](#users)                                               | `users`                      | 9       |
| [user_mfa](#user-mfa)                                         | `userMfa`                    | 11      |
| [user_settings](#user-settings)                               | `userSettings`               | 12      |
| [projects](#projects)                                         | `projects`                   | 6       |
| [project_members](#project-members)                           | `projectMembers`             | 5       |
| [tests](#tests)                                               | `tests`                      | 22      |
| [test_runs](#test-runs)                                       | `testRuns`                   | 7       |
| [detected_elements](#detected-elements)                       | `detectedElements`           | 11      |
| [api_test_history](#api-test-history)                         | `apiTestHistory`             | 13      |
| [api_tests](#api-tests)                                       | `apiTests`                   | 32      |
| [system_settings](#system-settings)                           | `systemSettings`             | 2       |
| [runners](#runners)                                           | `runners`                    | 12      |
| [test_plans](#test-plans)                                     | `testPlans`                  | 30      |
| [test_plan_schedules](#test-plan-schedules)                   | `testPlanSchedules`          | 16      |
| [test_plan_executions](#test-plan-executions)                 | `testPlanExecutions`         | 35      |
| [report_test_case_results](#report-test-case-results)         | `reportTestCaseResults`      | 30      |
| [execution_logs](#execution-logs)                             | `executionLogs`              | 10      |
| [environments](#environments)                                 | `environments`               | 10      |
| [secrets](#secrets)                                           | `secrets`                    | 10      |
| [test_plan_webhooks](#test-plan-webhooks)                     | `testPlanWebhooks`           | 8       |
| [test_plan_selected_tests](#test-plan-selected-tests)         | `testPlanSelectedTests`      | 7       |
| [excel_sequences_map](#excel-sequences-map)                   | `excelSequencesMap`          | 5       |
| [invitations](#invitations)                                   | `invitations`                | 9       |
| [password_resets](#password-resets)                           | `passwordResets`             | 8       |
| [organization_sso](#organization-sso)                         | `organizationSso`            | 27      |
| [scim_users](#scim-users)                                     | `scimUsers`                  | 6       |
| [scim_groups](#scim-groups)                                   | `scimGroups`                 | 6       |
| [scim_group_members](#scim-group-members)                     | `scimGroupMembers`           | 2       |
| [sso_saml_requests](#sso-saml-requests)                       | `ssoSamlRequests`            | 5       |
| [sso_saml_replay](#sso-saml-replay)                           | `ssoSamlReplay`              | 3       |
| [sso_saml_sessions](#sso-saml-sessions)                       | `ssoSamlSessions`            | 8       |
| [sso_domains](#sso-domains)                                   | `ssoDomains`                 | 4       |
| [sso_identities](#sso-identities)                             | `ssoIdentities`              | 5       |
| [audit_log](#audit-log)                                       | `auditLog`                   | 11      |
| [step_groups](#step-groups)                                   | `stepGroups`                 | 9       |
| [custom_actions](#custom-actions)                             | `customActions`              | 9       |
| [test_data_sets](#test-data-sets)                             | `testDataSets`               | 8       |
| [run_work_items](#run-work-items)                             | `runWorkItems`               | 11      |
| [impact_rules](#impact-rules)                                 | `impactRules`                | 5       |
| [sms_messages](#sms-messages)                                 | `smsMessages`                | 7       |
| [project_elements](#project-elements)                         | `projectElements`            | 14      |
| [tags](#tags)                                                 | `tags`                       | 4       |
| [test_tags](#test-tags)                                       | `testTags`                   | 8       |
| [test_versions](#test-versions)                               | `testVersions`               | 19      |
| [test_publications](#test-publications)                       | `testPublications`           | 10      |
| [test_reviews](#test-reviews)                                 | `testReviews`                | 13      |
| [test_suites](#test-suites)                                   | `testSuites`                 | 10      |
| [test_suite_items](#test-suite-items)                         | `testSuiteItems`             | 8       |
| [test_plan_suites](#test-plan-suites)                         | `testPlanSuites`             | 4       |
| [test_quarantines](#test-quarantines)                         | `testQuarantines`            | 12      |
| [agents](#agents)                                             | `agents`                     | 15      |
| [bdd_execution_profiles](#bdd-execution-profiles)             | `bddExecutionProfiles`       | 10      |
| [source_hosts](#source-hosts)                                 | `sourceHosts`                | 12      |
| [issue_trackers](#issue-trackers)                             | `issueTrackers`              | 14      |
| [browser_grids](#browser-grids)                               | `browserGrids`               | 13      |
| [requirements](#requirements)                                 | `requirements`               | 15      |
| [test_management_connections](#test-management-connections)   | `testManagementConnections`  | 15      |
| [test_case_links](#test-case-links)                           | `testCaseLinks`              | 10      |
| [test_management_publications](#test-management-publications) | `testManagementPublications` | 14      |
| [mobile_tests](#mobile-tests)                                 | `mobileTests`                | 15      |
| [mobile_step_groups](#mobile-step-groups)                     | `mobileStepGroups`           | 10      |
| [mobile_test_runs](#mobile-test-runs)                         | `mobileTestRuns`             | 18      |
| [requirement_tests](#requirement-tests)                       | `requirementTests`           | 9       |
| [issue_links](#issue-links)                                   | `issueLinks`                 | 16      |
| [api_keys](#api-keys)                                         | `apiKeys`                    | 11      |
| [sessions](#sessions)                                         | `sessions`                   | 3       |

## organizations {#organizations}

`organizations` — `shared/schema.ts:26`

| TS property                  | SQL column                      | Declaration                                                       |
| ---------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `id`                         | `id`                            | `serial("id").primaryKey()`                                       |
| `name`                       | `name`                          | `text("name").notNull()`                                          |
| `createdAt`                  | `created_at`                    | `timestamp("created_at").defaultNow().notNull()`                  |
| `maxConcurrentRuns`          | `max_concurrent_runs`           | `integer("max_concurrent_runs")`                                  |
| `maxQueuedRuns`              | `max_queued_runs`               | `integer("max_queued_runs")`                                      |
| `quotaMode`                  | `quota_mode`                    | `text('quota_mode').$type<import('./tenant-quotas').QuotaMode>()` |
| `maxTests`                   | `max_tests`                     | `bigint('max_tests', { mode: 'number' })`                         |
| `maxArtifactBytes`           | `max_artifact_bytes`            | `bigint('max_artifact_bytes', { mode: 'number' })`                |
| `maxMonthlyExecutionMinutes` | `max_monthly_execution_minutes` | `bigint('max_monthly_execution_minutes', { mode: 'number' })`     |
| `quotaRevision`              | `quota_revision`                | `integer('quota_revision').notNull().default(1)`                  |
| `artifactsReconciledAt`      | `artifacts_reconciled_at`       | `timestamp('artifacts_reconciled_at')`                            |
| `mfaRequired`                | `mfa_required`                  | `boolean("mfa_required").notNull().default(false)`                |
| `testReviewRequired`         | `test_review_required`          | `boolean("test_review_required").notNull().default(false)`        |
| `smsInboundTokenHash`        | `sms_inbound_token_hash`        | `text("sms_inbound_token_hash")`                                  |
| `smsInboundTokenPrefix`      | `sms_inbound_token_prefix`      | `text("sms_inbound_token_prefix")`                                |
| `smsInboundTokenCreatedAt`   | `sms_inbound_token_created_at`  | `timestamp("sms_inbound_token_created_at")`                       |

## quota_execution_sessions {#quota-execution-sessions}

`quotaExecutionSessions` — `shared/schema.ts:52`

| TS property      | SQL column        | Declaration                                                                                        |
| ---------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `organizationId` | `organization_id` | `integer('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' })` |
| `kind`           | `kind`            | `text('kind').notNull()`                                                                           |
| `executionId`    | `execution_id`    | `text('execution_id').notNull()`                                                                   |
| `startedAt`      | `started_at`      | `timestamp('started_at').notNull()`                                                                |
| `heartbeatAt`    | `heartbeat_at`    | `timestamp('heartbeat_at').notNull()`                                                              |
| `endedAt`        | `ended_at`        | `timestamp('ended_at')`                                                                            |

## quota_artifacts {#quota-artifacts}

`quotaArtifacts` — `shared/schema.ts:61`

| TS property      | SQL column        | Declaration                                                                                        |
| ---------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `organizationId` | `organization_id` | `integer('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' })` |
| `key`            | `key`             | `text('key').notNull()`                                                                            |
| `bytes`          | `bytes`           | `bigint('bytes', { mode: 'number' }).notNull().default(0)`                                         |
| `reservedBytes`  | `reserved_bytes`  | `bigint('reserved_bytes', { mode: 'number' }).notNull().default(0)`                                |
| `reservationId`  | `reservation_id`  | `text('reservation_id')`                                                                           |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').notNull().defaultNow()`                                                   |

## quota_installation_defaults {#quota-installation-defaults}

`quotaInstallationDefaults` — `shared/schema.ts:70`

| TS property        | SQL column           | Declaration                                                             |
| ------------------ | -------------------- | ----------------------------------------------------------------------- |
| `id`               | `id`                 | `integer('id').primaryKey()`                                            |
| `mode`             | `mode`               | `text('mode').notNull()`                                                |
| `maxTests`         | `max_tests`          | `bigint('max_tests', { mode: 'number' }).notNull()`                     |
| `maxArtifactBytes` | `max_artifact_bytes` | `bigint('max_artifact_bytes', { mode: 'number' }).notNull().default(0)` |

## users {#users}

`users` — `shared/schema.ts:77`

| TS property      | SQL column        | Declaration                                                               |
| ---------------- | ----------------- | ------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                               |
| `username`       | `username`        | `text("username").notNull().unique()`                                     |
| `password`       | `password`        | `text("password").notNull()`                                              |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)` |
| `role`           | `role`            | `text("role").notNull().default('editor')`                                |
| `kind`           | `kind`            | `text("kind").notNull().default('person')`                                |
| `displayName`    | `display_name`    | `text("display_name")`                                                    |
| `disabledAt`     | `disabled_at`     | `timestamp("disabled_at")`                                                |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                          |

## user_mfa {#user-mfa}

`userMfa` — `shared/schema.ts:103`

| TS property              | SQL column                 | Declaration                                                                           |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------- |
| `userId`                 | `user_id`                  | `integer("user_id").primaryKey().references(() => users.id, { onDelete: 'cascade' })` |
| `secretEncrypted`        | `secret_encrypted`         | `text("secret_encrypted")`                                                            |
| `secretIv`               | `secret_iv`                | `text("secret_iv")`                                                                   |
| `secretAuthTag`          | `secret_auth_tag`          | `text("secret_auth_tag")`                                                             |
| `pendingSecretEncrypted` | `pending_secret_encrypted` | `text("pending_secret_encrypted")`                                                    |
| `pendingSecretIv`        | `pending_secret_iv`        | `text("pending_secret_iv")`                                                           |
| `pendingSecretAuthTag`   | `pending_secret_auth_tag`  | `text("pending_secret_auth_tag")`                                                     |
| `enabledAt`              | `enabled_at`               | `timestamp("enabled_at")`                                                             |
| `lastUsedStep`           | `last_used_step`           | `bigint("last_used_step", { mode: 'number' })`                                        |
| `recoveryCodes`          | `recovery_codes`           | `jsonb("recovery_codes").$type<string[]>().notNull().default([])`                     |
| `updatedAt`              | `updated_at`               | `timestamp("updated_at").defaultNow().notNull()`                                      |

## user_settings {#user-settings}

`userSettings` — `shared/schema.ts:118`

| TS property                | SQL column                   | Declaration                                                                           |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| `userId`                   | `user_id`                    | `integer("user_id").primaryKey().references(() => users.id, { onDelete: 'cascade' })` |
| `theme`                    | `theme`                      | `text("theme").default('light').notNull()`                                            |
| `defaultTestUrl`           | `default_test_url`           | `text("default_test_url")`                                                            |
| `playwrightBrowser`        | `playwright_browser`         | `text("playwright_browser").default('chromium').notNull()`                            |
| `playwrightHeadless`       | `playwright_headless`        | `boolean("playwright_headless").default(true).notNull()`                              |
| `playwrightDefaultTimeout` | `playwright_default_timeout` | `integer("playwright_default_timeout").default(30000).notNull()`                      |
| `playwrightWaitTime`       | `playwright_wait_time`       | `integer("playwright_wait_time").default(1000).notNull()`                             |
| `language`                 | `language`                   | `text("language").default('en').notNull()`                                            |
| `notifyByEmail`            | `notify_by_email`            | `boolean("notify_by_email").default(false).notNull()`                                 |
| `notifyRunCompleted`       | `notify_run_completed`       | `boolean("notify_run_completed").default(true).notNull()`                             |
| `notifyRunFailed`          | `notify_run_failed`          | `boolean("notify_run_failed").default(true).notNull()`                                |
| `updatedAt`                | `updated_at`                 | `timestamp("updated_at").defaultNow().notNull()`                                      |

## projects {#projects}

`projects` — `shared/schema.ts:138`

| TS property      | SQL column        | Declaration                                                               |
| ---------------- | ----------------- | ------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                               |
| `name`           | `name`            | `text("name").notNull()`                                                  |
| `userId`         | `user_id`         | `integer("user_id").notNull().references(() => users.id)`                 |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)` |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                          |
| `restricted`     | `restricted`      | `boolean("restricted").notNull().default(false)`                          |

## project_members {#project-members}

`projectMembers` — `shared/schema.ts:158`

| TS property      | SQL column        | Declaration                                                                              |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `projectId`      | `project_id`      | `integer("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' })` |
| `userId`         | `user_id`         | `integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' })`       |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`                |
| `role`           | `role`            | `text("role").notNull()`                                                                 |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                         |

## tests {#tests}

`tests` — `shared/schema.ts:173`

| TS property        | SQL column          | Declaration                                                                     |
| ------------------ | ------------------- | ------------------------------------------------------------------------------- |
| `id`               | `id`                | `serial("id").primaryKey()`                                                     |
| `userId`           | `user_id`           | `integer("user_id").notNull().references(() => users.id)`                       |
| `organizationId`   | `organization_id`   | `integer("organization_id").notNull().references(() => organizations.id)`       |
| `projectId`        | `project_id`        | `integer("project_id").references(() => projects.id, { onDelete: 'set null' })` |
| `name`             | `name`              | `text("name").notNull()`                                                        |
| `url`              | `url`               | `text("url").notNull()`                                                         |
| `sequence`         | `sequence`          | `jsonb("sequence").notNull()`                                                   |
| `bdd`              | `bdd`               | `jsonb('bdd').$type<BddTest>()`                                                 |
| `elements`         | `elements`          | `jsonb("elements").notNull()`                                                   |
| `preconditions`    | `preconditions`     | `jsonb("preconditions")`                                                        |
| `cleanups`         | `cleanups`          | `jsonb("cleanups")`                                                             |
| `dataset`          | `dataset`           | `jsonb("dataset")`                                                              |
| `status`           | `status`            | `text("status").notNull().default("draft")`                                     |
| `publishedVersion` | `published_version` | `integer("published_version")`                                                  |
| `createdAt`        | `created_at`        | `timestamp("created_at").defaultNow().notNull()`                                |
| `updatedAt`        | `updated_at`        | `timestamp("updated_at").defaultNow().notNull()`                                |
| `module`           | `module`            | `text("module")`                                                                |
| `featureArea`      | `feature_area`      | `text("feature_area")`                                                          |
| `scenario`         | `scenario`          | `text("scenario")`                                                              |
| `component`        | `component`         | `text("component")`                                                             |
| `priority`         | `priority`          | `text("priority").default('Medium')`                                            |
| `severity`         | `severity`          | `text("severity").default('Major')`                                             |

## test_runs {#test-runs}

`testRuns` — `shared/schema.ts:220`

| TS property      | SQL column        | Declaration                                                               |
| ---------------- | ----------------- | ------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                               |
| `testId`         | `test_id`         | `integer("test_id").notNull().references(() => tests.id)`                 |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)` |
| `status`         | `status`          | `text("status").notNull()`                                                |
| `results`        | `results`         | `jsonb("results")`                                                        |
| `startedAt`      | `started_at`      | `timestamp("started_at").defaultNow().notNull()`                          |
| `completedAt`    | `completed_at`    | `timestamp("completed_at")`                                               |

## detected_elements {#detected-elements}

`detectedElements` — `shared/schema.ts:233`

| TS property        | SQL column          | Declaration                                                                        |
| ------------------ | ------------------- | ---------------------------------------------------------------------------------- |
| `id`               | `id`                | `serial("id").primaryKey()`                                                        |
| `testId`           | `test_id`           | `integer("test_id").notNull().references(() => tests.id, { onDelete: 'cascade' })` |
| `organizationId`   | `organization_id`   | `integer("organization_id").notNull().references(() => organizations.id)`          |
| `elementId`        | `element_id`        | `text("element_id").notNull()`                                                     |
| `selector`         | `selector`          | `text("selector").notNull()`                                                       |
| `originalSelector` | `original_selector` | `text("original_selector")`                                                        |
| `type`             | `type`              | `text("type")`                                                                     |
| `text`             | `text`              | `text("text")`                                                                     |
| `tag`              | `tag`               | `text("tag")`                                                                      |
| `attributes`       | `attributes`        | `jsonb("attributes")`                                                              |
| `createdAt`        | `created_at`        | `timestamp("created_at").defaultNow().notNull()`                                   |

## api_test_history {#api-test-history}

`apiTestHistory` — `shared/schema.ts:251`

| TS property       | SQL column         | Declaration                                                                        |
| ----------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `id`              | `id`               | `serial("id").primaryKey()`                                                        |
| `userId`          | `user_id`          | `integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' })` |
| `organizationId`  | `organization_id`  | `integer("organization_id").notNull().references(() => organizations.id)`          |
| `method`          | `method`           | `text("method").notNull()`                                                         |
| `url`             | `url`              | `text("url").notNull()`                                                            |
| `queryParams`     | `query_params`     | `jsonb("query_params")`                                                            |
| `requestHeaders`  | `request_headers`  | `jsonb("request_headers")`                                                         |
| `requestBody`     | `request_body`     | `text("request_body")`                                                             |
| `responseStatus`  | `response_status`  | `integer("response_status")`                                                       |
| `responseHeaders` | `response_headers` | `jsonb("response_headers")`                                                        |
| `responseBody`    | `response_body`    | `text("response_body")`                                                            |
| `durationMs`      | `duration_ms`      | `integer("duration_ms")`                                                           |
| `createdAt`       | `created_at`       | `timestamp("created_at").defaultNow().notNull()`                                   |

## api_tests {#api-tests}

`apiTests` — `shared/schema.ts:270`

| TS property            | SQL column               | Declaration                                                                     |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `id`                   | `id`                     | `serial("id").primaryKey()`                                                     |
| `userId`               | `user_id`                | `integer("user_id").notNull().references(() => users.id)`                       |
| `organizationId`       | `organization_id`        | `integer("organization_id").notNull().references(() => organizations.id)`       |
| `projectId`            | `project_id`             | `integer("project_id").references(() => projects.id, { onDelete: 'set null' })` |
| `publishedVersion`     | `published_version`      | `integer("published_version")`                                                  |
| `name`                 | `name`                   | `text("name").notNull()`                                                        |
| `method`               | `method`                 | `text("method").notNull()`                                                      |
| `url`                  | `url`                    | `text("url").notNull()`                                                         |
| `queryParams`          | `query_params`           | `jsonb("query_params")`                                                         |
| `requestHeaders`       | `request_headers`        | `jsonb("request_headers")`                                                      |
| `requestBody`          | `request_body`           | `text("request_body")`                                                          |
| `assertions`           | `assertions`             | `jsonb("assertions")`                                                           |
| `extractions`          | `extractions`            | `jsonb('extractions')`                                                          |
| `performance`          | `performance`            | `jsonb('performance').$type<ApiPerformance>()`                                  |
| `authType`             | `auth_type`              | `text("auth_type")`                                                             |
| `authParams`           | `auth_params`            | `jsonb("auth_params")`                                                          |
| `bodyType`             | `body_type`              | `text("body_type")`                                                             |
| `bodyRawContentType`   | `body_raw_content_type`  | `text("body_raw_content_type")`                                                 |
| `bodyFormData`         | `body_form_data`         | `jsonb("body_form_data")`                                                       |
| `bodyUrlEncoded`       | `body_url_encoded`       | `jsonb("body_url_encoded")`                                                     |
| `bodyGraphqlQuery`     | `body_graphql_query`     | `text("body_graphql_query")`                                                    |
| `bodyGraphqlVariables` | `body_graphql_variables` | `text("body_graphql_variables")`                                                |
| `protoDefinition`      | `proto_definition`       | `text("proto_definition")`                                                      |
| `protocolConfig`       | `protocol_config`        | `jsonb('protocol_config').$type<ProtocolConfig>()`                              |
| `createdAt`            | `created_at`             | `timestamp("created_at").defaultNow().notNull()`                                |
| `updatedAt`            | `updated_at`             | `timestamp("updated_at").defaultNow().notNull()`                                |
| `module`               | `module`                 | `text("module")`                                                                |
| `featureArea`          | `feature_area`           | `text("feature_area")`                                                          |
| `scenario`             | `scenario`               | `text("scenario")`                                                              |
| `component`            | `component`              | `text("component")`                                                             |
| `priority`             | `priority`               | `text("priority").default('Medium')`                                            |
| `severity`             | `severity`               | `text("severity").default('Major')`                                             |

## system_settings {#system-settings}

`systemSettings` — `shared/schema.ts:324`

| TS property | SQL column | Declaration                |
| ----------- | ---------- | -------------------------- |
| `key`       | `key`      | `text('key').primaryKey()` |
| `value`     | `value`    | `text('value')`            |

## runners {#runners}

`runners` — `shared/schema.ts:333`

| TS property              | SQL column                 | Declaration                                                                          |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------ |
| `id`                     | `id`                       | `text('id').primaryKey()`                                                            |
| `hostname`               | `hostname`                 | `text('hostname').notNull()`                                                         |
| `pid`                    | `pid`                      | `integer('pid').notNull()`                                                           |
| `version`                | `version`                  | `text('version')`                                                                    |
| `concurrency`            | `concurrency`              | `integer('concurrency').notNull()`                                                   |
| `browserTaskConcurrency` | `browser_task_concurrency` | `integer('browser_task_concurrency').notNull()`                                      |
| `browsers`               | `browsers`                 | `jsonb('browsers').$type<string[]>().notNull().default([])`                          |
| `activeJobs`             | `active_jobs`              | `integer('active_jobs').notNull().default(0)`                                        |
| `desiredState`           | `desired_state`            | `text('desired_state').$type<'active' &#124; 'drain'>().notNull().default('active')` |
| `startedAt`              | `started_at`               | `timestamp('started_at').defaultNow().notNull()`                                     |
| `lastSeenAt`             | `last_seen_at`             | `timestamp('last_seen_at').defaultNow().notNull()`                                   |
| `stoppedAt`              | `stopped_at`               | `timestamp('stopped_at')`                                                            |

## test_plans {#test-plans}

`testPlans` — `shared/schema.ts:355`

| TS property                      | SQL column                            | Declaration                                                                                                        |
| -------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`                             | `id`                                  | `text('id').primaryKey()`                                                                                          |
| `userId`                         | `user_id`                             | `integer("user_id").notNull().references(() => users.id)`                                                          |
| `organizationId`                 | `organization_id`                     | `integer('organization_id').notNull().references(() => organizations.id)`                                          |
| `name`                           | `name`                                | `text('name').notNull()`                                                                                           |
| `description`                    | `description`                         | `text('description')`                                                                                              |
| `testMachinesConfig`             | `test_machines_config`                | `jsonb('test_machines_config')`                                                                                    |
| `captureScreenshots`             | `capture_screenshots`                 | `text('capture_screenshots').default('on_failed_steps')`                                                           |
| `captureVideo`                   | `capture_video`                       | `text('capture_video').default('never').notNull()`                                                                 |
| `captureTrace`                   | `capture_trace`                       | `text('capture_trace').default('never').notNull()`                                                                 |
| `captureNetwork`                 | `capture_network`                     | `text('capture_network').default('never').notNull()`                                                               |
| `agentPool`                      | `agent_pool`                          | `text('agent_pool')`                                                                                               |
| `browserGridId`                  | `browser_grid_id`                     | `text('browser_grid_id').references(() => browserGrids.id, { onDelete: 'set null' })`                              |
| `visualTestingEnabled`           | `visual_testing_enabled`              | `boolean('visual_testing_enabled').default(false)`                                                                 |
| `pageLoadTimeout`                | `page_load_timeout`                   | `integer('page_load_timeout').default(30000)`                                                                      |
| `elementTimeout`                 | `element_timeout`                     | `integer('element_timeout').default(30000)`                                                                        |
| `onMajorStepFailure`             | `on_major_step_failure`               | `text('on_major_step_failure').default('abort_and_run_next_test_case')`                                            |
| `onAbortedTestCase`              | `on_aborted_test_case`                | `text('on_aborted_test_case').default('delete_cookies_and_reuse_session')`                                         |
| `onTestSuitePreRequisiteFailure` | `on_test_suite_pre_requisite_failure` | `text('on_test_suite_pre_requisite_failure').default('stop_execution')`                                            |
| `onTestCasePreRequisiteFailure`  | `on_test_case_pre_requisite_failure`  | `text('on_test_case_pre_requisite_failure').default('stop_execution')`                                             |
| `onTestStepPreRequisiteFailure`  | `on_test_step_pre_requisite_failure`  | `text('on_test_step_pre_requisite_failure').default('abort_and_run_next_test_case')`                               |
| `reRunOnFailure`                 | `re_run_on_failure`                   | `text('re_run_on_failure').default('none')`                                                                        |
| `maxParallelTests`               | `max_parallel_tests`                  | `integer('max_parallel_tests').default(1).notNull()`                                                               |
| `shards`                         | `shards`                              | `integer('shards').default(1).notNull()`                                                                           |
| `locales`                        | `locales`                             | `jsonb('locales').$type<string[]>().notNull().default([])`                                                         |
| `issueTrackerId`                 | `issue_tracker_id`                    | `text('issue_tracker_id').references(() => issueTrackers.id, { onDelete: 'set null' })`                            |
| `testManagementId`               | `test_management_id`                  | `text('test_management_id').references((): AnyPgColumn => testManagementConnections.id, { onDelete: 'set null' })` |
| `createIssuesOnFailure`          | `create_issues_on_failure`            | `boolean('create_issues_on_failure').default(false).notNull()`                                                     |
| `notificationSettings`           | `notification_settings`               | `jsonb('notification_settings')`                                                                                   |
| `createdAt`                      | `created_at`                          | `timestamp('created_at').defaultNow().notNull()`                                                                   |
| `updatedAt`                      | `updated_at`                          | `timestamp('updated_at').defaultNow().notNull()`                                                                   |

## test_plan_schedules {#test-plan-schedules}

`testPlanSchedules` — `shared/schema.ts:424`

| TS property                  | SQL column                     | Declaration                                                                              |
| ---------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `id`                         | `id`                           | `text('id').primaryKey()`                                                                |
| `testPlanId`                 | `test_plan_id`                 | `text('test_plan_id').notNull().references(() => testPlans.id, { onDelete: 'cascade' })` |
| `organizationId`             | `organization_id`              | `integer('organization_id').notNull().references(() => organizations.id)`                |
| `userId`                     | `user_id`                      | `integer('user_id').references(() => users.id)`                                          |
| `scheduleName`               | `schedule_name`                | `text('schedule_name').notNull()`                                                        |
| `frequency`                  | `frequency`                    | `text('frequency').notNull()`                                                            |
| `nextRunAt`                  | `next_run_at`                  | `timestamp('next_run_at').notNull()`                                                     |
| `timezone`                   | `timezone`                     | `text('timezone').notNull().default('UTC')`                                              |
| `environment`                | `environment`                  | `text('environment')`                                                                    |
| `browsers`                   | `browsers`                     | `jsonb('browsers')`                                                                      |
| `notificationConfigOverride` | `notification_config_override` | `jsonb('notification_config_override')`                                                  |
| `executionParameters`        | `execution_parameters`         | `jsonb('execution_parameters')`                                                          |
| `isActive`                   | `is_active`                    | `boolean('is_active').default(true).notNull()`                                           |
| `retryOnFailure`             | `retry_on_failure`             | `text('retry_on_failure').default('none').notNull()`                                     |
| `createdAt`                  | `created_at`                   | `timestamp('created_at').defaultNow().notNull()`                                         |
| `updatedAt`                  | `updated_at`                   | `timestamp('updated_at')`                                                                |

## test_plan_executions {#test-plan-executions}

`testPlanExecutions` — `shared/schema.ts:470`

| TS property             | SQL column                | Declaration                                                                                    |
| ----------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `id`                    | `id`                      | `text('id').primaryKey()`                                                                      |
| `scheduleId`            | `schedule_id`             | `text('schedule_id').references(() => testPlanSchedules.id, { onDelete: 'set null' })`         |
| `testPlanId`            | `test_plan_id`            | `text('test_plan_id').notNull().references(() => testPlans.id, { onDelete: 'cascade' })`       |
| `organizationId`        | `organization_id`         | `integer('organization_id').notNull().references(() => organizations.id)`                      |
| `requestedByUserId`     | `requested_by_user_id`    | `integer('requested_by_user_id').references(() => users.id, { onDelete: 'set null' })`         |
| `status`                | `status`                  | `text('status').notNull().default('queued')`                                                   |
| `results`               | `results`                 | `jsonb("results")`                                                                             |
| `queuedAt`              | `queued_at`               | `timestamp('queued_at').notNull().defaultNow()`                                                |
| `startedAt`             | `started_at`              | `timestamp('started_at')`                                                                      |
| `completedAt`           | `completed_at`            | `timestamp('completed_at')`                                                                    |
| `cancelRequestedAt`     | `cancel_requested_at`     | `timestamp('cancel_requested_at')`                                                             |
| `stopReason`            | `stop_reason`             | `text('stop_reason')`                                                                          |
| `heartbeatAt`           | `heartbeat_at`            | `timestamp('heartbeat_at')`                                                                    |
| `failureCode`           | `failure_code`            | `text('failure_code')`                                                                         |
| `failureMessage`        | `failure_message`         | `text('failure_message')`                                                                      |
| `configurationSnapshot` | `configuration_snapshot`  | `jsonb('configuration_snapshot').notNull().default({})`                                        |
| `idempotencyKey`        | `idempotency_key`         | `text('idempotency_key')`                                                                      |
| `attempt`               | `attempt`                 | `integer('attempt').notNull().default(1)`                                                      |
| `maxAttempts`           | `max_attempts`            | `integer('max_attempts').notNull().default(1)`                                                 |
| `retryOfExecutionId`    | `retry_of_execution_id`   | `text('retry_of_execution_id')`                                                                |
| `artifactsPurgedAt`     | `artifacts_purged_at`     | `timestamp('artifacts_purged_at')`                                                             |
| `artifactStorageStatus` | `artifact_storage_status` | `text('artifact_storage_status').$type<'quota_exceeded' &#124; 'error'>()`                     |
| `quotaDeferReason`      | `quota_defer_reason`      | `text('quota_defer_reason').$type<'execution_quota_exceeded' &#124; 'concurrent_run_quota'>()` |
| `quotaDeferUntil`       | `quota_defer_until`       | `timestamp('quota_defer_until')`                                                               |
| `runnerId`              | `runner_id`               | `text('runner_id')`                                                                            |
| `ciContext`             | `ci_context`              | `jsonb('ci_context').$type<CiContext>()`                                                       |
| `environment`           | `environment`             | `text('environment')`                                                                          |
| `browsers`              | `browsers`                | `jsonb('browsers')`                                                                            |
| `triggeredBy`           | `triggered_by`            | `text('triggered_by').notNull().default('manual')`                                             |
| `totalTests`            | `total_tests`             | `integer("total_tests")`                                                                       |
| `passedTests`           | `passed_tests`            | `integer("passed_tests")`                                                                      |
| `failedTests`           | `failed_tests`            | `integer("failed_tests")`                                                                      |
| `skippedTests`          | `skipped_tests`           | `integer("skipped_tests")`                                                                     |
| `quarantinedFailures`   | `quarantined_failures`    | `integer("quarantined_failures").notNull().default(0)`                                         |
| `executionDurationMs`   | `execution_duration_ms`   | `integer("execution_duration_ms")`                                                             |

## report_test_case_results {#report-test-case-results}

`reportTestCaseResults` — `shared/schema.ts:534`

| TS property           | SQL column               | Declaration                                                                                                 |
| --------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `id`                  | `id`                     | `text("id").primaryKey()`                                                                                   |
| `testPlanExecutionId` | `test_plan_execution_id` | `text("test_plan_execution_id").notNull().references(() => testPlanExecutions.id, { onDelete: 'cascade' })` |
| `organizationId`      | `organization_id`        | `integer("organization_id").notNull().references(() => organizations.id)`                                   |
| `uiTestId`            | `ui_test_id`             | `integer("ui_test_id").references(() => tests.id, { onDelete: 'set null' })`                                |
| `apiTestId`           | `api_test_id`            | `integer("api_test_id").references(() => apiTests.id, { onDelete: 'set null' })`                            |
| `mobileTestId`        | `mobile_test_id`         | `integer("mobile_test_id")`                                                                                 |
| `testType`            | `test_type`              | `text("test_type").notNull()`                                                                               |
| `testName`            | `test_name`              | `text("test_name").notNull()`                                                                               |
| `browser`             | `browser`                | `text("browser")`                                                                                           |
| `testVersion`         | `test_version`           | `integer("test_version")`                                                                                   |
| `status`              | `status`                 | `text("status").notNull()`                                                                                  |
| `attempts`            | `attempts`               | `integer("attempts").notNull().default(1)`                                                                  |
| `quarantined`         | `quarantined`            | `boolean("quarantined").notNull().default(false)`                                                           |
| `reasonForFailure`    | `reason_for_failure`     | `text("reason_for_failure")`                                                                                |
| `screenshotUrl`       | `screenshot_url`         | `text("screenshot_url")`                                                                                    |
| `videoUrl`            | `video_url`              | `text("video_url")`                                                                                         |
| `traceUrl`            | `trace_url`              | `text("trace_url")`                                                                                         |
| `harUrl`              | `har_url`                | `text("har_url")`                                                                                           |
| `networkSummary`      | `network_summary`        | `jsonb("network_summary").$type<NetworkSummary>()`                                                          |
| `aiAnalysis`          | `ai_analysis`            | `jsonb("ai_analysis").$type<FailureAnalysis>()`                                                             |
| `detailedLog`         | `detailed_log`           | `text("detailed_log")`                                                                                      |
| `startedAt`           | `started_at`             | `timestamp("started_at").notNull()`                                                                         |
| `completedAt`         | `completed_at`           | `timestamp("completed_at")`                                                                                 |
| `durationMs`          | `duration_ms`            | `integer("duration_ms")`                                                                                    |
| `module`              | `module`                 | `text("module")`                                                                                            |
| `featureArea`         | `feature_area`           | `text("feature_area")`                                                                                      |
| `scenario`            | `scenario`               | `text("scenario")`                                                                                          |
| `component`           | `component`              | `text("component")`                                                                                         |
| `priority`            | `priority`               | `text("priority")`                                                                                          |
| `severity`            | `severity`               | `text("severity")`                                                                                          |

## execution_logs {#execution-logs}

`executionLogs` — `shared/schema.ts:609`

| TS property           | SQL column               | Declaration                                                                                                  |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `id`                  | `id`                     | `serial('id').primaryKey()`                                                                                  |
| `testPlanExecutionId` | `test_plan_execution_id` | `text('test_plan_execution_id').notNull() .references(() => testPlanExecutions.id, { onDelete: 'cascade' })` |
| `organizationId`      | `organization_id`        | `integer('organization_id').notNull().references(() => organizations.id)`                                    |
| `timestamp`           | `timestamp`              | `timestamp('timestamp').defaultNow().notNull()`                                                              |
| `level`               | `level`                  | `text('level').notNull()`                                                                                    |
| `source`              | `source`                 | `text('source').notNull()`                                                                                   |
| `message`             | `message`                | `text('message').notNull()`                                                                                  |
| `metadata`            | `metadata`               | `jsonb('metadata')`                                                                                          |
| `testCaseResultId`    | `test_case_result_id`    | `text('test_case_result_id')`                                                                                |
| `correlationId`       | `correlation_id`         | `text('correlation_id')`                                                                                     |

## environments {#environments}

`environments` — `shared/schema.ts:627`

| TS property            | SQL column                | Declaration                                                               |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------- |
| `id`                   | `id`                      | `serial('id').primaryKey()`                                               |
| `name`                 | `name`                    | `text('name').notNull()`                                                  |
| `description`          | `description`             | `text('description')`                                                     |
| `userId`               | `user_id`                 | `integer('user_id').notNull().references(() => users.id)`                 |
| `organizationId`       | `organization_id`         | `integer('organization_id').notNull().references(() => organizations.id)` |
| `createdAt`            | `created_at`              | `timestamp('created_at').notNull().defaultNow()`                          |
| `loginState`           | `login_state`             | `text('login_state')`                                                     |
| `loginStateIv`         | `login_state_iv`          | `text('login_state_iv')`                                                  |
| `loginStateAuthTag`    | `login_state_auth_tag`    | `text('login_state_auth_tag')`                                            |
| `loginStateCapturedAt` | `login_state_captured_at` | `timestamp('login_state_captured_at')`                                    |

## secrets {#secrets}

`secrets` — `shared/schema.ts:655`

| TS property      | SQL column        | Declaration                                                                                      |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `id`             | `id`              | `serial('id').primaryKey()`                                                                      |
| `environmentId`  | `environment_id`  | `integer('environment_id').notNull().references(() => environments.id, { onDelete: 'cascade' })` |
| `keyName`        | `key_name`        | `text('key_name').notNull()`                                                                     |
| `encryptedValue` | `encrypted_value` | `text('encrypted_value').notNull()`                                                              |
| `iv`             | `iv`              | `text('iv').notNull()`                                                                           |
| `authTag`        | `auth_tag`        | `text('auth_tag').notNull()`                                                                     |
| `userId`         | `user_id`         | `integer('user_id').notNull().references(() => users.id)`                                        |
| `organizationId` | `organization_id` | `integer('organization_id').notNull().references(() => organizations.id)`                        |
| `createdAt`      | `created_at`      | `timestamp('created_at').notNull().defaultNow()`                                                 |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').notNull().defaultNow()`                                                 |

## test_plan_webhooks {#test-plan-webhooks}

`testPlanWebhooks` — `shared/schema.ts:672`

| TS property      | SQL column        | Declaration                                                                              |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                              |
| `testPlanId`     | `test_plan_id`    | `text('test_plan_id').notNull().references(() => testPlans.id, { onDelete: 'cascade' })` |
| `organizationId` | `organization_id` | `integer('organization_id').notNull().references(() => organizations.id)`                |
| `tokenHash`      | `token_hash`      | `text('token_hash').notNull().unique()`                                                  |
| `tokenPrefix`    | `token_prefix`    | `text('token_prefix').notNull()`                                                         |
| `name`           | `name`            | `text('name').notNull()`                                                                 |
| `createdAt`      | `created_at`      | `timestamp('created_at').notNull().defaultNow()`                                         |
| `lastUsedAt`     | `last_used_at`    | `timestamp('last_used_at')`                                                              |

## test_plan_selected_tests {#test-plan-selected-tests}

`testPlanSelectedTests` — `shared/schema.ts:691`

| TS property      | SQL column        | Declaration                                                                              |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                              |
| `testPlanId`     | `test_plan_id`    | `text('test_plan_id').notNull().references(() => testPlans.id, { onDelete: 'cascade' })` |
| `organizationId` | `organization_id` | `integer('organization_id').notNull().references(() => organizations.id)`                |
| `testId`         | `test_id`         | `integer('test_id').references(() => tests.id, { onDelete: 'cascade' })`                 |
| `apiTestId`      | `api_test_id`     | `integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' })`          |
| `mobileTestId`   | `mobile_test_id`  | `integer('mobile_test_id')`                                                              |
| `testType`       | `test_type`       | `text('test_type').notNull()`                                                            |

## excel_sequences_map {#excel-sequences-map}

`excelSequencesMap` — `shared/schema.ts:708`

| TS property       | SQL column           | Declaration                                                                          |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `id`              | `id`                 | `serial("id").primaryKey()`                                                          |
| `testId`          | `test_id`            | `integer("test_id") .notNull() .references(() => tests.id, { onDelete: "cascade" })` |
| `organizationId`  | `organization_id`    | `integer("organization_id").notNull().references(() => organizations.id)`            |
| `excelTestCaseId` | `excel_test_case_id` | `text("excel_test_case_id").notNull()`                                               |
| `createdAt`       | `created_at`         | `timestamp("created_at").defaultNow().notNull()`                                     |

## invitations {#invitations}

`invitations` — `shared/schema.ts:738`

| TS property       | SQL column           | Declaration                                                                          |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `id`              | `id`                 | `serial("id").primaryKey()`                                                          |
| `organizationId`  | `organization_id`    | `integer("organization_id").notNull().references(() => organizations.id)`            |
| `username`        | `username`           | `text("username").notNull()`                                                         |
| `role`            | `role`               | `text("role").notNull().default('editor')`                                           |
| `token`           | `token`              | `text("token").notNull().unique()`                                                   |
| `invitedByUserId` | `invited_by_user_id` | `integer("invited_by_user_id").references(() => users.id, { onDelete: 'set null' })` |
| `expiresAt`       | `expires_at`         | `timestamp("expires_at").notNull()`                                                  |
| `acceptedAt`      | `accepted_at`        | `timestamp("accepted_at")`                                                           |
| `createdAt`       | `created_at`         | `timestamp("created_at").defaultNow().notNull()`                                     |

## password_resets {#password-resets}

`passwordResets` — `shared/schema.ts:774`

| TS property      | SQL column        | Declaration                                                                        |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `id`             | `id`              | `text("id").primaryKey()`                                                          |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`          |
| `userId`         | `user_id`         | `integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' })` |
| `tokenHash`      | `token_hash`      | `text("token_hash").notNull().unique()`                                            |
| `createdBy`      | `created_by`      | `integer("created_by").references(() => users.id, { onDelete: 'set null' })`       |
| `expiresAt`      | `expires_at`      | `timestamp("expires_at").notNull()`                                                |
| `usedAt`         | `used_at`         | `timestamp("used_at")`                                                             |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                   |

## organization_sso {#organization-sso}

`organizationSso` — `shared/schema.ts:798`

| TS property                      | SQL column                          | Declaration                                                                                                                     |
| -------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `organizationId`                 | `organization_id`                   | `integer("organization_id").primaryKey().references(() => organizations.id, { onDelete: 'cascade' })`                           |
| `protocol`                       | `protocol`                          | `text("protocol").notNull().default('oidc')`                                                                                    |
| `issuer`                         | `issuer`                            | `text("issuer").notNull()`                                                                                                      |
| `clientId`                       | `client_id`                         | `text("client_id")`                                                                                                             |
| `clientSecretEncrypted`          | `client_secret_encrypted`           | `text("client_secret_encrypted")`                                                                                               |
| `clientSecretIv`                 | `client_secret_iv`                  | `text("client_secret_iv")`                                                                                                      |
| `clientSecretAuthTag`            | `client_secret_auth_tag`            | `text("client_secret_auth_tag")`                                                                                                |
| `samlSsoUrl`                     | `saml_sso_url`                      | `text("saml_sso_url")`                                                                                                          |
| `samlCertificate`                | `saml_certificate`                  | `text("saml_certificate")`                                                                                                      |
| `samlAllowIdpInitiated`          | `saml_allow_idp_initiated`          | `boolean("saml_allow_idp_initiated").notNull().default(false)`                                                                  |
| `samlRequireEncryptedAssertions` | `saml_require_encrypted_assertions` | `boolean("saml_require_encrypted_assertions").notNull().default(false)`                                                         |
| `samlSloUrl`                     | `saml_slo_url`                      | `text("saml_slo_url")`                                                                                                          |
| `samlSpCertificate`              | `saml_sp_certificate`               | `text("saml_sp_certificate")`                                                                                                   |
| `samlSpPrivateKeyEncrypted`      | `saml_sp_private_key_encrypted`     | `text("saml_sp_private_key_encrypted")`                                                                                         |
| `samlSpPrivateKeyIv`             | `saml_sp_private_key_iv`            | `text("saml_sp_private_key_iv")`                                                                                                |
| `samlSpPrivateKeyAuthTag`        | `saml_sp_private_key_auth_tag`      | `text("saml_sp_private_key_auth_tag")`                                                                                          |
| `defaultRole`                    | `default_role`                      | `text("default_role").notNull().default('viewer')`                                                                              |
| `enabled`                        | `enabled`                           | `boolean("enabled").notNull().default(true)`                                                                                    |
| `required`                       | `required`                          | `boolean("required").notNull().default(false)`                                                                                  |
| `groupAttribute`                 | `group_attribute`                   | `text("group_attribute")`                                                                                                       |
| `roleMappings`                   | `role_mappings`                     | `jsonb("role_mappings").$type<Array<{ group: string; role: "viewer" &#124; "editor" &#124; "owner" }>>().notNull().default([])` |
| `requireGroup`                   | `require_group`                     | `boolean("require_group").notNull().default(false)`                                                                             |
| `scimTokenHash`                  | `scim_token_hash`                   | `text("scim_token_hash")`                                                                                                       |
| `scimTokenPrefix`                | `scim_token_prefix`                 | `text("scim_token_prefix")`                                                                                                     |
| `scimTokenCreatedAt`             | `scim_token_created_at`             | `timestamp("scim_token_created_at")`                                                                                            |
| `scimTokenLastUsedAt`            | `scim_token_last_used_at`           | `timestamp("scim_token_last_used_at")`                                                                                          |
| `updatedAt`                      | `updated_at`                        | `timestamp("updated_at").defaultNow().notNull()`                                                                                |

## scim_users {#scim-users}

`scimUsers` — `shared/schema.ts:852`

| TS property        | SQL column           | Declaration                                                                                        |
| ------------------ | -------------------- | -------------------------------------------------------------------------------------------------- |
| `userId`           | `user_id`            | `integer("user_id").primaryKey().references(() => users.id, { onDelete: 'cascade' })`              |
| `organizationId`   | `organization_id`    | `integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' })` |
| `externalId`       | `external_id`        | `text("external_id")`                                                                              |
| `disabledByGroups` | `disabled_by_groups` | `boolean("disabled_by_groups").notNull().default(false)`                                           |
| `createdAt`        | `created_at`         | `timestamp("created_at").defaultNow().notNull()`                                                   |
| `updatedAt`        | `updated_at`         | `timestamp("updated_at").defaultNow().notNull()`                                                   |

## scim_groups {#scim-groups}

`scimGroups` — `shared/schema.ts:865`

| TS property      | SQL column        | Declaration                                                                                        |
| ---------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `text("id").primaryKey()`                                                                          |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' })` |
| `displayName`    | `display_name`    | `text("display_name").notNull()`                                                                   |
| `externalId`     | `external_id`     | `text("external_id")`                                                                              |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                                   |
| `updatedAt`      | `updated_at`      | `timestamp("updated_at").defaultNow().notNull()`                                                   |

## scim_group_members {#scim-group-members}

`scimGroupMembers` — `shared/schema.ts:876`

| TS property | SQL column | Declaration                                                                           |
| ----------- | ---------- | ------------------------------------------------------------------------------------- |
| `groupId`   | `group_id` | `text("group_id").notNull().references(() => scimGroups.id, { onDelete: 'cascade' })` |
| `userId`    | `user_id`  | `integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' })`    |

## sso_saml_requests {#sso-saml-requests}

`ssoSamlRequests` — `shared/schema.ts:889`

| TS property      | SQL column        | Declaration                                                                                        |
| ---------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `text("id").primaryKey()`                                                                          |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' })` |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                                   |
| `purpose`        | `purpose`         | `text("purpose").notNull().default('authn')`                                                       |
| `sessionId`      | `session_id`      | `text("session_id")`                                                                               |

## sso_saml_replay {#sso-saml-replay}

`ssoSamlReplay` — `shared/schema.ts:900`

| TS property      | SQL column        | Declaration                                                                                        |
| ---------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `text("id").primaryKey()`                                                                          |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' })` |
| `expiresAt`      | `expires_at`      | `timestamp("expires_at").notNull()`                                                                |

## sso_saml_sessions {#sso-saml-sessions}

`ssoSamlSessions` — `shared/schema.ts:907`

| TS property      | SQL column        | Declaration                                                                                        |
| ---------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `sessionId`      | `session_id`      | `text("session_id").primaryKey()`                                                                  |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' })` |
| `userId`         | `user_id`         | `integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' })`                 |
| `issuer`         | `issuer`          | `text("issuer").notNull()`                                                                         |
| `nameId`         | `name_id`         | `text("name_id").notNull()`                                                                        |
| `nameIdFormat`   | `name_id_format`  | `text("name_id_format")`                                                                           |
| `sessionIndex`   | `session_index`   | `text("session_index")`                                                                            |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                                   |

## sso_domains {#sso-domains}

`ssoDomains` — `shared/schema.ts:918`

| TS property         | SQL column           | Declaration                                                                                        |
| ------------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `domain`            | `domain`             | `text("domain").primaryKey()`                                                                      |
| `organizationId`    | `organization_id`    | `integer("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' })` |
| `verificationToken` | `verification_token` | `text("verification_token")`                                                                       |
| `verifiedAt`        | `verified_at`        | `timestamp("verified_at")`                                                                         |

## sso_identities {#sso-identities}

`ssoIdentities` — `shared/schema.ts:930`

| TS property    | SQL column        | Declaration                                                                                 |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `issuer`       | `issuer`          | `text("issuer").notNull()`                                                                  |
| `subject`      | `subject`         | `text("subject").notNull()`                                                                 |
| `userId`       | `user_id`         | `integer("user_id").notNull().unique().references(() => users.id, { onDelete: 'cascade' })` |
| `createdAt`    | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                            |
| `lastSignInAt` | `last_sign_in_at` | `timestamp("last_sign_in_at").defaultNow().notNull()`                                       |

## audit_log {#audit-log}

`auditLog` — `shared/schema.ts:957`

| TS property      | SQL column        | Declaration                                                                     |
| ---------------- | ----------------- | ------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                                     |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`       |
| `actorUserId`    | `actor_user_id`   | `integer("actor_user_id").references(() => users.id, { onDelete: 'set null' })` |
| `actorUsername`  | `actor_username`  | `text("actor_username")`                                                        |
| `action`         | `action`          | `text("action").notNull()`                                                      |
| `targetType`     | `target_type`     | `text("target_type")`                                                           |
| `targetId`       | `target_id`       | `text("target_id")`                                                             |
| `metadata`       | `metadata`        | `jsonb("metadata")`                                                             |
| `apiKeyId`       | `api_key_id`      | `text("api_key_id")`                                                            |
| `ipAddress`      | `ip_address`      | `text("ip_address")`                                                            |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                |

## step_groups {#step-groups}

`stepGroups` — `shared/schema.ts:996`

| TS property      | SQL column        | Declaration                                                                     |
| ---------------- | ----------------- | ------------------------------------------------------------------------------- |
| `id`             | `id`              | `text("id").primaryKey()`                                                       |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`       |
| `userId`         | `user_id`         | `integer("user_id").notNull().references(() => users.id)`                       |
| `projectId`      | `project_id`      | `integer("project_id").references(() => projects.id, { onDelete: 'set null' })` |
| `name`           | `name`            | `text("name").notNull()`                                                        |
| `description`    | `description`     | `text("description")`                                                           |
| `sequence`       | `sequence`        | `jsonb("sequence").notNull()`                                                   |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                |
| `updatedAt`      | `updated_at`      | `timestamp("updated_at").defaultNow().notNull()`                                |

## custom_actions {#custom-actions}

`customActions` — `shared/schema.ts:1021`

| TS property      | SQL column        | Declaration                                                                  |
| ---------------- | ----------------- | ---------------------------------------------------------------------------- |
| `id`             | `id`              | `text("id").primaryKey()`                                                    |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`    |
| `userId`         | `user_id`         | `integer("user_id").notNull().references(() => users.id)`                    |
| `name`           | `name`            | `text("name").notNull()`                                                     |
| `description`    | `description`     | `text("description")`                                                        |
| `parameters`     | `parameters`      | `jsonb("parameters").$type<CustomActionParameter[]>().notNull().default([])` |
| `script`         | `script`          | `text("script").notNull()`                                                   |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                             |
| `updatedAt`      | `updated_at`      | `timestamp("updated_at").defaultNow().notNull()`                             |

## test_data_sets {#test-data-sets}

`testDataSets` — `shared/schema.ts:1043`

| TS property      | SQL column        | Declaration                                                               |
| ---------------- | ----------------- | ------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                               |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)` |
| `name`           | `name`            | `text("name").notNull()`                                                  |
| `description`    | `description`     | `text("description")`                                                     |
| `columns`        | `columns`         | `jsonb("columns").$type<string[]>().notNull()`                            |
| `rows`           | `rows`            | `jsonb("rows").$type<Array<Record<string, string>>>().notNull()`          |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                          |
| `updatedAt`      | `updated_at`      | `timestamp("updated_at").defaultNow().notNull()`                          |

## run_work_items {#run-work-items}

`runWorkItems` — `shared/schema.ts:1065`

| TS property      | SQL column        | Declaration                                                                                       |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `executionId`    | `execution_id`    | `text("execution_id").notNull().references(() => testPlanExecutions.id, { onDelete: 'cascade' })` |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`                         |
| `key`            | `key`             | `text("key").notNull()`                                                                           |
| `position`       | `position`        | `integer("position").notNull()`                                                                   |
| `unit`           | `unit`            | `jsonb("unit").notNull()`                                                                         |
| `state`          | `state`           | `text("state").$type<'pending' &#124; 'claimed' &#124; 'done'>().notNull().default('pending')`    |
| `claimedBy`      | `claimed_by`      | `text("claimed_by")`                                                                              |
| `heartbeatAt`    | `heartbeat_at`    | `timestamp("heartbeat_at")`                                                                       |
| `finishedAt`     | `finished_at`     | `timestamp("finished_at")`                                                                        |
| `error`          | `error`           | `text("error")`                                                                                   |
| `results`        | `results`         | `jsonb("results")`                                                                                |

## impact_rules {#impact-rules}

`impactRules` — `shared/schema.ts:1088`

| TS property      | SQL column        | Declaration                                                               |
| ---------------- | ----------------- | ------------------------------------------------------------------------- |
| `id`             | `id`              | `text("id").primaryKey()`                                                 |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)` |
| `pattern`        | `pattern`         | `text("pattern").notNull()`                                               |
| `tagId`          | `tag_id`          | `text("tag_id").references(() => tags.id, { onDelete: 'cascade' })`       |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                          |

## sms_messages {#sms-messages}

`smsMessages` — `shared/schema.ts:1101`

| TS property      | SQL column        | Declaration                                                               |
| ---------------- | ----------------- | ------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                               |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)` |
| `toNumber`       | `to_number`       | `text("to_number").notNull()`                                             |
| `fromNumber`     | `from_number`     | `text("from_number")`                                                     |
| `body`           | `body`            | `text("body").notNull()`                                                  |
| `provider`       | `provider`        | `text("provider")`                                                        |
| `receivedAt`     | `received_at`     | `timestamp("received_at").defaultNow().notNull()`                         |

## project_elements {#project-elements}

`projectElements` — `shared/schema.ts:1125`

| TS property        | SQL column          | Declaration                                                                              |
| ------------------ | ------------------- | ---------------------------------------------------------------------------------------- |
| `id`               | `id`                | `text("id").primaryKey()`                                                                |
| `organizationId`   | `organization_id`   | `integer("organization_id").notNull().references(() => organizations.id)`                |
| `projectId`        | `project_id`        | `integer("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' })` |
| `name`             | `name`              | `text("name").notNull()`                                                                 |
| `selector`         | `selector`          | `text("selector").notNull()`                                                             |
| `originalSelector` | `original_selector` | `text("original_selector")`                                                              |
| `frameSelector`    | `frame_selector`    | `text("frame_selector")`                                                                 |
| `tag`              | `tag`               | `text("tag")`                                                                            |
| `elementType`      | `element_type`      | `text("element_type")`                                                                   |
| `text`             | `text`              | `text("text")`                                                                           |
| `attributes`       | `attributes`        | `jsonb("attributes")`                                                                    |
| `healedAt`         | `healed_at`         | `timestamp("healed_at")`                                                                 |
| `createdAt`        | `created_at`        | `timestamp("created_at").defaultNow().notNull()`                                         |
| `updatedAt`        | `updated_at`        | `timestamp("updated_at").defaultNow().notNull()`                                         |

## tags {#tags}

`tags` — `shared/schema.ts:1165`

| TS property      | SQL column        | Declaration                                                               |
| ---------------- | ----------------- | ------------------------------------------------------------------------- |
| `id`             | `id`              | `text("id").primaryKey()`                                                 |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)` |
| `name`           | `name`            | `text("name").notNull()`                                                  |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                          |

## test_tags {#test-tags}

`testTags` — `shared/schema.ts:1185`

| TS property      | SQL column        | Declaration                                                                     |
| ---------------- | ----------------- | ------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                                     |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`       |
| `tagId`          | `tag_id`          | `text("tag_id").notNull().references(() => tags.id, { onDelete: 'cascade' })`   |
| `testId`         | `test_id`         | `integer("test_id").references(() => tests.id, { onDelete: 'cascade' })`        |
| `apiTestId`      | `api_test_id`     | `integer("api_test_id").references(() => apiTests.id, { onDelete: 'cascade' })` |
| `mobileTestId`   | `mobile_test_id`  | `integer("mobile_test_id")`                                                     |
| `testType`       | `test_type`       | `text("test_type").notNull()`                                                   |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                |

## test_versions {#test-versions}

`testVersions` — `shared/schema.ts:1222`

| TS property           | SQL column              | Declaration                                                                                        |
| --------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `bdd`                 | `bdd`                   | `jsonb('bdd').$type<BddTest>()`                                                                    |
| `id`                  | `id`                    | `serial("id").primaryKey()`                                                                        |
| `organizationId`      | `organization_id`       | `integer("organization_id").notNull().references(() => organizations.id)`                          |
| `testId`              | `test_id`               | `integer("test_id").references(() => tests.id, { onDelete: 'cascade' })`                           |
| `apiTestId`           | `api_test_id`           | `integer("api_test_id").references(() => apiTests.id, { onDelete: 'cascade' })`                    |
| `mobileTestId`        | `mobile_test_id`        | `integer("mobile_test_id").references((): AnyPgColumn => mobileTests.id, { onDelete: 'cascade' })` |
| `version`             | `version`               | `integer("version").notNull()`                                                                     |
| `name`                | `name`                  | `text("name").notNull()`                                                                           |
| `url`                 | `url`                   | `text("url").notNull()`                                                                            |
| `sequence`            | `sequence`              | `jsonb("sequence").notNull()`                                                                      |
| `elements`            | `elements`              | `jsonb("elements").notNull()`                                                                      |
| `preconditions`       | `preconditions`         | `jsonb("preconditions")`                                                                           |
| `cleanups`            | `cleanups`              | `jsonb("cleanups")`                                                                                |
| `dataset`             | `dataset`               | `jsonb("dataset")`                                                                                 |
| `snapshot`            | `snapshot`              | `jsonb("snapshot").$type<Record<string, unknown>>()`                                               |
| `summary`             | `summary`               | `text("summary")`                                                                                  |
| `restoredFromVersion` | `restored_from_version` | `integer("restored_from_version")`                                                                 |
| `createdBy`           | `created_by`            | `integer("created_by").references(() => users.id, { onDelete: 'set null' })`                       |
| `createdAt`           | `created_at`            | `timestamp("created_at").defaultNow().notNull()`                                                   |

## test_publications {#test-publications}

`testPublications` — `shared/schema.ts:1264`

| TS property      | SQL column        | Declaration                                                                                        |
| ---------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                                                        |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`                          |
| `testId`         | `test_id`         | `integer("test_id").references(() => tests.id, { onDelete: 'cascade' })`                           |
| `apiTestId`      | `api_test_id`     | `integer("api_test_id").references(() => apiTests.id, { onDelete: 'cascade' })`                    |
| `mobileTestId`   | `mobile_test_id`  | `integer("mobile_test_id").references((): AnyPgColumn => mobileTests.id, { onDelete: 'cascade' })` |
| `version`        | `version`         | `integer("version")`                                                                               |
| `kind`           | `kind`            | `text("kind").$type<TestPublicationKind>().notNull()`                                              |
| `reviewId`       | `review_id`       | `integer("review_id")`                                                                             |
| `publishedBy`    | `published_by`    | `integer("published_by").references(() => users.id, { onDelete: 'set null' })`                     |
| `publishedAt`    | `published_at`    | `timestamp("published_at").defaultNow().notNull()`                                                 |

## test_reviews {#test-reviews}

`testReviews` — `shared/schema.ts:1288`

| TS property       | SQL column         | Declaration                                                                                        |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| `id`              | `id`               | `serial("id").primaryKey()`                                                                        |
| `organizationId`  | `organization_id`  | `integer("organization_id").notNull().references(() => organizations.id)`                          |
| `testId`          | `test_id`          | `integer("test_id").references(() => tests.id, { onDelete: 'cascade' })`                           |
| `apiTestId`       | `api_test_id`      | `integer("api_test_id").references(() => apiTests.id, { onDelete: 'cascade' })`                    |
| `mobileTestId`    | `mobile_test_id`   | `integer("mobile_test_id").references((): AnyPgColumn => mobileTests.id, { onDelete: 'cascade' })` |
| `version`         | `version`          | `integer("version").notNull()`                                                                     |
| `status`          | `status`           | `text("status").$type<TestReviewStatus>().notNull().default('pending')`                            |
| `note`            | `note`             | `text("note")`                                                                                     |
| `requestedBy`     | `requested_by`     | `integer("requested_by").references(() => users.id, { onDelete: 'set null' })`                     |
| `requestedAt`     | `requested_at`     | `timestamp("requested_at").defaultNow().notNull()`                                                 |
| `decidedBy`       | `decided_by`       | `integer("decided_by").references(() => users.id, { onDelete: 'set null' })`                       |
| `decidedAt`       | `decided_at`       | `timestamp("decided_at")`                                                                          |
| `decisionComment` | `decision_comment` | `text("decision_comment")`                                                                         |

## test_suites {#test-suites}

`testSuites` — `shared/schema.ts:1319`

| TS property      | SQL column        | Declaration                                                                     |
| ---------------- | ----------------- | ------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                                     |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`       |
| `projectId`      | `project_id`      | `integer("project_id").references(() => projects.id, { onDelete: 'set null' })` |
| `name`           | `name`            | `text("name").notNull()`                                                        |
| `description`    | `description`     | `text("description")`                                                           |
| `kind`           | `kind`            | `text("kind").$type<TestSuiteKind>().notNull().default('static')`               |
| `tagIds`         | `tag_ids`         | `jsonb("tag_ids").$type<string[]>().notNull().default([])`                      |
| `createdBy`      | `created_by`      | `integer("created_by").references(() => users.id, { onDelete: 'set null' })`    |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                |
| `updatedAt`      | `updated_at`      | `timestamp("updated_at").defaultNow().notNull()`                                |

## test_suite_items {#test-suite-items}

`testSuiteItems` — `shared/schema.ts:1338`

| TS property      | SQL column        | Declaration                                                                              |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                                              |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`                |
| `suiteId`        | `suite_id`        | `integer("suite_id").notNull().references(() => testSuites.id, { onDelete: 'cascade' })` |
| `testType`       | `test_type`       | `text("test_type").$type<'ui' &#124; 'api' &#124; 'mobile'>().notNull()`                 |
| `testId`         | `test_id`         | `integer("test_id").references(() => tests.id, { onDelete: 'cascade' })`                 |
| `apiTestId`      | `api_test_id`     | `integer("api_test_id").references(() => apiTests.id, { onDelete: 'cascade' })`          |
| `mobileTestId`   | `mobile_test_id`  | `integer("mobile_test_id")`                                                              |
| `position`       | `position`        | `integer("position").notNull()`                                                          |

## test_plan_suites {#test-plan-suites}

`testPlanSuites` — `shared/schema.ts:1353`

| TS property      | SQL column        | Declaration                                                                              |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `testPlanId`     | `test_plan_id`    | `text("test_plan_id").notNull().references(() => testPlans.id, { onDelete: 'cascade' })` |
| `suiteId`        | `suite_id`        | `integer("suite_id").notNull().references(() => testSuites.id, { onDelete: 'cascade' })` |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`                |
| `position`       | `position`        | `integer("position").notNull()`                                                          |

## test_quarantines {#test-quarantines}

`testQuarantines` — `shared/schema.ts:1368`

| TS property      | SQL column        | Declaration                                                                      |
| ---------------- | ----------------- | -------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                                      |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`        |
| `testType`       | `test_type`       | `text("test_type").$type<'ui' &#124; 'api' &#124; 'mobile'>().notNull()`         |
| `testId`         | `test_id`         | `integer("test_id").references(() => tests.id, { onDelete: 'cascade' })`         |
| `apiTestId`      | `api_test_id`     | `integer("api_test_id").references(() => apiTests.id, { onDelete: 'cascade' })`  |
| `mobileTestId`   | `mobile_test_id`  | `integer("mobile_test_id")`                                                      |
| `reason`         | `reason`          | `text("reason").notNull()`                                                       |
| `quarantinedBy`  | `quarantined_by`  | `integer("quarantined_by").references(() => users.id, { onDelete: 'set null' })` |
| `quarantinedAt`  | `quarantined_at`  | `timestamp("quarantined_at").defaultNow().notNull()`                             |
| `releasedBy`     | `released_by`     | `integer("released_by").references(() => users.id, { onDelete: 'set null' })`    |
| `releasedAt`     | `released_at`     | `timestamp("released_at")`                                                       |
| `releaseNote`    | `release_note`    | `text("release_note")`                                                           |

## agents {#agents}

`agents` — `shared/schema.ts:1394`

| TS property         | SQL column           | Declaration                                                                  |
| ------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `id`                | `id`                 | `text("id").primaryKey()`                                                    |
| `organizationId`    | `organization_id`    | `integer("organization_id").notNull().references(() => organizations.id)`    |
| `name`              | `name`               | `text("name").notNull()`                                                     |
| `pool`              | `pool`               | `text("pool").notNull().default('default')`                                  |
| `tokenPrefix`       | `token_prefix`       | `text("token_prefix").notNull()`                                             |
| `tokenHash`         | `token_hash`         | `text("token_hash").notNull().unique()`                                      |
| `createdBy`         | `created_by`         | `integer("created_by").references(() => users.id, { onDelete: 'set null' })` |
| `createdAt`         | `created_at`         | `timestamp("created_at").defaultNow().notNull()`                             |
| `lastSeenAt`        | `last_seen_at`       | `timestamp("last_seen_at")`                                                  |
| `hostname`          | `hostname`           | `text("hostname")`                                                           |
| `agentVersion`      | `agent_version`      | `text("agent_version")`                                                      |
| `playwrightVersion` | `playwright_version` | `text("playwright_version")`                                                 |
| `browsers`          | `browsers`           | `jsonb("browsers").$type<string[]>()`                                        |
| `bddProfiles`       | `bdd_profiles`       | `jsonb('bdd_profiles').$type<BddAgentProfile[]>()`                           |
| `revokedAt`         | `revoked_at`         | `timestamp("revoked_at")`                                                    |

## bdd_execution_profiles {#bdd-execution-profiles}

`bddExecutionProfiles` — `shared/schema.ts:1419`

| TS property         | SQL column            | Declaration                                                                                        |
| ------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `id`                | `id`                  | `text('id').primaryKey()`                                                                          |
| `organizationId`    | `organization_id`     | `integer('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' })` |
| `projectId`         | `project_id`          | `integer('project_id').references(() => projects.id, { onDelete: 'cascade' })`                     |
| `name`              | `name`                | `text('name').notNull()`                                                                           |
| `pool`              | `pool`                | `text('pool').notNull()`                                                                           |
| `operatorProfileId` | `operator_profile_id` | `text('operator_profile_id').notNull()`                                                            |
| `revision`          | `revision`            | `text('revision').notNull()`                                                                       |
| `timeoutMs`         | `timeout_ms`          | `integer('timeout_ms').notNull().default(60000)`                                                   |
| `createdAt`         | `created_at`          | `timestamp('created_at').defaultNow().notNull()`                                                   |
| `updatedAt`         | `updated_at`          | `timestamp('updated_at').defaultNow().notNull()`                                                   |

## source_hosts {#source-hosts}

`sourceHosts` — `shared/schema.ts:1440`

| TS property         | SQL column            | Declaration                                                                  |
| ------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `id`                | `id`                  | `text("id").primaryKey()`                                                    |
| `organizationId`    | `organization_id`     | `integer("organization_id").notNull().references(() => organizations.id)`    |
| `provider`          | `provider`            | `text("provider").$type<SourceHostProvider>().notNull()`                     |
| `apiUrl`            | `api_url`             | `text("api_url").notNull()`                                                  |
| `encryptedToken`    | `encrypted_token`     | `text("encrypted_token").notNull()`                                          |
| `tokenIv`           | `token_iv`            | `text("token_iv").notNull()`                                                 |
| `tokenAuthTag`      | `token_auth_tag`      | `text("token_auth_tag").notNull()`                                           |
| `createdBy`         | `created_by`          | `integer("created_by").references(() => users.id, { onDelete: 'set null' })` |
| `createdAt`         | `created_at`          | `timestamp("created_at").defaultNow().notNull()`                             |
| `updatedAt`         | `updated_at`          | `timestamp("updated_at").defaultNow().notNull()`                             |
| `lastDeliveryAt`    | `last_delivery_at`    | `timestamp("last_delivery_at")`                                              |
| `lastDeliveryError` | `last_delivery_error` | `text("last_delivery_error")`                                                |

## issue_trackers {#issue-trackers}

`issueTrackers` — `shared/schema.ts:1475`

| TS property      | SQL column        | Declaration                                                                  |
| ---------------- | ----------------- | ---------------------------------------------------------------------------- |
| `id`             | `id`              | `text("id").primaryKey()`                                                    |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`    |
| `name`           | `name`            | `text("name").notNull()`                                                     |
| `provider`       | `provider`        | `text("provider").notNull()`                                                 |
| `baseUrl`        | `base_url`        | `text("base_url").notNull()`                                                 |
| `projectKey`     | `project_key`     | `text("project_key").notNull()`                                              |
| `issueType`      | `issue_type`      | `text("issue_type").default('Bug').notNull()`                                |
| `userEmail`      | `user_email`      | `text("user_email")`                                                         |
| `encryptedToken` | `encrypted_token` | `text("encrypted_token").notNull()`                                          |
| `tokenIv`        | `token_iv`        | `text("token_iv").notNull()`                                                 |
| `tokenAuthTag`   | `token_auth_tag`  | `text("token_auth_tag").notNull()`                                           |
| `createdBy`      | `created_by`      | `integer("created_by").references(() => users.id, { onDelete: 'set null' })` |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                             |
| `updatedAt`      | `updated_at`      | `timestamp("updated_at").defaultNow().notNull()`                             |

## browser_grids {#browser-grids}

`browserGrids` — `shared/schema.ts:1502`

| TS property      | SQL column        | Declaration                                                                  |
| ---------------- | ----------------- | ---------------------------------------------------------------------------- |
| `id`             | `id`              | `text("id").primaryKey()`                                                    |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`    |
| `name`           | `name`            | `text("name").notNull()`                                                     |
| `provider`       | `provider`        | `text("provider").notNull()`                                                 |
| `username`       | `username`        | `text("username")`                                                           |
| `endpoint`       | `endpoint`        | `text("endpoint")`                                                           |
| `encryptedKey`   | `encrypted_key`   | `text("encrypted_key")`                                                      |
| `keyIv`          | `key_iv`          | `text("key_iv")`                                                             |
| `keyAuthTag`     | `key_auth_tag`    | `text("key_auth_tag")`                                                       |
| `agentPool`      | `agent_pool`      | `text("agent_pool")`                                                         |
| `createdBy`      | `created_by`      | `integer("created_by").references(() => users.id, { onDelete: 'set null' })` |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                             |
| `updatedAt`      | `updated_at`      | `timestamp("updated_at").defaultNow().notNull()`                             |

## requirements {#requirements}

`requirements` — `shared/schema.ts:1528`

| TS property      | SQL column        | Declaration                                                                                     |
| ---------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                                                     |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`                       |
| `key`            | `key`             | `text("key").notNull()`                                                                         |
| `title`          | `title`           | `text("title").notNull()`                                                                       |
| `description`    | `description`     | `text("description")`                                                                           |
| `kind`           | `kind`            | `text("kind").$type<RequirementKind>().notNull().default('story')`                              |
| `parentId`       | `parent_id`       | `integer("parent_id").references((): AnyPgColumn => requirements.id, { onDelete: 'set null' })` |
| `trackerId`      | `tracker_id`      | `text("tracker_id").references(() => issueTrackers.id, { onDelete: 'set null' })`               |
| `url`            | `url`             | `text("url")`                                                                                   |
| `externalType`   | `external_type`   | `text("external_type")`                                                                         |
| `externalStatus` | `external_status` | `text("external_status")`                                                                       |
| `syncedAt`       | `synced_at`       | `timestamp("synced_at")`                                                                        |
| `createdBy`      | `created_by`      | `integer("created_by").references(() => users.id, { onDelete: 'set null' })`                    |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                                |
| `updatedAt`      | `updated_at`      | `timestamp("updated_at").defaultNow().notNull()`                                                |

## test_management_connections {#test-management-connections}

`testManagementConnections` — `shared/schema.ts:1556`

| TS property      | SQL column        | Declaration                                                                  |
| ---------------- | ----------------- | ---------------------------------------------------------------------------- |
| `id`             | `id`              | `text("id").primaryKey()`                                                    |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`    |
| `name`           | `name`            | `text("name").notNull()`                                                     |
| `provider`       | `provider`        | `text("provider").$type<TestManagementProvider>().notNull()`                 |
| `baseUrl`        | `base_url`        | `text("base_url").notNull()`                                                 |
| `username`       | `username`        | `text("username")`                                                           |
| `projectKey`     | `project_key`     | `text("project_key").notNull()`                                              |
| `suiteId`        | `suite_id`        | `text("suite_id")`                                                           |
| `testPlanKey`    | `test_plan_key`   | `text("test_plan_key")`                                                      |
| `encryptedToken` | `encrypted_token` | `text("encrypted_token").notNull()`                                          |
| `tokenIv`        | `token_iv`        | `text("token_iv").notNull()`                                                 |
| `tokenAuthTag`   | `token_auth_tag`  | `text("token_auth_tag").notNull()`                                           |
| `createdBy`      | `created_by`      | `integer("created_by").references(() => users.id, { onDelete: 'set null' })` |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                             |
| `updatedAt`      | `updated_at`      | `timestamp("updated_at").defaultNow().notNull()`                             |

## test_case_links {#test-case-links}

`testCaseLinks` — `shared/schema.ts:1579`

| TS property      | SQL column        | Declaration                                                                                               |
| ---------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial("id").primaryKey()`                                                                               |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`                                 |
| `connectionId`   | `connection_id`   | `text("connection_id").notNull().references(() => testManagementConnections.id, { onDelete: 'cascade' })` |
| `testType`       | `test_type`       | `text("test_type").$type<'ui' &#124; 'api' &#124; 'mobile'>().notNull()`                                  |
| `testId`         | `test_id`         | `integer("test_id").references(() => tests.id, { onDelete: 'cascade' })`                                  |
| `apiTestId`      | `api_test_id`     | `integer("api_test_id").references(() => apiTests.id, { onDelete: 'cascade' })`                           |
| `mobileTestId`   | `mobile_test_id`  | `integer("mobile_test_id")`                                                                               |
| `caseKey`        | `case_key`        | `text("case_key").notNull()`                                                                              |
| `createdBy`      | `created_by`      | `integer("created_by").references(() => users.id, { onDelete: 'set null' })`                              |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                                          |

## test_management_publications {#test-management-publications}

`testManagementPublications` — `shared/schema.ts:1596`

| TS property           | SQL column               | Declaration                                                                                                 |
| --------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `id`                  | `id`                     | `serial("id").primaryKey()`                                                                                 |
| `organizationId`      | `organization_id`        | `integer("organization_id").notNull().references(() => organizations.id)`                                   |
| `testPlanExecutionId` | `test_plan_execution_id` | `text("test_plan_execution_id").notNull().references(() => testPlanExecutions.id, { onDelete: 'cascade' })` |
| `connectionId`        | `connection_id`          | `text("connection_id").references(() => testManagementConnections.id, { onDelete: 'set null' })`            |
| `connectionName`      | `connection_name`        | `text("connection_name").notNull()`                                                                         |
| `provider`            | `provider`               | `text("provider").notNull()`                                                                                |
| `status`              | `status`                 | `text("status").$type<'published' &#124; 'failed' &#124; 'nothing_to_publish'>().notNull()`                 |
| `externalKey`         | `external_key`           | `text("external_key")`                                                                                      |
| `externalUrl`         | `external_url`           | `text("external_url")`                                                                                      |
| `publishedCount`      | `published_count`        | `integer("published_count").notNull().default(0)`                                                           |
| `unmappedCount`       | `unmapped_count`         | `integer("unmapped_count").notNull().default(0)`                                                            |
| `message`             | `message`                | `text("message")`                                                                                           |
| `requestedBy`         | `requested_by`           | `integer("requested_by").references(() => users.id, { onDelete: 'set null' })`                              |
| `createdAt`           | `created_at`             | `timestamp("created_at").defaultNow().notNull()`                                                            |

## mobile_tests {#mobile-tests}

`mobileTests` — `shared/schema.ts:1621`

| TS property        | SQL column          | Declaration                                                                     |
| ------------------ | ------------------- | ------------------------------------------------------------------------------- |
| `id`               | `id`                | `serial("id").primaryKey()`                                                     |
| `organizationId`   | `organization_id`   | `integer("organization_id").notNull().references(() => organizations.id)`       |
| `projectId`        | `project_id`        | `integer("project_id").references(() => projects.id, { onDelete: 'set null' })` |
| `publishedVersion` | `published_version` | `integer("published_version")`                                                  |
| `name`             | `name`              | `text("name").notNull()`                                                        |
| `platform`         | `platform`          | `text("platform").$type<MobilePlatform>().notNull()`                            |
| `app`              | `app`               | `text("app").notNull()`                                                         |
| `deviceName`       | `device_name`       | `text("device_name").notNull()`                                                 |
| `osVersion`        | `os_version`        | `text("os_version")`                                                            |
| `deviceMatrix`     | `device_matrix`     | `jsonb('device_matrix').$type<MobileDeviceTarget[]>().notNull().default([])`    |
| `gridId`           | `grid_id`           | `text("grid_id").references(() => browserGrids.id, { onDelete: 'set null' })`   |
| `steps`            | `steps`             | `jsonb("steps").$type<MobileStep[]>().notNull().default([])`                    |
| `createdBy`        | `created_by`        | `integer("created_by").references(() => users.id, { onDelete: 'set null' })`    |
| `createdAt`        | `created_at`        | `timestamp("created_at").defaultNow().notNull()`                                |
| `updatedAt`        | `updated_at`        | `timestamp("updated_at").defaultNow().notNull()`                                |

## mobile_step_groups {#mobile-step-groups}

`mobileStepGroups` — `shared/schema.ts:1644`

| TS property      | SQL column        | Declaration                                                                     |
| ---------------- | ----------------- | ------------------------------------------------------------------------------- |
| `id`             | `id`              | `text('id').primaryKey()`                                                       |
| `organizationId` | `organization_id` | `integer('organization_id').notNull().references(() => organizations.id)`       |
| `projectId`      | `project_id`      | `integer('project_id').references(() => projects.id, { onDelete: 'set null' })` |
| `name`           | `name`            | `text('name').notNull()`                                                        |
| `description`    | `description`     | `text('description')`                                                           |
| `platform`       | `platform`        | `text('platform').$type<MobilePlatform>().notNull()`                            |
| `steps`          | `steps`           | `jsonb('steps').$type<MobileStep[]>().notNull()`                                |
| `createdBy`      | `created_by`      | `integer('created_by').references(() => users.id, { onDelete: 'set null' })`    |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').defaultNow().notNull()`                                |

## mobile_test_runs {#mobile-test-runs}

`mobileTestRuns` — `shared/schema.ts:1661`

| TS property             | SQL column                | Declaration                                                                                     |
| ----------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                    | `id`                      | `text("id").primaryKey()`                                                                       |
| `organizationId`        | `organization_id`         | `integer("organization_id").notNull().references(() => organizations.id)`                       |
| `mobileTestId`          | `mobile_test_id`          | `integer("mobile_test_id").notNull().references(() => mobileTests.id, { onDelete: 'cascade' })` |
| `gridId`                | `grid_id`                 | `text("grid_id").references(() => browserGrids.id, { onDelete: 'set null' })`                   |
| `environmentId`         | `environment_id`          | `integer("environment_id").references(() => environments.id, { onDelete: 'set null' })`         |
| `testVersion`           | `test_version`            | `integer("test_version")`                                                                       |
| `testSnapshot`          | `test_snapshot`           | `jsonb("test_snapshot").$type<Record<string, unknown>>()`                                       |
| `status`                | `status`                  | `text("status").$type<MobileRunStatus>().notNull()`                                             |
| `device`                | `device`                  | `text("device").notNull()`                                                                      |
| `steps`                 | `steps`                   | `jsonb("steps").$type<MobileStepResult[]>().notNull().default([])`                              |
| `error`                 | `error`                   | `text("error")`                                                                                 |
| `screenshot`            | `screenshot`              | `text("screenshot")`                                                                            |
| `artifactStorageStatus` | `artifact_storage_status` | `text('artifact_storage_status').$type<'quota_exceeded' &#124; 'error'>()`                      |
| `sessionUrl`            | `session_url`             | `text("session_url")`                                                                           |
| `requestedBy`           | `requested_by`            | `integer("requested_by").references(() => users.id, { onDelete: 'set null' })`                  |
| `startedAt`             | `started_at`              | `timestamp("started_at")`                                                                       |
| `finishedAt`            | `finished_at`             | `timestamp("finished_at")`                                                                      |
| `createdAt`             | `created_at`              | `timestamp("created_at").defaultNow().notNull()`                                                |

## requirement_tests {#requirement-tests}

`requirementTests` — `shared/schema.ts:1687`

| TS property      | SQL column        | Declaration                                                                                      |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `id`             | `id`              | `serial("id").primaryKey()`                                                                      |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`                        |
| `requirementId`  | `requirement_id`  | `integer("requirement_id").notNull().references(() => requirements.id, { onDelete: 'cascade' })` |
| `testType`       | `test_type`       | `text("test_type").$type<'ui' &#124; 'api' &#124; 'mobile'>().notNull()`                         |
| `testId`         | `test_id`         | `integer("test_id").references(() => tests.id, { onDelete: 'cascade' })`                         |
| `apiTestId`      | `api_test_id`     | `integer("api_test_id").references(() => apiTests.id, { onDelete: 'cascade' })`                  |
| `mobileTestId`   | `mobile_test_id`  | `integer("mobile_test_id").references(() => mobileTests.id, { onDelete: 'cascade' })`            |
| `createdBy`      | `created_by`      | `integer("created_by").references(() => users.id, { onDelete: 'set null' })`                     |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                                 |

## issue_links {#issue-links}

`issueLinks` — `shared/schema.ts:1718`

| TS property        | SQL column           | Declaration                                                                                    |
| ------------------ | -------------------- | ---------------------------------------------------------------------------------------------- |
| `id`               | `id`                 | `serial("id").primaryKey()`                                                                    |
| `organizationId`   | `organization_id`    | `integer("organization_id").notNull().references(() => organizations.id)`                      |
| `trackerId`        | `tracker_id`         | `text("tracker_id").notNull().references(() => issueTrackers.id, { onDelete: 'cascade' })`     |
| `dedupeKey`        | `dedupe_key`         | `text("dedupe_key").notNull()`                                                                 |
| `testPlanId`       | `test_plan_id`       | `text("test_plan_id").references(() => testPlans.id, { onDelete: 'set null' })`                |
| `uiTestId`         | `ui_test_id`         | `integer("ui_test_id").references(() => tests.id, { onDelete: 'set null' })`                   |
| `testName`         | `test_name`          | `text("test_name").notNull()`                                                                  |
| `browser`          | `browser`            | `text("browser")`                                                                              |
| `issueKey`         | `issue_key`          | `text("issue_key").notNull()`                                                                  |
| `issueUrl`         | `issue_url`          | `text("issue_url").notNull()`                                                                  |
| `firstExecutionId` | `first_execution_id` | `text("first_execution_id").references(() => testPlanExecutions.id, { onDelete: 'set null' })` |
| `lastExecutionId`  | `last_execution_id`  | `text("last_execution_id").references(() => testPlanExecutions.id, { onDelete: 'set null' })`  |
| `occurrences`      | `occurrences`        | `integer("occurrences").default(1).notNull()`                                                  |
| `resolvedAt`       | `resolved_at`        | `timestamp("resolved_at")`                                                                     |
| `createdAt`        | `created_at`         | `timestamp("created_at").defaultNow().notNull()`                                               |
| `updatedAt`        | `updated_at`         | `timestamp("updated_at").defaultNow().notNull()`                                               |

## api_keys {#api-keys}

`apiKeys` — `shared/schema.ts:1762`

| TS property      | SQL column        | Declaration                                                                        |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `id`             | `id`              | `text("id").primaryKey()`                                                          |
| `organizationId` | `organization_id` | `integer("organization_id").notNull().references(() => organizations.id)`          |
| `userId`         | `user_id`         | `integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' })` |
| `name`           | `name`            | `text("name").notNull()`                                                           |
| `prefix`         | `prefix`          | `text("prefix").notNull()`                                                         |
| `hashedKey`      | `hashed_key`      | `text("hashed_key").notNull().unique()`                                            |
| `createdAt`      | `created_at`      | `timestamp("created_at").defaultNow().notNull()`                                   |
| `lastUsedAt`     | `last_used_at`    | `timestamp("last_used_at")`                                                        |
| `expiresAt`      | `expires_at`      | `timestamp("expires_at")`                                                          |
| `revokedAt`      | `revoked_at`      | `timestamp("revoked_at")`                                                          |
| `scopes`         | `scopes`          | `text("scopes").array()`                                                           |

## sessions {#sessions}

`sessions` — `shared/schema.ts:1938`

| TS property | SQL column | Declaration                     |
| ----------- | ---------- | ------------------------------- |
| `sid`       | `sid`      | `text("sid").primaryKey()`      |
| `sess`      | `sess`     | `jsonb("sess").notNull()`       |
| `expire`    | `expire`   | `timestamp("expire").notNull()` |

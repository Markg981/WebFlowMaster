# Catalogo completo delle tabelle e colonne

Generato da `shared/schema/` (un file per dominio) con `node scripts/generate-schema-catalog.mjs`. Non si connette al database. Il codice SQL delle migrazioni resta autorità per indici, vincoli, policy RLS e permessi effettivi; questo catalogo descrive le dichiarazioni Drizzle, non lo stato di un ambiente installato.

Leggere prima lo [schema per dominio](./database-schema) per le spiegazioni e le relazioni, poi cercare qui la tabella. Ogni riga riporta la proprietà TypeScript, il nome SQL e il builder completo: tipo, nullabilità, default e riferimenti dichiarati nella colonna. I vincoli definiti nel callback della tabella non sono espansi qui.

**81 tabelle / 925 colonne dichiarate.**

## Indice

| SQL                                                           | TypeScript                   | Colonne |
| ------------------------------------------------------------- | ---------------------------- | ------- |
| [organizations](#organizations)                               | `organizations`              | 17      |
| [organization_keys](#organization-keys)                       | `organizationKeys`           | 7       |
| [quota_execution_sessions](#quota-execution-sessions)         | `quotaExecutionSessions`     | 6       |
| [quota_artifacts](#quota-artifacts)                           | `quotaArtifacts`             | 6       |
| [quota_installation_defaults](#quota-installation-defaults)   | `quotaInstallationDefaults`  | 4       |
| [users](#users)                                               | `users`                      | 9       |
| [organization_memberships](#organization-memberships)         | `organizationMemberships`    | 5       |
| [user_mfa](#user-mfa)                                         | `userMfa`                    | 11      |
| [user_settings](#user-settings)                               | `userSettings`               | 12      |
| [projects](#projects)                                         | `projects`                   | 6       |
| [project_members](#project-members)                           | `projectMembers`             | 5       |
| [system_settings](#system-settings)                           | `systemSettings`             | 2       |
| [invitations](#invitations)                                   | `invitations`                | 9       |
| [password_resets](#password-resets)                           | `passwordResets`             | 8       |
| [organization_sso](#organization-sso)                         | `organizationSso`            | 28      |
| [scim_users](#scim-users)                                     | `scimUsers`                  | 6       |
| [scim_groups](#scim-groups)                                   | `scimGroups`                 | 6       |
| [scim_group_members](#scim-group-members)                     | `scimGroupMembers`           | 2       |
| [sso_saml_requests](#sso-saml-requests)                       | `ssoSamlRequests`            | 5       |
| [sso_saml_replay](#sso-saml-replay)                           | `ssoSamlReplay`              | 3       |
| [sso_saml_sessions](#sso-saml-sessions)                       | `ssoSamlSessions`            | 8       |
| [sso_domains](#sso-domains)                                   | `ssoDomains`                 | 4       |
| [sso_identities](#sso-identities)                             | `ssoIdentities`              | 5       |
| [audit_log](#audit-log)                                       | `auditLog`                   | 11      |
| [api_keys](#api-keys)                                         | `apiKeys`                    | 11      |
| [sessions](#sessions)                                         | `sessions`                   | 3       |
| [tests](#tests)                                               | `tests`                      | 22      |
| [test_runs](#test-runs)                                       | `testRuns`                   | 7       |
| [detected_elements](#detected-elements)                       | `detectedElements`           | 11      |
| [excel_sequences_map](#excel-sequences-map)                   | `excelSequencesMap`          | 5       |
| [step_groups](#step-groups)                                   | `stepGroups`                 | 9       |
| [custom_actions](#custom-actions)                             | `customActions`              | 9       |
| [test_data_sets](#test-data-sets)                             | `testDataSets`               | 8       |
| [project_elements](#project-elements)                         | `projectElements`            | 14      |
| [healing_proposals](#healing-proposals)                       | `healingProposals`           | 24      |
| [tags](#tags)                                                 | `tags`                       | 4       |
| [test_tags](#test-tags)                                       | `testTags`                   | 8       |
| [test_versions](#test-versions)                               | `testVersions`               | 19      |
| [test_publications](#test-publications)                       | `testPublications`           | 10      |
| [test_reviews](#test-reviews)                                 | `testReviews`                | 13      |
| [mobile_tests](#mobile-tests)                                 | `mobileTests`                | 15      |
| [mobile_step_groups](#mobile-step-groups)                     | `mobileStepGroups`           | 10      |
| [load_tests](#load-tests)                                     | `loadTests`                  | 14      |
| [api_test_history](#api-test-history)                         | `apiTestHistory`             | 13      |
| [api_tests](#api-tests)                                       | `apiTests`                   | 32      |
| [test_plans](#test-plans)                                     | `testPlans`                  | 31      |
| [test_plan_schedules](#test-plan-schedules)                   | `testPlanSchedules`          | 16      |
| [test_plan_executions](#test-plan-executions)                 | `testPlanExecutions`         | 35      |
| [execution_outbox](#execution-outbox)                         | `executionOutbox`            | 10      |
| [report_test_case_results](#report-test-case-results)         | `reportTestCaseResults`      | 32      |
| [execution_logs](#execution-logs)                             | `executionLogs`              | 10      |
| [test_plan_webhooks](#test-plan-webhooks)                     | `testPlanWebhooks`           | 8       |
| [test_plan_selected_tests](#test-plan-selected-tests)         | `testPlanSelectedTests`      | 7       |
| [run_work_items](#run-work-items)                             | `runWorkItems`               | 13      |
| [execution_units](#execution-units)                           | `executionUnits`             | 9       |
| [execution_unit_attempts](#execution-unit-attempts)           | `executionUnitAttempts`      | 12      |
| [impact_rules](#impact-rules)                                 | `impactRules`                | 5       |
| [test_suites](#test-suites)                                   | `testSuites`                 | 10      |
| [test_suite_items](#test-suite-items)                         | `testSuiteItems`             | 8       |
| [test_plan_suites](#test-plan-suites)                         | `testPlanSuites`             | 4       |
| [test_quarantines](#test-quarantines)                         | `testQuarantines`            | 12      |
| [mobile_test_runs](#mobile-test-runs)                         | `mobileTestRuns`             | 18      |
| [load_test_runs](#load-test-runs)                             | `loadTestRuns`               | 17      |
| [runners](#runners)                                           | `runners`                    | 12      |
| [environments](#environments)                                 | `environments`               | 10      |
| [secrets](#secrets)                                           | `secrets`                    | 10      |
| [sms_messages](#sms-messages)                                 | `smsMessages`                | 7       |
| [agents](#agents)                                             | `agents`                     | 15      |
| [bdd_execution_profiles](#bdd-execution-profiles)             | `bddExecutionProfiles`       | 10      |
| [browser_grids](#browser-grids)                               | `browserGrids`               | 13      |
| [source_hosts](#source-hosts)                                 | `sourceHosts`                | 12      |
| [issue_trackers](#issue-trackers)                             | `issueTrackers`              | 14      |
| [requirements](#requirements)                                 | `requirements`               | 15      |
| [test_management_connections](#test-management-connections)   | `testManagementConnections`  | 15      |
| [test_case_links](#test-case-links)                           | `testCaseLinks`              | 10      |
| [test_management_publications](#test-management-publications) | `testManagementPublications` | 14      |
| [requirement_tests](#requirement-tests)                       | `requirementTests`           | 9       |
| [issue_links](#issue-links)                                   | `issueLinks`                 | 16      |
| [billing_plans](#billing-plans)                               | `billingPlans`               | 16      |
| [organization_subscriptions](#organization-subscriptions)     | `organizationSubscriptions`  | 15      |
| [billing_events](#billing-events)                             | `billingEvents`              | 9       |

## organizations {#organizations}

`organizations` — `shared/schema/identity.ts:20`

| Proprietà TS                 | Colonna SQL                     | Dichiarazione                                                      |
| ---------------------------- | ------------------------------- | ------------------------------------------------------------------ |
| `id`                         | `id`                            | `serial('id').primaryKey()`                                        |
| `name`                       | `name`                          | `text('name').notNull()`                                           |
| `createdAt`                  | `created_at`                    | `timestamp('created_at').defaultNow().notNull()`                   |
| `maxConcurrentRuns`          | `max_concurrent_runs`           | `integer('max_concurrent_runs')`                                   |
| `maxQueuedRuns`              | `max_queued_runs`               | `integer('max_queued_runs')`                                       |
| `quotaMode`                  | `quota_mode`                    | `text('quota_mode').$type<import('../tenant-quotas').QuotaMode>()` |
| `maxTests`                   | `max_tests`                     | `bigint('max_tests', { mode: 'number' })`                          |
| `maxArtifactBytes`           | `max_artifact_bytes`            | `bigint('max_artifact_bytes', { mode: 'number' })`                 |
| `maxMonthlyExecutionMinutes` | `max_monthly_execution_minutes` | `bigint('max_monthly_execution_minutes', { mode: 'number' })`      |
| `quotaRevision`              | `quota_revision`                | `integer('quota_revision').notNull().default(1)`                   |
| `artifactsReconciledAt`      | `artifacts_reconciled_at`       | `timestamp('artifacts_reconciled_at')`                             |
| `mfaRequired`                | `mfa_required`                  | `boolean('mfa_required').notNull().default(false)`                 |
| `testReviewRequired`         | `test_review_required`          | `boolean('test_review_required').notNull().default(false)`         |
| `aiEnabled`                  | `ai_enabled`                    | `boolean('ai_enabled').notNull().default(false)`                   |
| `smsInboundTokenHash`        | `sms_inbound_token_hash`        | `text('sms_inbound_token_hash')`                                   |
| `smsInboundTokenPrefix`      | `sms_inbound_token_prefix`      | `text('sms_inbound_token_prefix')`                                 |
| `smsInboundTokenCreatedAt`   | `sms_inbound_token_created_at`  | `timestamp('sms_inbound_token_created_at')`                        |

## organization_keys {#organization-keys}

`organizationKeys` — `shared/schema/identity.ts:57`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                        |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                                          |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id, { onDelete: 'cascade' })` |
| `keyVersion`     | `key_version`     | `integer('key_version').notNull()`                                                                   |
| `wrappedKey`     | `wrapped_key`     | `text('wrapped_key').notNull()`                                                                      |
| `masterKeyId`    | `master_key_id`   | `text('master_key_id').notNull()`                                                                    |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                                     |
| `retiredAt`      | `retired_at`      | `timestamp('retired_at')`                                                                            |

## quota_execution_sessions {#quota-execution-sessions}

`quotaExecutionSessions` — `shared/schema/identity.ts:78`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                        |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id, { onDelete: 'cascade' })` |
| `kind`           | `kind`            | `text('kind').notNull()`                                                                             |
| `executionId`    | `execution_id`    | `text('execution_id').notNull()`                                                                     |
| `startedAt`      | `started_at`      | `timestamp('started_at').notNull()`                                                                  |
| `heartbeatAt`    | `heartbeat_at`    | `timestamp('heartbeat_at').notNull()`                                                                |
| `endedAt`        | `ended_at`        | `timestamp('ended_at')`                                                                              |

## quota_artifacts {#quota-artifacts}

`quotaArtifacts` — `shared/schema/identity.ts:96`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                        |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id, { onDelete: 'cascade' })` |
| `key`            | `key`             | `text('key').notNull()`                                                                              |
| `bytes`          | `bytes`           | `bigint('bytes', { mode: 'number' }).notNull().default(0)`                                           |
| `reservedBytes`  | `reserved_bytes`  | `bigint('reserved_bytes', { mode: 'number' }).notNull().default(0)`                                  |
| `reservationId`  | `reservation_id`  | `text('reservation_id')`                                                                             |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').notNull().defaultNow()`                                                     |

## quota_installation_defaults {#quota-installation-defaults}

`quotaInstallationDefaults` — `shared/schema/identity.ts:111`

| Proprietà TS       | Colonna SQL          | Dichiarazione                                                           |
| ------------------ | -------------------- | ----------------------------------------------------------------------- |
| `id`               | `id`                 | `integer('id').primaryKey()`                                            |
| `mode`             | `mode`               | `text('mode').notNull()`                                                |
| `maxTests`         | `max_tests`          | `bigint('max_tests', { mode: 'number' }).notNull()`                     |
| `maxArtifactBytes` | `max_artifact_bytes` | `bigint('max_artifact_bytes', { mode: 'number' }).notNull().default(0)` |

## users {#users}

`users` — `shared/schema/identity.ts:118`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                               |
| ---------------- | ----------------- | --------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                 |
| `username`       | `username`        | `text('username').notNull().unique()`                                       |
| `password`       | `password`        | `text('password').notNull()`                                                |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)` |
| `role`           | `role`            | `text('role').notNull().default('editor')`                                  |
| `kind`           | `kind`            | `text('kind').notNull().default('person')`                                  |
| `displayName`    | `display_name`    | `text('display_name')`                                                      |
| `disabledAt`     | `disabled_at`     | `timestamp('disabled_at')`                                                  |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                            |

## organization_memberships {#organization-memberships}

`organizationMemberships` — `shared/schema/identity.ts:159`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                        |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                                          |
| `userId`         | `user_id`         | `integer('user_id') .notNull() .references(() => users.id, { onDelete: 'cascade' })`                 |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id, { onDelete: 'cascade' })` |
| `role`           | `role`            | `text('role').notNull().default('editor')`                                                           |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                                     |

## user_mfa {#user-mfa}

`userMfa` — `shared/schema/identity.ts:185`

| Proprietà TS             | Colonna SQL                | Dichiarazione                                                                           |
| ------------------------ | -------------------------- | --------------------------------------------------------------------------------------- |
| `userId`                 | `user_id`                  | `integer('user_id') .primaryKey() .references(() => users.id, { onDelete: 'cascade' })` |
| `secretEncrypted`        | `secret_encrypted`         | `text('secret_encrypted')`                                                              |
| `secretIv`               | `secret_iv`                | `text('secret_iv')`                                                                     |
| `secretAuthTag`          | `secret_auth_tag`          | `text('secret_auth_tag')`                                                               |
| `pendingSecretEncrypted` | `pending_secret_encrypted` | `text('pending_secret_encrypted')`                                                      |
| `pendingSecretIv`        | `pending_secret_iv`        | `text('pending_secret_iv')`                                                             |
| `pendingSecretAuthTag`   | `pending_secret_auth_tag`  | `text('pending_secret_auth_tag')`                                                       |
| `enabledAt`              | `enabled_at`               | `timestamp('enabled_at')`                                                               |
| `lastUsedStep`           | `last_used_step`           | `bigint('last_used_step', { mode: 'number' })`                                          |
| `recoveryCodes`          | `recovery_codes`           | `jsonb('recovery_codes').$type<string[]>().notNull().default([])`                       |
| `updatedAt`              | `updated_at`               | `timestamp('updated_at').defaultNow().notNull()`                                        |

## user_settings {#user-settings}

`userSettings` — `shared/schema/identity.ts:202`

| Proprietà TS               | Colonna SQL                  | Dichiarazione                                                                           |
| -------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `userId`                   | `user_id`                    | `integer('user_id') .primaryKey() .references(() => users.id, { onDelete: 'cascade' })` |
| `theme`                    | `theme`                      | `text('theme').default('light').notNull()`                                              |
| `defaultTestUrl`           | `default_test_url`           | `text('default_test_url')`                                                              |
| `playwrightBrowser`        | `playwright_browser`         | `text('playwright_browser').default('chromium').notNull()`                              |
| `playwrightHeadless`       | `playwright_headless`        | `boolean('playwright_headless').default(true).notNull()`                                |
| `playwrightDefaultTimeout` | `playwright_default_timeout` | `integer('playwright_default_timeout').default(30000).notNull()`                        |
| `playwrightWaitTime`       | `playwright_wait_time`       | `integer('playwright_wait_time').default(1000).notNull()`                               |
| `language`                 | `language`                   | `text('language').default('en').notNull()`                                              |
| `notifyByEmail`            | `notify_by_email`            | `boolean('notify_by_email').default(false).notNull()`                                   |
| `notifyRunCompleted`       | `notify_run_completed`       | `boolean('notify_run_completed').default(true).notNull()`                               |
| `notifyRunFailed`          | `notify_run_failed`          | `boolean('notify_run_failed').default(true).notNull()`                                  |
| `updatedAt`                | `updated_at`                 | `timestamp('updated_at').defaultNow().notNull()`                                        |

## projects {#projects}

`projects` — `shared/schema/identity.ts:224`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                               |
| ---------------- | ----------------- | --------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                 |
| `name`           | `name`            | `text('name').notNull()`                                                    |
| `userId`         | `user_id`         | `integer('user_id') .notNull() .references(() => users.id)`                 |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)` |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                            |
| `restricted`     | `restricted`      | `boolean('restricted').notNull().default(false)`                            |

## project_members {#project-members}

`projectMembers` — `shared/schema/identity.ts:252`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                              |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `projectId`      | `project_id`      | `integer('project_id') .notNull() .references(() => projects.id, { onDelete: 'cascade' })` |
| `userId`         | `user_id`         | `integer('user_id') .notNull() .references(() => users.id, { onDelete: 'cascade' })`       |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`                |
| `role`           | `role`            | `text('role').notNull()`                                                                   |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                           |

## system_settings {#system-settings}

`systemSettings` — `shared/schema/identity.ts:277`

| Proprietà TS | Colonna SQL | Dichiarazione              |
| ------------ | ----------- | -------------------------- |
| `key`        | `key`       | `text('key').primaryKey()` |
| `value`      | `value`     | `text('value')`            |

## invitations {#invitations}

`invitations` — `shared/schema/identity.ts:295`

| Proprietà TS      | Colonna SQL          | Dichiarazione                                                                         |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `id`              | `id`                 | `serial('id').primaryKey()`                                                           |
| `organizationId`  | `organization_id`    | `integer('organization_id') .notNull() .references(() => organizations.id)`           |
| `username`        | `username`           | `text('username').notNull()`                                                          |
| `role`            | `role`               | `text('role').notNull().default('editor')`                                            |
| `token`           | `token`              | `text('token').notNull().unique()`                                                    |
| `invitedByUserId` | `invited_by_user_id` | `integer('invited_by_user_id').references(() => users.id, { onDelete: 'set null', })` |
| `expiresAt`       | `expires_at`         | `timestamp('expires_at').notNull()`                                                   |
| `acceptedAt`      | `accepted_at`        | `timestamp('accepted_at')`                                                            |
| `createdAt`       | `created_at`         | `timestamp('created_at').defaultNow().notNull()`                                      |

## password_resets {#password-resets}

`passwordResets` — `shared/schema/identity.ts:339`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                        |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------ |
| `id`             | `id`              | `text('id').primaryKey()`                                                            |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`          |
| `userId`         | `user_id`         | `integer('user_id') .notNull() .references(() => users.id, { onDelete: 'cascade' })` |
| `tokenHash`      | `token_hash`      | `text('token_hash').notNull().unique()`                                              |
| `createdBy`      | `created_by`      | `integer('created_by').references(() => users.id, { onDelete: 'set null' })`         |
| `expiresAt`      | `expires_at`      | `timestamp('expires_at').notNull()`                                                  |
| `usedAt`         | `used_at`         | `timestamp('used_at')`                                                               |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                     |

## organization_sso {#organization-sso}

`organizationSso` — `shared/schema/identity.ts:371`

| Proprietà TS                     | Colonna SQL                         | Dichiarazione                                                                                                                      |
| -------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `organizationId`                 | `organization_id`                   | `integer('organization_id') .primaryKey() .references(() => organizations.id, { onDelete: 'cascade' })`                            |
| `protocol`                       | `protocol`                          | `text('protocol').notNull().default('oidc')`                                                                                       |
| `issuer`                         | `issuer`                            | `text('issuer').notNull()`                                                                                                         |
| `clientId`                       | `client_id`                         | `text('client_id')`                                                                                                                |
| `clientSecretEncrypted`          | `client_secret_encrypted`           | `text('client_secret_encrypted')`                                                                                                  |
| `clientSecretIv`                 | `client_secret_iv`                  | `text('client_secret_iv')`                                                                                                         |
| `clientSecretAuthTag`            | `client_secret_auth_tag`            | `text('client_secret_auth_tag')`                                                                                                   |
| `samlSsoUrl`                     | `saml_sso_url`                      | `text('saml_sso_url')`                                                                                                             |
| `samlCertificate`                | `saml_certificate`                  | `text('saml_certificate')`                                                                                                         |
| `samlAllowIdpInitiated`          | `saml_allow_idp_initiated`          | `boolean('saml_allow_idp_initiated').notNull().default(false)`                                                                     |
| `samlRequireEncryptedAssertions` | `saml_require_encrypted_assertions` | `boolean('saml_require_encrypted_assertions') .notNull() .default(false)`                                                          |
| `samlSloUrl`                     | `saml_slo_url`                      | `text('saml_slo_url')`                                                                                                             |
| `samlSpCertificate`              | `saml_sp_certificate`               | `text('saml_sp_certificate')`                                                                                                      |
| `samlSpPrivateKeyEncrypted`      | `saml_sp_private_key_encrypted`     | `text('saml_sp_private_key_encrypted')`                                                                                            |
| `samlSpPrivateKeyIv`             | `saml_sp_private_key_iv`            | `text('saml_sp_private_key_iv')`                                                                                                   |
| `samlSpPrivateKeyAuthTag`        | `saml_sp_private_key_auth_tag`      | `text('saml_sp_private_key_auth_tag')`                                                                                             |
| `defaultRole`                    | `default_role`                      | `text('default_role').notNull().default('viewer')`                                                                                 |
| `enabled`                        | `enabled`                           | `boolean('enabled').notNull().default(true)`                                                                                       |
| `required`                       | `required`                          | `boolean('required').notNull().default(false)`                                                                                     |
| `groupAttribute`                 | `group_attribute`                   | `text('group_attribute')`                                                                                                          |
| `roleMappings`                   | `role_mappings`                     | `jsonb('role_mappings') .$type<Array<{ group: string; role: 'viewer' &#124; 'editor' &#124; 'owner' }>>() .notNull() .default([])` |
| `requireGroup`                   | `require_group`                     | `boolean('require_group').notNull().default(false)`                                                                                |
| `trustUnverifiedEmail`           | `trust_unverified_email`            | `boolean('trust_unverified_email').notNull().default(false)`                                                                       |
| `scimTokenHash`                  | `scim_token_hash`                   | `text('scim_token_hash')`                                                                                                          |
| `scimTokenPrefix`                | `scim_token_prefix`                 | `text('scim_token_prefix')`                                                                                                        |
| `scimTokenCreatedAt`             | `scim_token_created_at`             | `timestamp('scim_token_created_at')`                                                                                               |
| `scimTokenLastUsedAt`            | `scim_token_last_used_at`           | `timestamp('scim_token_last_used_at')`                                                                                             |
| `updatedAt`                      | `updated_at`                        | `timestamp('updated_at').defaultNow().notNull()`                                                                                   |

## scim_users {#scim-users}

`scimUsers` — `shared/schema/identity.ts:440`

| Proprietà TS       | Colonna SQL          | Dichiarazione                                                                                        |
| ------------------ | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `userId`           | `user_id`            | `integer('user_id') .primaryKey() .references(() => users.id, { onDelete: 'cascade' })`              |
| `organizationId`   | `organization_id`    | `integer('organization_id') .notNull() .references(() => organizations.id, { onDelete: 'cascade' })` |
| `externalId`       | `external_id`        | `text('external_id')`                                                                                |
| `disabledByGroups` | `disabled_by_groups` | `boolean('disabled_by_groups').notNull().default(false)`                                             |
| `createdAt`        | `created_at`         | `timestamp('created_at').defaultNow().notNull()`                                                     |
| `updatedAt`        | `updated_at`         | `timestamp('updated_at').defaultNow().notNull()`                                                     |

## scim_groups {#scim-groups}

`scimGroups` — `shared/schema/identity.ts:459`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                        |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `text('id').primaryKey()`                                                                            |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id, { onDelete: 'cascade' })` |
| `displayName`    | `display_name`    | `text('display_name').notNull()`                                                                     |
| `externalId`     | `external_id`     | `text('external_id')`                                                                                |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                                     |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').defaultNow().notNull()`                                                     |

## scim_group_members {#scim-group-members}

`scimGroupMembers` — `shared/schema/identity.ts:474`

| Proprietà TS | Colonna SQL | Dichiarazione                                                                           |
| ------------ | ----------- | --------------------------------------------------------------------------------------- |
| `groupId`    | `group_id`  | `text('group_id') .notNull() .references(() => scimGroups.id, { onDelete: 'cascade' })` |
| `userId`     | `user_id`   | `integer('user_id') .notNull() .references(() => users.id, { onDelete: 'cascade' })`    |

## sso_saml_requests {#sso-saml-requests}

`ssoSamlRequests` — `shared/schema/identity.ts:495`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                        |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `text('id').primaryKey()`                                                                            |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id, { onDelete: 'cascade' })` |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                                     |
| `purpose`        | `purpose`         | `text('purpose').notNull().default('authn')`                                                         |
| `sessionId`      | `session_id`      | `text('session_id')`                                                                                 |

## sso_saml_replay {#sso-saml-replay}

`ssoSamlReplay` — `shared/schema/identity.ts:510`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                        |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `text('id').primaryKey()`                                                                            |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id, { onDelete: 'cascade' })` |
| `expiresAt`      | `expires_at`      | `timestamp('expires_at').notNull()`                                                                  |

## sso_saml_sessions {#sso-saml-sessions}

`ssoSamlSessions` — `shared/schema/identity.ts:523`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                        |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `sessionId`      | `session_id`      | `text('session_id').primaryKey()`                                                                    |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id, { onDelete: 'cascade' })` |
| `userId`         | `user_id`         | `integer('user_id') .notNull() .references(() => users.id, { onDelete: 'cascade' })`                 |
| `issuer`         | `issuer`          | `text('issuer').notNull()`                                                                           |
| `nameId`         | `name_id`         | `text('name_id').notNull()`                                                                          |
| `nameIdFormat`   | `name_id_format`  | `text('name_id_format')`                                                                             |
| `sessionIndex`   | `session_index`   | `text('session_index')`                                                                              |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                                     |

## sso_domains {#sso-domains}

`ssoDomains` — `shared/schema/identity.ts:549`

| Proprietà TS        | Colonna SQL          | Dichiarazione                                                                                        |
| ------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `domain`            | `domain`             | `text('domain').primaryKey()`                                                                        |
| `organizationId`    | `organization_id`    | `integer('organization_id') .notNull() .references(() => organizations.id, { onDelete: 'cascade' })` |
| `verificationToken` | `verification_token` | `text('verification_token')`                                                                         |
| `verifiedAt`        | `verified_at`        | `timestamp('verified_at')`                                                                           |

## sso_identities {#sso-identities}

`ssoIdentities` — `shared/schema/identity.ts:565`

| Proprietà TS   | Colonna SQL       | Dichiarazione                                                                                  |
| -------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `issuer`       | `issuer`          | `text('issuer').notNull()`                                                                     |
| `subject`      | `subject`         | `text('subject').notNull()`                                                                    |
| `userId`       | `user_id`         | `integer('user_id') .notNull() .unique() .references(() => users.id, { onDelete: 'cascade' })` |
| `createdAt`    | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                               |
| `lastSignInAt` | `last_sign_in_at` | `timestamp('last_sign_in_at').defaultNow().notNull()`                                          |

## audit_log {#audit-log}

`auditLog` — `shared/schema/identity.ts:597`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                   |
| ---------------- | ----------------- | ------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                     |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`     |
| `actorUserId`    | `actor_user_id`   | `integer('actor_user_id').references(() => users.id, { onDelete: 'set null' })` |
| `actorUsername`  | `actor_username`  | `text('actor_username')`                                                        |
| `action`         | `action`          | `text('action').notNull()`                                                      |
| `targetType`     | `target_type`     | `text('target_type')`                                                           |
| `targetId`       | `target_id`       | `text('target_id')`                                                             |
| `metadata`       | `metadata`        | `jsonb('metadata')`                                                             |
| `apiKeyId`       | `api_key_id`      | `text('api_key_id')`                                                            |
| `ipAddress`      | `ip_address`      | `text('ip_address')`                                                            |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                |

## api_keys {#api-keys}

`apiKeys` — `shared/schema/identity.ts:642`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                        |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------ |
| `id`             | `id`              | `text('id').primaryKey()`                                                            |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`          |
| `userId`         | `user_id`         | `integer('user_id') .notNull() .references(() => users.id, { onDelete: 'cascade' })` |
| `name`           | `name`            | `text('name').notNull()`                                                             |
| `prefix`         | `prefix`          | `text('prefix').notNull()`                                                           |
| `hashedKey`      | `hashed_key`      | `text('hashed_key').notNull().unique()`                                              |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                     |
| `lastUsedAt`     | `last_used_at`    | `timestamp('last_used_at')`                                                          |
| `expiresAt`      | `expires_at`      | `timestamp('expires_at')`                                                            |
| `revokedAt`      | `revoked_at`      | `timestamp('revoked_at')`                                                            |
| `scopes`         | `scopes`          | `text('scopes').array()`                                                             |

## sessions {#sessions}

`sessions` — `shared/schema/identity.ts:864`

| Proprietà TS | Colonna SQL | Dichiarazione                   |
| ------------ | ----------- | ------------------------------- |
| `sid`        | `sid`       | `text('sid').primaryKey()`      |
| `sess`       | `sess`      | `jsonb('sess').notNull()`       |
| `expire`     | `expire`    | `timestamp('expire').notNull()` |

## tests {#tests}

`tests` — `shared/schema/authoring.ts:30`

| Proprietà TS       | Colonna SQL         | Dichiarazione                                                                   |
| ------------------ | ------------------- | ------------------------------------------------------------------------------- |
| `id`               | `id`                | `serial('id').primaryKey()`                                                     |
| `userId`           | `user_id`           | `integer('user_id') .notNull() .references(() => users.id)`                     |
| `organizationId`   | `organization_id`   | `integer('organization_id') .notNull() .references(() => organizations.id)`     |
| `projectId`        | `project_id`        | `integer('project_id').references(() => projects.id, { onDelete: 'set null' })` |
| `name`             | `name`              | `text('name').notNull()`                                                        |
| `url`              | `url`               | `text('url').notNull()`                                                         |
| `sequence`         | `sequence`          | `jsonb('sequence').notNull()`                                                   |
| `bdd`              | `bdd`               | `jsonb('bdd').$type<BddTest>()`                                                 |
| `elements`         | `elements`          | `jsonb('elements').notNull()`                                                   |
| `preconditions`    | `preconditions`     | `jsonb('preconditions')`                                                        |
| `cleanups`         | `cleanups`          | `jsonb('cleanups')`                                                             |
| `dataset`          | `dataset`           | `jsonb('dataset')`                                                              |
| `status`           | `status`            | `text('status').notNull().default('draft')`                                     |
| `publishedVersion` | `published_version` | `integer('published_version')`                                                  |
| `createdAt`        | `created_at`        | `timestamp('created_at').defaultNow().notNull()`                                |
| `updatedAt`        | `updated_at`        | `timestamp('updated_at').defaultNow().notNull()`                                |
| `module`           | `module`            | `text('module')`                                                                |
| `featureArea`      | `feature_area`      | `text('feature_area')`                                                          |
| `scenario`         | `scenario`          | `text('scenario')`                                                              |
| `component`        | `component`         | `text('component')`                                                             |
| `priority`         | `priority`          | `text('priority').default('Medium')`                                            |
| `severity`         | `severity`          | `text('severity').default('Major')`                                             |

## test_runs {#test-runs}

`testRuns` — `shared/schema/authoring.ts:85`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                               |
| ---------------- | ----------------- | --------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                 |
| `testId`         | `test_id`         | `integer('test_id') .notNull() .references(() => tests.id)`                 |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)` |
| `status`         | `status`          | `text('status').notNull()`                                                  |
| `results`        | `results`         | `jsonb('results')`                                                          |
| `startedAt`      | `started_at`      | `timestamp('started_at').defaultNow().notNull()`                            |
| `completedAt`    | `completed_at`    | `timestamp('completed_at')`                                                 |

## detected_elements {#detected-elements}

`detectedElements` — `shared/schema/authoring.ts:106`

| Proprietà TS       | Colonna SQL         | Dichiarazione                                                                        |
| ------------------ | ------------------- | ------------------------------------------------------------------------------------ |
| `id`               | `id`                | `serial('id').primaryKey()`                                                          |
| `testId`           | `test_id`           | `integer('test_id') .notNull() .references(() => tests.id, { onDelete: 'cascade' })` |
| `organizationId`   | `organization_id`   | `integer('organization_id') .notNull() .references(() => organizations.id)`          |
| `elementId`        | `element_id`        | `text('element_id').notNull()`                                                       |
| `selector`         | `selector`          | `text('selector').notNull()`                                                         |
| `originalSelector` | `original_selector` | `text('original_selector')`                                                          |
| `type`             | `type`              | `text('type')`                                                                       |
| `text`             | `text`              | `text('text')`                                                                       |
| `tag`              | `tag`               | `text('tag')`                                                                        |
| `attributes`       | `attributes`        | `jsonb('attributes')`                                                                |
| `createdAt`        | `created_at`        | `timestamp('created_at').defaultNow().notNull()`                                     |

## excel_sequences_map {#excel-sequences-map}

`excelSequencesMap` — `shared/schema/authoring.ts:133`

| Proprietà TS      | Colonna SQL          | Dichiarazione                                                                        |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `id`              | `id`                 | `serial('id').primaryKey()`                                                          |
| `testId`          | `test_id`            | `integer('test_id') .notNull() .references(() => tests.id, { onDelete: 'cascade' })` |
| `organizationId`  | `organization_id`    | `integer('organization_id') .notNull() .references(() => organizations.id)`          |
| `excelTestCaseId` | `excel_test_case_id` | `text('excel_test_case_id').notNull()`                                               |
| `createdAt`       | `created_at`         | `timestamp('created_at').defaultNow().notNull()`                                     |

## step_groups {#step-groups}

`stepGroups` — `shared/schema/authoring.ts:169`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                   |
| ---------------- | ----------------- | ------------------------------------------------------------------------------- |
| `id`             | `id`              | `text('id').primaryKey()`                                                       |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`     |
| `userId`         | `user_id`         | `integer('user_id') .notNull() .references(() => users.id)`                     |
| `projectId`      | `project_id`      | `integer('project_id').references(() => projects.id, { onDelete: 'set null' })` |
| `name`           | `name`            | `text('name').notNull()`                                                        |
| `description`    | `description`     | `text('description')`                                                           |
| `sequence`       | `sequence`        | `jsonb('sequence').notNull()`                                                   |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').defaultNow().notNull()`                                |

## custom_actions {#custom-actions}

`customActions` — `shared/schema/authoring.ts:202`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                |
| ---------------- | ----------------- | ---------------------------------------------------------------------------- |
| `id`             | `id`              | `text('id').primaryKey()`                                                    |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`  |
| `userId`         | `user_id`         | `integer('user_id') .notNull() .references(() => users.id)`                  |
| `name`           | `name`            | `text('name').notNull()`                                                     |
| `description`    | `description`     | `text('description')`                                                        |
| `parameters`     | `parameters`      | `jsonb('parameters').$type<CustomActionParameter[]>().notNull().default([])` |
| `script`         | `script`          | `text('script').notNull()`                                                   |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                             |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').defaultNow().notNull()`                             |

## test_data_sets {#test-data-sets}

`testDataSets` — `shared/schema/authoring.ts:232`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                               |
| ---------------- | ----------------- | --------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                 |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)` |
| `name`           | `name`            | `text('name').notNull()`                                                    |
| `description`    | `description`     | `text('description')`                                                       |
| `columns`        | `columns`         | `jsonb('columns').$type<string[]>().notNull()`                              |
| `rows`           | `rows`            | `jsonb('rows').$type<Array<Record<string, string>>>().notNull()`            |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                            |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').defaultNow().notNull()`                            |

## project_elements {#project-elements}

`projectElements` — `shared/schema/authoring.ts:265`

| Proprietà TS       | Colonna SQL         | Dichiarazione                                                                              |
| ------------------ | ------------------- | ------------------------------------------------------------------------------------------ |
| `id`               | `id`                | `text('id').primaryKey()`                                                                  |
| `organizationId`   | `organization_id`   | `integer('organization_id') .notNull() .references(() => organizations.id)`                |
| `projectId`        | `project_id`        | `integer('project_id') .notNull() .references(() => projects.id, { onDelete: 'cascade' })` |
| `name`             | `name`              | `text('name').notNull()`                                                                   |
| `selector`         | `selector`          | `text('selector').notNull()`                                                               |
| `originalSelector` | `original_selector` | `text('original_selector')`                                                                |
| `frameSelector`    | `frame_selector`    | `text('frame_selector')`                                                                   |
| `tag`              | `tag`               | `text('tag')`                                                                              |
| `elementType`      | `element_type`      | `text('element_type')`                                                                     |
| `text`             | `text`              | `text('text')`                                                                             |
| `attributes`       | `attributes`        | `jsonb('attributes')`                                                                      |
| `healedAt`         | `healed_at`         | `timestamp('healed_at')`                                                                   |
| `createdAt`        | `created_at`        | `timestamp('created_at').defaultNow().notNull()`                                           |
| `updatedAt`        | `updated_at`        | `timestamp('updated_at').defaultNow().notNull()`                                           |

## healing_proposals {#healing-proposals}

`healingProposals` — `shared/schema/authoring.ts:308`

| Proprietà TS        | Colonna SQL          | Dichiarazione                                                                                               |
| ------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`                | `id`                 | `text('id').primaryKey()`                                                                                   |
| `organizationId`    | `organization_id`    | `integer('organization_id') .notNull() .references(() => organizations.id)`                                 |
| `projectId`         | `project_id`         | `integer('project_id').references(() => projects.id, { onDelete: 'set null' })`                             |
| `testId`            | `test_id`            | `integer('test_id').notNull()`                                                                              |
| `executionId`       | `execution_id`       | `text('execution_id')`                                                                                      |
| `unitId`            | `unit_id`            | `text('unit_id')`                                                                                           |
| `attempt`           | `attempt`            | `integer('attempt')`                                                                                        |
| `stepIndex`         | `step_index`         | `integer('step_index').notNull()`                                                                           |
| `targetKind`        | `target_kind`        | `text('target_kind').$type<HealingTargetKind>().notNull()`                                                  |
| `targetRef`         | `target_ref`         | `text('target_ref').notNull()`                                                                              |
| `targetIndex`       | `target_index`       | `integer('target_index')`                                                                                   |
| `stepId`            | `step_id`            | `text('step_id')`                                                                                           |
| `callPath`          | `call_path`          | `jsonb('call_path') .$type<Array<{ index: number; stepId: string &#124; null }>>() .notNull() .default([])` |
| `sourceFingerprint` | `source_fingerprint` | `text('source_fingerprint').notNull()`                                                                      |
| `origin`            | `origin`             | `text('origin').$type<HealingOrigin>().notNull()`                                                           |
| `selectorBefore`    | `selector_before`    | `text('selector_before')`                                                                                   |
| `selectorAfter`     | `selector_after`     | `text('selector_after').notNull()`                                                                          |
| `status`            | `status`             | `text('status').$type<HealingProposalStatus>().notNull().default('proposed')`                               |
| `reason`            | `reason`             | `text('reason')`                                                                                            |
| `decidedBy`         | `decided_by`         | `integer('decided_by').references(() => users.id, { onDelete: 'set null' })`                                |
| `decidedAt`         | `decided_at`         | `timestamp('decided_at')`                                                                                   |
| `appliedVersion`    | `applied_version`    | `integer('applied_version')`                                                                                |
| `createdAt`         | `created_at`         | `timestamp('created_at').notNull().defaultNow()`                                                            |
| `updatedAt`         | `updated_at`         | `timestamp('updated_at').notNull().defaultNow()`                                                            |

## tags {#tags}

`tags` — `shared/schema/authoring.ts:372`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                               |
| ---------------- | ----------------- | --------------------------------------------------------------------------- |
| `id`             | `id`              | `text('id').primaryKey()`                                                   |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)` |
| `name`           | `name`            | `text('name').notNull()`                                                    |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                            |

## test_tags {#test-tags}

`testTags` — `shared/schema/authoring.ts:396`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                   |
| ---------------- | ----------------- | ------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                     |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`     |
| `tagId`          | `tag_id`          | `text('tag_id') .notNull() .references(() => tags.id, { onDelete: 'cascade' })` |
| `testId`         | `test_id`         | `integer('test_id').references(() => tests.id, { onDelete: 'cascade' })`        |
| `apiTestId`      | `api_test_id`     | `integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' })` |
| `mobileTestId`   | `mobile_test_id`  | `integer('mobile_test_id')`                                                     |
| `testType`       | `test_type`       | `text('test_type').notNull()`                                                   |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                |

## test_versions {#test-versions}

`testVersions` — `shared/schema/authoring.ts:441`

| Proprietà TS          | Colonna SQL             | Dichiarazione                                                                                       |
| --------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| `bdd`                 | `bdd`                   | `jsonb('bdd').$type<BddTest>()`                                                                     |
| `id`                  | `id`                    | `serial('id').primaryKey()`                                                                         |
| `organizationId`      | `organization_id`       | `integer('organization_id') .notNull() .references(() => organizations.id)`                         |
| `testId`              | `test_id`               | `integer('test_id').references(() => tests.id, { onDelete: 'cascade' })`                            |
| `apiTestId`           | `api_test_id`           | `integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' })`                     |
| `mobileTestId`        | `mobile_test_id`        | `integer('mobile_test_id').references((): AnyPgColumn => mobileTests.id, { onDelete: 'cascade', })` |
| `version`             | `version`               | `integer('version').notNull()`                                                                      |
| `name`                | `name`                  | `text('name').notNull()`                                                                            |
| `url`                 | `url`                   | `text('url').notNull()`                                                                             |
| `sequence`            | `sequence`              | `jsonb('sequence').notNull()`                                                                       |
| `elements`            | `elements`              | `jsonb('elements').notNull()`                                                                       |
| `preconditions`       | `preconditions`         | `jsonb('preconditions')`                                                                            |
| `cleanups`            | `cleanups`              | `jsonb('cleanups')`                                                                                 |
| `dataset`             | `dataset`               | `jsonb('dataset')`                                                                                  |
| `snapshot`            | `snapshot`              | `jsonb('snapshot').$type<Record<string, unknown>>()`                                                |
| `summary`             | `summary`               | `text('summary')`                                                                                   |
| `restoredFromVersion` | `restored_from_version` | `integer('restored_from_version')`                                                                  |
| `createdBy`           | `created_by`            | `integer('created_by').references(() => users.id, { onDelete: 'set null' })`                        |
| `createdAt`           | `created_at`            | `timestamp('created_at').defaultNow().notNull()`                                                    |

## test_publications {#test-publications}

`testPublications` — `shared/schema/authoring.ts:505`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                       |
| ---------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                                         |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`                         |
| `testId`         | `test_id`         | `integer('test_id').references(() => tests.id, { onDelete: 'cascade' })`                            |
| `apiTestId`      | `api_test_id`     | `integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' })`                     |
| `mobileTestId`   | `mobile_test_id`  | `integer('mobile_test_id').references((): AnyPgColumn => mobileTests.id, { onDelete: 'cascade', })` |
| `version`        | `version`         | `integer('version')`                                                                                |
| `kind`           | `kind`            | `text('kind').$type<TestPublicationKind>().notNull()`                                               |
| `reviewId`       | `review_id`       | `integer('review_id')`                                                                              |
| `publishedBy`    | `published_by`    | `integer('published_by').references(() => users.id, { onDelete: 'set null' })`                      |
| `publishedAt`    | `published_at`    | `timestamp('published_at').defaultNow().notNull()`                                                  |

## test_reviews {#test-reviews}

`testReviews` — `shared/schema/authoring.ts:548`

| Proprietà TS      | Colonna SQL        | Dichiarazione                                                                                       |
| ----------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `id`              | `id`               | `serial('id').primaryKey()`                                                                         |
| `organizationId`  | `organization_id`  | `integer('organization_id') .notNull() .references(() => organizations.id)`                         |
| `testId`          | `test_id`          | `integer('test_id').references(() => tests.id, { onDelete: 'cascade' })`                            |
| `apiTestId`       | `api_test_id`      | `integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' })`                     |
| `mobileTestId`    | `mobile_test_id`   | `integer('mobile_test_id').references((): AnyPgColumn => mobileTests.id, { onDelete: 'cascade', })` |
| `version`         | `version`          | `integer('version').notNull()`                                                                      |
| `status`          | `status`           | `text('status').$type<TestReviewStatus>().notNull().default('pending')`                             |
| `note`            | `note`             | `text('note')`                                                                                      |
| `requestedBy`     | `requested_by`     | `integer('requested_by').references(() => users.id, { onDelete: 'set null' })`                      |
| `requestedAt`     | `requested_at`     | `timestamp('requested_at').defaultNow().notNull()`                                                  |
| `decidedBy`       | `decided_by`       | `integer('decided_by').references(() => users.id, { onDelete: 'set null' })`                        |
| `decidedAt`       | `decided_at`       | `timestamp('decided_at')`                                                                           |
| `decisionComment` | `decision_comment` | `text('decision_comment')`                                                                          |

## mobile_tests {#mobile-tests}

`mobileTests` — `shared/schema/authoring.ts:595`

| Proprietà TS       | Colonna SQL         | Dichiarazione                                                                   |
| ------------------ | ------------------- | ------------------------------------------------------------------------------- |
| `id`               | `id`                | `serial('id').primaryKey()`                                                     |
| `organizationId`   | `organization_id`   | `integer('organization_id') .notNull() .references(() => organizations.id)`     |
| `projectId`        | `project_id`        | `integer('project_id').references(() => projects.id, { onDelete: 'set null' })` |
| `publishedVersion` | `published_version` | `integer('published_version')`                                                  |
| `name`             | `name`              | `text('name').notNull()`                                                        |
| `platform`         | `platform`          | `text('platform').$type<MobilePlatform>().notNull()`                            |
| `app`              | `app`               | `text('app').notNull()`                                                         |
| `deviceName`       | `device_name`       | `text('device_name').notNull()`                                                 |
| `osVersion`        | `os_version`        | `text('os_version')`                                                            |
| `deviceMatrix`     | `device_matrix`     | `jsonb('device_matrix').$type<MobileDeviceTarget[]>().notNull().default([])`    |
| `gridId`           | `grid_id`           | `text('grid_id').references(() => browserGrids.id, { onDelete: 'set null' })`   |
| `steps`            | `steps`             | `jsonb('steps').$type<MobileStep[]>().notNull().default([])`                    |
| `createdBy`        | `created_by`        | `integer('created_by').references(() => users.id, { onDelete: 'set null' })`    |
| `createdAt`        | `created_at`        | `timestamp('created_at').defaultNow().notNull()`                                |
| `updatedAt`        | `updated_at`        | `timestamp('updated_at').defaultNow().notNull()`                                |

## mobile_step_groups {#mobile-step-groups}

`mobileStepGroups` — `shared/schema/authoring.ts:622`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                   |
| ---------------- | ----------------- | ------------------------------------------------------------------------------- |
| `id`             | `id`              | `text('id').primaryKey()`                                                       |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`     |
| `projectId`      | `project_id`      | `integer('project_id').references(() => projects.id, { onDelete: 'set null' })` |
| `name`           | `name`            | `text('name').notNull()`                                                        |
| `description`    | `description`     | `text('description')`                                                           |
| `platform`       | `platform`        | `text('platform').$type<MobilePlatform>().notNull()`                            |
| `steps`          | `steps`           | `jsonb('steps').$type<MobileStep[]>().notNull()`                                |
| `createdBy`      | `created_by`      | `integer('created_by').references(() => users.id, { onDelete: 'set null' })`    |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').defaultNow().notNull()`                                |

## load_tests {#load-tests}

`loadTests` — `shared/schema/authoring.ts:657`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                        |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------ |
| `id`             | `id`              | `serial('id').primaryKey()`                                                          |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`          |
| `projectId`      | `project_id`      | `integer('project_id').references(() => projects.id, { onDelete: 'set null' })`      |
| `name`           | `name`            | `text('name').notNull()`                                                             |
| `description`    | `description`     | `text('description')`                                                                |
| `steps`          | `steps`           | `jsonb('steps').$type<LoadStep[]>().notNull()`                                       |
| `stages`         | `stages`          | `jsonb('stages').$type<LoadStage[]>().notNull()`                                     |
| `warmUpSec`      | `warm_up_sec`     | `integer('warm_up_sec').notNull().default(0)`                                        |
| `dataSetId`      | `data_set_id`     | `integer('data_set_id').references(() => testDataSets.id, { onDelete: 'set null' })` |
| `dataMode`       | `data_mode`       | `text('data_mode').$type<LoadDataMode>().notNull().default('vu')`                    |
| `thresholds`     | `thresholds`      | `jsonb('thresholds').$type<LoadThresholds>().notNull().default({})`                  |
| `createdBy`      | `created_by`      | `integer('created_by').references(() => users.id, { onDelete: 'set null' })`         |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                     |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').defaultNow().notNull()`                                     |

## api_test_history {#api-test-history}

`apiTestHistory` — `shared/schema/api-testing.ts:10`

| Proprietà TS      | Colonna SQL        | Dichiarazione                                                                        |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `id`              | `id`               | `serial('id').primaryKey()`                                                          |
| `userId`          | `user_id`          | `integer('user_id') .notNull() .references(() => users.id, { onDelete: 'cascade' })` |
| `organizationId`  | `organization_id`  | `integer('organization_id') .notNull() .references(() => organizations.id)`          |
| `method`          | `method`           | `text('method').notNull()`                                                           |
| `url`             | `url`              | `text('url').notNull()`                                                              |
| `queryParams`     | `query_params`     | `jsonb('query_params')`                                                              |
| `requestHeaders`  | `request_headers`  | `jsonb('request_headers')`                                                           |
| `requestBody`     | `request_body`     | `text('request_body')`                                                               |
| `responseStatus`  | `response_status`  | `integer('response_status')`                                                         |
| `responseHeaders` | `response_headers` | `jsonb('response_headers')`                                                          |
| `responseBody`    | `response_body`    | `text('response_body')`                                                              |
| `durationMs`      | `duration_ms`      | `integer('duration_ms')`                                                             |
| `createdAt`       | `created_at`       | `timestamp('created_at').defaultNow().notNull()`                                     |

## api_tests {#api-tests}

`apiTests` — `shared/schema/api-testing.ts:37`

| Proprietà TS           | Colonna SQL              | Dichiarazione                                                                   |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `id`                   | `id`                     | `serial('id').primaryKey()`                                                     |
| `userId`               | `user_id`                | `integer('user_id') .notNull() .references(() => users.id)`                     |
| `organizationId`       | `organization_id`        | `integer('organization_id') .notNull() .references(() => organizations.id)`     |
| `projectId`            | `project_id`             | `integer('project_id').references(() => projects.id, { onDelete: 'set null' })` |
| `publishedVersion`     | `published_version`      | `integer('published_version')`                                                  |
| `name`                 | `name`                   | `text('name').notNull()`                                                        |
| `method`               | `method`                 | `text('method').notNull()`                                                      |
| `url`                  | `url`                    | `text('url').notNull()`                                                         |
| `queryParams`          | `query_params`           | `jsonb('query_params')`                                                         |
| `requestHeaders`       | `request_headers`        | `jsonb('request_headers')`                                                      |
| `requestBody`          | `request_body`           | `text('request_body')`                                                          |
| `assertions`           | `assertions`             | `jsonb('assertions')`                                                           |
| `extractions`          | `extractions`            | `jsonb('extractions')`                                                          |
| `performance`          | `performance`            | `jsonb('performance').$type<ApiPerformance>()`                                  |
| `authType`             | `auth_type`              | `text('auth_type')`                                                             |
| `authParams`           | `auth_params`            | `jsonb('auth_params')`                                                          |
| `bodyType`             | `body_type`              | `text('body_type')`                                                             |
| `bodyRawContentType`   | `body_raw_content_type`  | `text('body_raw_content_type')`                                                 |
| `bodyFormData`         | `body_form_data`         | `jsonb('body_form_data')`                                                       |
| `bodyUrlEncoded`       | `body_url_encoded`       | `jsonb('body_url_encoded')`                                                     |
| `bodyGraphqlQuery`     | `body_graphql_query`     | `text('body_graphql_query')`                                                    |
| `bodyGraphqlVariables` | `body_graphql_variables` | `text('body_graphql_variables')`                                                |
| `protoDefinition`      | `proto_definition`       | `text('proto_definition')`                                                      |
| `protocolConfig`       | `protocol_config`        | `jsonb('protocol_config').$type<ProtocolConfig>()`                              |
| `createdAt`            | `created_at`             | `timestamp('created_at').defaultNow().notNull()`                                |
| `updatedAt`            | `updated_at`             | `timestamp('updated_at').defaultNow().notNull()`                                |
| `module`               | `module`                 | `text('module')`                                                                |
| `featureArea`          | `feature_area`           | `text('feature_area')`                                                          |
| `scenario`             | `scenario`               | `text('scenario')`                                                              |
| `component`            | `component`              | `text('component')`                                                             |
| `priority`             | `priority`               | `text('priority').default('Medium')`                                            |
| `severity`             | `severity`               | `text('severity').default('Major')`                                             |

## test_plans {#test-plans}

`testPlans` — `shared/schema/execution.ts:41`

| Proprietà TS                     | Colonna SQL                           | Dichiarazione                                                                                                         |
| -------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`                             | `id`                                  | `text('id').primaryKey()`                                                                                             |
| `userId`                         | `user_id`                             | `integer('user_id') .notNull() .references(() => users.id)`                                                           |
| `organizationId`                 | `organization_id`                     | `integer('organization_id') .notNull() .references(() => organizations.id)`                                           |
| `name`                           | `name`                                | `text('name').notNull()`                                                                                              |
| `description`                    | `description`                         | `text('description')`                                                                                                 |
| `testMachinesConfig`             | `test_machines_config`                | `jsonb('test_machines_config')`                                                                                       |
| `captureScreenshots`             | `capture_screenshots`                 | `text('capture_screenshots').default('on_failed_steps')`                                                              |
| `captureVideo`                   | `capture_video`                       | `text('capture_video').default('never').notNull()`                                                                    |
| `captureTrace`                   | `capture_trace`                       | `text('capture_trace').default('never').notNull()`                                                                    |
| `captureNetwork`                 | `capture_network`                     | `text('capture_network').default('never').notNull()`                                                                  |
| `agentPool`                      | `agent_pool`                          | `text('agent_pool')`                                                                                                  |
| `browserGridId`                  | `browser_grid_id`                     | `text('browser_grid_id').references(() => browserGrids.id, { onDelete: 'set null', })`                                |
| `visualTestingEnabled`           | `visual_testing_enabled`              | `boolean('visual_testing_enabled').default(false)`                                                                    |
| `pageLoadTimeout`                | `page_load_timeout`                   | `integer('page_load_timeout').default(30000)`                                                                         |
| `elementTimeout`                 | `element_timeout`                     | `integer('element_timeout').default(30000)`                                                                           |
| `onMajorStepFailure`             | `on_major_step_failure`               | `text('on_major_step_failure').default('abort_and_run_next_test_case')`                                               |
| `onAbortedTestCase`              | `on_aborted_test_case`                | `text('on_aborted_test_case').default('delete_cookies_and_reuse_session')`                                            |
| `onTestSuitePreRequisiteFailure` | `on_test_suite_pre_requisite_failure` | `text('on_test_suite_pre_requisite_failure').default( 'stop_execution', )`                                            |
| `onTestCasePreRequisiteFailure`  | `on_test_case_pre_requisite_failure`  | `text('on_test_case_pre_requisite_failure').default( 'stop_execution', )`                                             |
| `onTestStepPreRequisiteFailure`  | `on_test_step_pre_requisite_failure`  | `text('on_test_step_pre_requisite_failure').default( 'abort_and_run_next_test_case', )`                               |
| `reRunOnFailure`                 | `re_run_on_failure`                   | `text('re_run_on_failure').default('none')`                                                                           |
| `maxParallelTests`               | `max_parallel_tests`                  | `integer('max_parallel_tests').default(1).notNull()`                                                                  |
| `shards`                         | `shards`                              | `integer('shards').default(1).notNull()`                                                                              |
| `workerLossPolicy`               | `worker_loss_policy`                  | `text('worker_loss_policy') .$type<WorkerLossPolicy>() .default('indeterminate') .notNull()`                          |
| `locales`                        | `locales`                             | `jsonb('locales').$type<string[]>().notNull().default([])`                                                            |
| `issueTrackerId`                 | `issue_tracker_id`                    | `text('issue_tracker_id').references(() => issueTrackers.id, { onDelete: 'set null', })`                              |
| `testManagementId`               | `test_management_id`                  | `text('test_management_id').references( (): AnyPgColumn => testManagementConnections.id, { onDelete: 'set null' }, )` |
| `createIssuesOnFailure`          | `create_issues_on_failure`            | `boolean('create_issues_on_failure').default(false).notNull()`                                                        |
| `notificationSettings`           | `notification_settings`               | `jsonb('notification_settings')`                                                                                      |
| `createdAt`                      | `created_at`                          | `timestamp('created_at').defaultNow().notNull()`                                                                      |
| `updatedAt`                      | `updated_at`                          | `timestamp('updated_at').defaultNow().notNull()`                                                                      |

## test_plan_schedules {#test-plan-schedules}

`testPlanSchedules` — `shared/schema/execution.ts:140`

| Proprietà TS                 | Colonna SQL                    | Dichiarazione                                                                              |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `id`                         | `id`                           | `text('id').primaryKey()`                                                                  |
| `testPlanId`                 | `test_plan_id`                 | `text('test_plan_id') .notNull() .references(() => testPlans.id, { onDelete: 'cascade' })` |
| `organizationId`             | `organization_id`              | `integer('organization_id') .notNull() .references(() => organizations.id)`                |
| `userId`                     | `user_id`                      | `integer('user_id').references(() => users.id)`                                            |
| `scheduleName`               | `schedule_name`                | `text('schedule_name').notNull()`                                                          |
| `frequency`                  | `frequency`                    | `text('frequency').notNull()`                                                              |
| `nextRunAt`                  | `next_run_at`                  | `timestamp('next_run_at').notNull()`                                                       |
| `timezone`                   | `timezone`                     | `text('timezone').notNull().default('UTC')`                                                |
| `environment`                | `environment`                  | `text('environment')`                                                                      |
| `browsers`                   | `browsers`                     | `jsonb('browsers')`                                                                        |
| `notificationConfigOverride` | `notification_config_override` | `jsonb('notification_config_override')`                                                    |
| `executionParameters`        | `execution_parameters`         | `jsonb('execution_parameters')`                                                            |
| `isActive`                   | `is_active`                    | `boolean('is_active').default(true).notNull()`                                             |
| `retryOnFailure`             | `retry_on_failure`             | `text('retry_on_failure').default('none').notNull()`                                       |
| `createdAt`                  | `created_at`                   | `timestamp('created_at').defaultNow().notNull()`                                           |
| `updatedAt`                  | `updated_at`                   | `timestamp('updated_at')`                                                                  |

## test_plan_executions {#test-plan-executions}

`testPlanExecutions` — `shared/schema/execution.ts:183`

| Proprietà TS            | Colonna SQL               | Dichiarazione                                                                                    |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`                    | `id`                      | `text('id').primaryKey()`                                                                        |
| `scheduleId`            | `schedule_id`             | `text('schedule_id').references(() => testPlanSchedules.id, { onDelete: 'set null', })`          |
| `testPlanId`            | `test_plan_id`            | `text('test_plan_id') .notNull() .references(() => testPlans.id, { onDelete: 'cascade' })`       |
| `organizationId`        | `organization_id`         | `integer('organization_id') .notNull() .references(() => organizations.id)`                      |
| `requestedByUserId`     | `requested_by_user_id`    | `integer('requested_by_user_id').references(() => users.id, { onDelete: 'set null', })`          |
| `status`                | `status`                  | `text('status').notNull().default('queued')`                                                     |
| `results`               | `results`                 | `jsonb('results')`                                                                               |
| `queuedAt`              | `queued_at`               | `timestamp('queued_at').notNull().defaultNow()`                                                  |
| `startedAt`             | `started_at`              | `timestamp('started_at')`                                                                        |
| `completedAt`           | `completed_at`            | `timestamp('completed_at')`                                                                      |
| `cancelRequestedAt`     | `cancel_requested_at`     | `timestamp('cancel_requested_at')`                                                               |
| `stopReason`            | `stop_reason`             | `text('stop_reason')`                                                                            |
| `heartbeatAt`           | `heartbeat_at`            | `timestamp('heartbeat_at')`                                                                      |
| `failureCode`           | `failure_code`            | `text('failure_code')`                                                                           |
| `failureMessage`        | `failure_message`         | `text('failure_message')`                                                                        |
| `configurationSnapshot` | `configuration_snapshot`  | `jsonb('configuration_snapshot').notNull().default({})`                                          |
| `idempotencyKey`        | `idempotency_key`         | `text('idempotency_key')`                                                                        |
| `attempt`               | `attempt`                 | `integer('attempt').notNull().default(1)`                                                        |
| `maxAttempts`           | `max_attempts`            | `integer('max_attempts').notNull().default(1)`                                                   |
| `retryOfExecutionId`    | `retry_of_execution_id`   | `text('retry_of_execution_id')`                                                                  |
| `artifactsPurgedAt`     | `artifacts_purged_at`     | `timestamp('artifacts_purged_at')`                                                               |
| `artifactStorageStatus` | `artifact_storage_status` | `text('artifact_storage_status').$type<'quota_exceeded' &#124; 'error'>()`                       |
| `quotaDeferReason`      | `quota_defer_reason`      | `text('quota_defer_reason').$type< 'execution_quota_exceeded' &#124; 'concurrent_run_quota' >()` |
| `quotaDeferUntil`       | `quota_defer_until`       | `timestamp('quota_defer_until')`                                                                 |
| `runnerId`              | `runner_id`               | `text('runner_id')`                                                                              |
| `ciContext`             | `ci_context`              | `jsonb('ci_context').$type<CiContext>()`                                                         |
| `environment`           | `environment`             | `text('environment')`                                                                            |
| `browsers`              | `browsers`                | `jsonb('browsers')`                                                                              |
| `triggeredBy`           | `triggered_by`            | `text('triggered_by').notNull().default('manual')`                                               |
| `totalTests`            | `total_tests`             | `integer('total_tests')`                                                                         |
| `passedTests`           | `passed_tests`            | `integer('passed_tests')`                                                                        |
| `failedTests`           | `failed_tests`            | `integer('failed_tests')`                                                                        |
| `skippedTests`          | `skipped_tests`           | `integer('skipped_tests')`                                                                       |
| `quarantinedFailures`   | `quarantined_failures`    | `integer('quarantined_failures').notNull().default(0)`                                           |
| `executionDurationMs`   | `execution_duration_ms`   | `integer('execution_duration_ms')`                                                               |

## execution_outbox {#execution-outbox}

`executionOutbox` — `shared/schema/execution.ts:270`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                          |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| `executionId`    | `execution_id`    | `text('execution_id') .primaryKey() .references(() => testPlanExecutions.id, { onDelete: 'cascade' })` |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`                            |
| `payload`        | `payload`         | `jsonb('payload').$type<Record<string, unknown>>().notNull()`                                          |
| `priority`       | `priority`        | `integer('priority').notNull().default(1)`                                                             |
| `runAt`          | `run_at`          | `timestamp('run_at').notNull().defaultNow()`                                                           |
| `availableAt`    | `available_at`    | `timestamp('available_at').notNull().defaultNow()`                                                     |
| `leaseUntil`     | `lease_until`     | `timestamp('lease_until')`                                                                             |
| `attempts`       | `attempts`        | `integer('attempts').notNull().default(0)`                                                             |
| `lastError`      | `last_error`      | `text('last_error')`                                                                                   |
| `createdAt`      | `created_at`      | `timestamp('created_at').notNull().defaultNow()`                                                       |

## report_test_case_results {#report-test-case-results}

`reportTestCaseResults` — `shared/schema/execution.ts:297`

| Proprietà TS          | Colonna SQL              | Dichiarazione                                                                                                 |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `id`                  | `id`                     | `text('id').primaryKey()`                                                                                     |
| `testPlanExecutionId` | `test_plan_execution_id` | `text('test_plan_execution_id') .notNull() .references(() => testPlanExecutions.id, { onDelete: 'cascade' })` |
| `organizationId`      | `organization_id`        | `integer('organization_id') .notNull() .references(() => organizations.id)`                                   |
| `uiTestId`            | `ui_test_id`             | `integer('ui_test_id').references(() => tests.id, { onDelete: 'set null' })`                                  |
| `apiTestId`           | `api_test_id`            | `integer('api_test_id').references(() => apiTests.id, { onDelete: 'set null' })`                              |
| `mobileTestId`        | `mobile_test_id`         | `integer('mobile_test_id')`                                                                                   |
| `testType`            | `test_type`              | `text('test_type').notNull()`                                                                                 |
| `testName`            | `test_name`              | `text('test_name').notNull()`                                                                                 |
| `browser`             | `browser`                | `text('browser')`                                                                                             |
| `testVersion`         | `test_version`           | `integer('test_version')`                                                                                     |
| `status`              | `status`                 | `text('status').notNull()`                                                                                    |
| `attempts`            | `attempts`               | `integer('attempts').notNull().default(1)`                                                                    |
| `quarantined`         | `quarantined`            | `boolean('quarantined').notNull().default(false)`                                                             |
| `reasonForFailure`    | `reason_for_failure`     | `text('reason_for_failure')`                                                                                  |
| `screenshotUrl`       | `screenshot_url`         | `text('screenshot_url')`                                                                                      |
| `videoUrl`            | `video_url`              | `text('video_url')`                                                                                           |
| `traceUrl`            | `trace_url`              | `text('trace_url')`                                                                                           |
| `harUrl`              | `har_url`                | `text('har_url')`                                                                                             |
| `networkSummary`      | `network_summary`        | `jsonb('network_summary').$type<NetworkSummary>()`                                                            |
| `aiAnalysis`          | `ai_analysis`            | `jsonb('ai_analysis').$type<FailureAnalysis>()`                                                               |
| `detailedLog`         | `detailed_log`           | `text('detailed_log')`                                                                                        |
| `startedAt`           | `started_at`             | `timestamp('started_at').notNull()`                                                                           |
| `completedAt`         | `completed_at`           | `timestamp('completed_at')`                                                                                   |
| `durationMs`          | `duration_ms`            | `integer('duration_ms')`                                                                                      |
| `module`              | `module`                 | `text('module')`                                                                                              |
| `featureArea`         | `feature_area`           | `text('feature_area')`                                                                                        |
| `scenario`            | `scenario`               | `text('scenario')`                                                                                            |
| `component`           | `component`              | `text('component')`                                                                                           |
| `priority`            | `priority`               | `text('priority')`                                                                                            |
| `severity`            | `severity`               | `text('severity')`                                                                                            |
| `executionUnitId`     | `execution_unit_id`      | `text('execution_unit_id')`                                                                                   |
| `unitAttempt`         | `unit_attempt`           | `integer('unit_attempt')`                                                                                     |

## execution_logs {#execution-logs}

`executionLogs` — `shared/schema/execution.ts:387`

| Proprietà TS          | Colonna SQL              | Dichiarazione                                                                                                 |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `id`                  | `id`                     | `serial('id').primaryKey()`                                                                                   |
| `testPlanExecutionId` | `test_plan_execution_id` | `text('test_plan_execution_id') .notNull() .references(() => testPlanExecutions.id, { onDelete: 'cascade' })` |
| `organizationId`      | `organization_id`        | `integer('organization_id') .notNull() .references(() => organizations.id)`                                   |
| `timestamp`           | `timestamp`              | `timestamp('timestamp').defaultNow().notNull()`                                                               |
| `level`               | `level`                  | `text('level').notNull()`                                                                                     |
| `source`              | `source`                 | `text('source').notNull()`                                                                                    |
| `message`             | `message`                | `text('message').notNull()`                                                                                   |
| `metadata`            | `metadata`               | `jsonb('metadata')`                                                                                           |
| `testCaseResultId`    | `test_case_result_id`    | `text('test_case_result_id')`                                                                                 |
| `correlationId`       | `correlation_id`         | `text('correlation_id')`                                                                                      |

## test_plan_webhooks {#test-plan-webhooks}

`testPlanWebhooks` — `shared/schema/execution.ts:412`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                              |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `id`             | `id`              | `serial('id').primaryKey()`                                                                |
| `testPlanId`     | `test_plan_id`    | `text('test_plan_id') .notNull() .references(() => testPlans.id, { onDelete: 'cascade' })` |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`                |
| `tokenHash`      | `token_hash`      | `text('token_hash').notNull().unique()`                                                    |
| `tokenPrefix`    | `token_prefix`    | `text('token_prefix').notNull()`                                                           |
| `name`           | `name`            | `text('name').notNull()`                                                                   |
| `createdAt`      | `created_at`      | `timestamp('created_at').notNull().defaultNow()`                                           |
| `lastUsedAt`     | `last_used_at`    | `timestamp('last_used_at')`                                                                |

## test_plan_selected_tests {#test-plan-selected-tests}

`testPlanSelectedTests` — `shared/schema/execution.ts:439`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                              |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `id`             | `id`              | `serial('id').primaryKey()`                                                                |
| `testPlanId`     | `test_plan_id`    | `text('test_plan_id') .notNull() .references(() => testPlans.id, { onDelete: 'cascade' })` |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`                |
| `testId`         | `test_id`         | `integer('test_id').references(() => tests.id, { onDelete: 'cascade' })`                   |
| `apiTestId`      | `api_test_id`     | `integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' })`            |
| `mobileTestId`   | `mobile_test_id`  | `integer('mobile_test_id')`                                                                |
| `testType`       | `test_type`       | `text('test_type').notNull()`                                                              |

## run_work_items {#run-work-items}

`runWorkItems` — `shared/schema/execution.ts:468`

| Proprietà TS     | Colonna SQL        | Dichiarazione                                                                                       |
| ---------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `executionId`    | `execution_id`     | `text('execution_id') .notNull() .references(() => testPlanExecutions.id, { onDelete: 'cascade' })` |
| `organizationId` | `organization_id`  | `integer('organization_id') .notNull() .references(() => organizations.id)`                         |
| `key`            | `key`              | `text('key').notNull()`                                                                             |
| `position`       | `position`         | `integer('position').notNull()`                                                                     |
| `unit`           | `unit`             | `jsonb('unit').notNull()`                                                                           |
| `state`          | `state`            | `text('state').$type<WorkItemState>().notNull().default('pending')`                                 |
| `claimedBy`      | `claimed_by`       | `text('claimed_by')`                                                                                |
| `epoch`          | `epoch`            | `integer('epoch').notNull().default(0)`                                                             |
| `leaseExpiresAt` | `lease_expires_at` | `timestamp('lease_expires_at')`                                                                     |
| `heartbeatAt`    | `heartbeat_at`     | `timestamp('heartbeat_at')`                                                                         |
| `finishedAt`     | `finished_at`      | `timestamp('finished_at')`                                                                          |
| `error`          | `error`            | `text('error')`                                                                                     |
| `results`        | `results`          | `jsonb('results')`                                                                                  |

## execution_units {#execution-units}

`executionUnits` — `shared/schema/execution.ts:504`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                       |
| ---------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `executionId`    | `execution_id`    | `text('execution_id') .notNull() .references(() => testPlanExecutions.id, { onDelete: 'cascade' })` |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`                         |
| `unitId`         | `unit_id`         | `text('unit_id').notNull()`                                                                         |
| `position`       | `position`        | `integer('position').notNull()`                                                                     |
| `coordinates`    | `coordinates`     | `jsonb('coordinates').$type<UnitCoordinates>().notNull()`                                           |
| `state`          | `state`           | `text('state').$type<ExecutionUnitState>().notNull().default('planned')`                            |
| `reason`         | `reason`          | `text('reason')`                                                                                    |
| `createdAt`      | `created_at`      | `timestamp('created_at').notNull().defaultNow()`                                                    |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').notNull().defaultNow()`                                                    |

## execution_unit_attempts {#execution-unit-attempts}

`executionUnitAttempts` — `shared/schema/execution.ts:532`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                               |
| ---------------- | ----------------- | --------------------------------------------------------------------------- |
| `executionId`    | `execution_id`    | `text('execution_id').notNull()`                                            |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)` |
| `unitId`         | `unit_id`         | `text('unit_id').notNull()`                                                 |
| `attempt`        | `attempt`         | `integer('attempt').notNull()`                                              |
| `state`          | `state`           | `text('state').$type<AttemptState>().notNull().default('running')`          |
| `claimEpoch`     | `claim_epoch`     | `integer('claim_epoch')`                                                    |
| `status`         | `status`          | `text('status')`                                                            |
| `failureReason`  | `failure_reason`  | `text('failure_reason')`                                                    |
| `evidence`       | `evidence`        | `jsonb('evidence').$type<AttemptEvidenceRecord>()`                          |
| `worker`         | `worker`          | `text('worker')`                                                            |
| `startedAt`      | `started_at`      | `timestamp('started_at').notNull().defaultNow()`                            |
| `finishedAt`     | `finished_at`     | `timestamp('finished_at')`                                                  |

## impact_rules {#impact-rules}

`impactRules` — `shared/schema/execution.ts:566`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                               |
| ---------------- | ----------------- | --------------------------------------------------------------------------- |
| `id`             | `id`              | `text('id').primaryKey()`                                                   |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)` |
| `pattern`        | `pattern`         | `text('pattern').notNull()`                                                 |
| `tagId`          | `tag_id`          | `text('tag_id').references(() => tags.id, { onDelete: 'cascade' })`         |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                            |

## test_suites {#test-suites}

`testSuites` — `shared/schema/execution.ts:589`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                   |
| ---------------- | ----------------- | ------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                     |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`     |
| `projectId`      | `project_id`      | `integer('project_id').references(() => projects.id, { onDelete: 'set null' })` |
| `name`           | `name`            | `text('name').notNull()`                                                        |
| `description`    | `description`     | `text('description')`                                                           |
| `kind`           | `kind`            | `text('kind').$type<TestSuiteKind>().notNull().default('static')`               |
| `tagIds`         | `tag_ids`         | `jsonb('tag_ids').$type<string[]>().notNull().default([])`                      |
| `createdBy`      | `created_by`      | `integer('created_by').references(() => users.id, { onDelete: 'set null' })`    |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').defaultNow().notNull()`                                |

## test_suite_items {#test-suite-items}

`testSuiteItems` — `shared/schema/execution.ts:612`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                              |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `id`             | `id`              | `serial('id').primaryKey()`                                                                |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`                |
| `suiteId`        | `suite_id`        | `integer('suite_id') .notNull() .references(() => testSuites.id, { onDelete: 'cascade' })` |
| `testType`       | `test_type`       | `text('test_type').$type<'ui' &#124; 'api' &#124; 'mobile'>().notNull()`                   |
| `testId`         | `test_id`         | `integer('test_id').references(() => tests.id, { onDelete: 'cascade' })`                   |
| `apiTestId`      | `api_test_id`     | `integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' })`            |
| `mobileTestId`   | `mobile_test_id`  | `integer('mobile_test_id')`                                                                |
| `position`       | `position`        | `integer('position').notNull()`                                                            |

## test_plan_suites {#test-plan-suites}

`testPlanSuites` — `shared/schema/execution.ts:633`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                              |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `testPlanId`     | `test_plan_id`    | `text('test_plan_id') .notNull() .references(() => testPlans.id, { onDelete: 'cascade' })` |
| `suiteId`        | `suite_id`        | `integer('suite_id') .notNull() .references(() => testSuites.id, { onDelete: 'cascade' })` |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`                |
| `position`       | `position`        | `integer('position').notNull()`                                                            |

## test_quarantines {#test-quarantines}

`testQuarantines` — `shared/schema/execution.ts:658`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                    |
| ---------------- | ----------------- | -------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                      |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`      |
| `testType`       | `test_type`       | `text('test_type').$type<'ui' &#124; 'api' &#124; 'mobile'>().notNull()`         |
| `testId`         | `test_id`         | `integer('test_id').references(() => tests.id, { onDelete: 'cascade' })`         |
| `apiTestId`      | `api_test_id`     | `integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' })`  |
| `mobileTestId`   | `mobile_test_id`  | `integer('mobile_test_id')`                                                      |
| `reason`         | `reason`          | `text('reason').notNull()`                                                       |
| `quarantinedBy`  | `quarantined_by`  | `integer('quarantined_by').references(() => users.id, { onDelete: 'set null' })` |
| `quarantinedAt`  | `quarantined_at`  | `timestamp('quarantined_at').defaultNow().notNull()`                             |
| `releasedBy`     | `released_by`     | `integer('released_by').references(() => users.id, { onDelete: 'set null' })`    |
| `releasedAt`     | `released_at`     | `timestamp('released_at')`                                                       |
| `releaseNote`    | `release_note`    | `text('release_note')`                                                           |

## mobile_test_runs {#mobile-test-runs}

`mobileTestRuns` — `shared/schema/execution.ts:684`

| Proprietà TS            | Colonna SQL               | Dichiarazione                                                                                     |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| `id`                    | `id`                      | `text('id').primaryKey()`                                                                         |
| `organizationId`        | `organization_id`         | `integer('organization_id') .notNull() .references(() => organizations.id)`                       |
| `mobileTestId`          | `mobile_test_id`          | `integer('mobile_test_id') .notNull() .references(() => mobileTests.id, { onDelete: 'cascade' })` |
| `gridId`                | `grid_id`                 | `text('grid_id').references(() => browserGrids.id, { onDelete: 'set null' })`                     |
| `environmentId`         | `environment_id`          | `integer('environment_id').references(() => environments.id, { onDelete: 'set null', })`          |
| `testVersion`           | `test_version`            | `integer('test_version')`                                                                         |
| `testSnapshot`          | `test_snapshot`           | `jsonb('test_snapshot').$type<Record<string, unknown>>()`                                         |
| `status`                | `status`                  | `text('status').$type<MobileRunStatus>().notNull()`                                               |
| `device`                | `device`                  | `text('device').notNull()`                                                                        |
| `steps`                 | `steps`                   | `jsonb('steps').$type<MobileStepResult[]>().notNull().default([])`                                |
| `error`                 | `error`                   | `text('error')`                                                                                   |
| `screenshot`            | `screenshot`              | `text('screenshot')`                                                                              |
| `artifactStorageStatus` | `artifact_storage_status` | `text('artifact_storage_status').$type<'quota_exceeded' &#124; 'error'>()`                        |
| `sessionUrl`            | `session_url`             | `text('session_url')`                                                                             |
| `requestedBy`           | `requested_by`            | `integer('requested_by').references(() => users.id, { onDelete: 'set null' })`                    |
| `startedAt`             | `started_at`              | `timestamp('started_at')`                                                                         |
| `finishedAt`            | `finished_at`             | `timestamp('finished_at')`                                                                        |
| `createdAt`             | `created_at`              | `timestamp('created_at').defaultNow().notNull()`                                                  |

## load_test_runs {#load-test-runs}

`loadTestRuns` — `shared/schema/execution.ts:718`

| Proprietà TS      | Colonna SQL        | Dichiarazione                                                                                 |
| ----------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| `id`              | `id`               | `text('id').primaryKey()`                                                                     |
| `organizationId`  | `organization_id`  | `integer('organization_id') .notNull() .references(() => organizations.id)`                   |
| `loadTestId`      | `load_test_id`     | `integer('load_test_id') .notNull() .references(() => loadTests.id, { onDelete: 'cascade' })` |
| `projectId`       | `project_id`       | `integer('project_id').references(() => projects.id, { onDelete: 'set null' })`               |
| `environmentId`   | `environment_id`   | `integer('environment_id').references(() => environments.id, { onDelete: 'set null', })`      |
| `status`          | `status`           | `text('status').$type<LoadRunStatus>().notNull()`                                             |
| `definition`      | `definition`       | `jsonb('definition').$type<Record<string, unknown>>().notNull()`                              |
| `summary`         | `summary`          | `jsonb('summary').$type<LoadSummary>()`                                                       |
| `error`           | `error`            | `text('error')`                                                                               |
| `cancelRequested` | `cancel_requested` | `boolean('cancel_requested').notNull().default(false)`                                        |
| `heartbeatAt`     | `heartbeat_at`     | `timestamp('heartbeat_at')`                                                                   |
| `jobId`           | `job_id`           | `text('job_id')`                                                                              |
| `workerId`        | `worker_id`        | `text('worker_id')`                                                                           |
| `queuedAt`        | `queued_at`        | `timestamp('queued_at')`                                                                      |
| `requestedBy`     | `requested_by`     | `integer('requested_by').references(() => users.id, { onDelete: 'set null' })`                |
| `startedAt`       | `started_at`       | `timestamp('started_at').defaultNow().notNull()`                                              |
| `finishedAt`      | `finished_at`      | `timestamp('finished_at')`                                                                    |

## runners {#runners}

`runners` — `shared/schema/environments.ts:10`

| Proprietà TS             | Colonna SQL                | Dichiarazione                                                                        |
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

## environments {#environments}

`environments` — `shared/schema/environments.ts:33`

| Proprietà TS           | Colonna SQL               | Dichiarazione                                                               |
| ---------------------- | ------------------------- | --------------------------------------------------------------------------- |
| `id`                   | `id`                      | `serial('id').primaryKey()`                                                 |
| `name`                 | `name`                    | `text('name').notNull()`                                                    |
| `description`          | `description`             | `text('description')`                                                       |
| `userId`               | `user_id`                 | `integer('user_id') .notNull() .references(() => users.id)`                 |
| `organizationId`       | `organization_id`         | `integer('organization_id') .notNull() .references(() => organizations.id)` |
| `createdAt`            | `created_at`              | `timestamp('created_at').notNull().defaultNow()`                            |
| `loginState`           | `login_state`             | `text('login_state')`                                                       |
| `loginStateIv`         | `login_state_iv`          | `text('login_state_iv')`                                                    |
| `loginStateAuthTag`    | `login_state_auth_tag`    | `text('login_state_auth_tag')`                                              |
| `loginStateCapturedAt` | `login_state_captured_at` | `timestamp('login_state_captured_at')`                                      |

## secrets {#secrets}

`secrets` — `shared/schema/environments.ts:69`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                      |
| ---------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                                        |
| `environmentId`  | `environment_id`  | `integer('environment_id') .notNull() .references(() => environments.id, { onDelete: 'cascade' })` |
| `keyName`        | `key_name`        | `text('key_name').notNull()`                                                                       |
| `encryptedValue` | `encrypted_value` | `text('encrypted_value').notNull()`                                                                |
| `iv`             | `iv`              | `text('iv').notNull()`                                                                             |
| `authTag`        | `auth_tag`        | `text('auth_tag').notNull()`                                                                       |
| `userId`         | `user_id`         | `integer('user_id') .notNull() .references(() => users.id)`                                        |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`                        |
| `createdAt`      | `created_at`      | `timestamp('created_at').notNull().defaultNow()`                                                   |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').notNull().defaultNow()`                                                   |

## sms_messages {#sms-messages}

`smsMessages` — `shared/schema/environments.ts:97`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                               |
| ---------------- | ----------------- | --------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                 |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)` |
| `toNumber`       | `to_number`       | `text('to_number').notNull()`                                               |
| `fromNumber`     | `from_number`     | `text('from_number')`                                                       |
| `body`           | `body`            | `text('body').notNull()`                                                    |
| `provider`       | `provider`        | `text('provider')`                                                          |
| `receivedAt`     | `received_at`     | `timestamp('received_at').defaultNow().notNull()`                           |

## agents {#agents}

`agents` — `shared/schema/environments.ts:126`

| Proprietà TS        | Colonna SQL          | Dichiarazione                                                                |
| ------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `id`                | `id`                 | `text('id').primaryKey()`                                                    |
| `organizationId`    | `organization_id`    | `integer('organization_id') .notNull() .references(() => organizations.id)`  |
| `name`              | `name`               | `text('name').notNull()`                                                     |
| `pool`              | `pool`               | `text('pool').notNull().default('default')`                                  |
| `tokenPrefix`       | `token_prefix`       | `text('token_prefix').notNull()`                                             |
| `tokenHash`         | `token_hash`         | `text('token_hash').notNull().unique()`                                      |
| `createdBy`         | `created_by`         | `integer('created_by').references(() => users.id, { onDelete: 'set null' })` |
| `createdAt`         | `created_at`         | `timestamp('created_at').defaultNow().notNull()`                             |
| `lastSeenAt`        | `last_seen_at`       | `timestamp('last_seen_at')`                                                  |
| `hostname`          | `hostname`           | `text('hostname')`                                                           |
| `agentVersion`      | `agent_version`      | `text('agent_version')`                                                      |
| `playwrightVersion` | `playwright_version` | `text('playwright_version')`                                                 |
| `browsers`          | `browsers`           | `jsonb('browsers').$type<string[]>()`                                        |
| `bddProfiles`       | `bdd_profiles`       | `jsonb('bdd_profiles').$type<BddAgentProfile[]>()`                           |
| `revokedAt`         | `revoked_at`         | `timestamp('revoked_at')`                                                    |

## bdd_execution_profiles {#bdd-execution-profiles}

`bddExecutionProfiles` — `shared/schema/environments.ts:155`

| Proprietà TS        | Colonna SQL           | Dichiarazione                                                                                        |
| ------------------- | --------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                | `id`                  | `text('id').primaryKey()`                                                                            |
| `organizationId`    | `organization_id`     | `integer('organization_id') .notNull() .references(() => organizations.id, { onDelete: 'cascade' })` |
| `projectId`         | `project_id`          | `integer('project_id').references(() => projects.id, { onDelete: 'cascade' })`                       |
| `name`              | `name`                | `text('name').notNull()`                                                                             |
| `pool`              | `pool`                | `text('pool').notNull()`                                                                             |
| `operatorProfileId` | `operator_profile_id` | `text('operator_profile_id').notNull()`                                                              |
| `revision`          | `revision`            | `text('revision').notNull()`                                                                         |
| `timeoutMs`         | `timeout_ms`          | `integer('timeout_ms').notNull().default(60000)`                                                     |
| `createdAt`         | `created_at`          | `timestamp('created_at').defaultNow().notNull()`                                                     |
| `updatedAt`         | `updated_at`          | `timestamp('updated_at').defaultNow().notNull()`                                                     |

## browser_grids {#browser-grids}

`browserGrids` — `shared/schema/environments.ts:180`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                |
| ---------------- | ----------------- | ---------------------------------------------------------------------------- |
| `id`             | `id`              | `text('id').primaryKey()`                                                    |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`  |
| `name`           | `name`            | `text('name').notNull()`                                                     |
| `provider`       | `provider`        | `text('provider').notNull()`                                                 |
| `username`       | `username`        | `text('username')`                                                           |
| `endpoint`       | `endpoint`        | `text('endpoint')`                                                           |
| `encryptedKey`   | `encrypted_key`   | `text('encrypted_key')`                                                      |
| `keyIv`          | `key_iv`          | `text('key_iv')`                                                             |
| `keyAuthTag`     | `key_auth_tag`    | `text('key_auth_tag')`                                                       |
| `agentPool`      | `agent_pool`      | `text('agent_pool')`                                                         |
| `createdBy`      | `created_by`      | `integer('created_by').references(() => users.id, { onDelete: 'set null' })` |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                             |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').defaultNow().notNull()`                             |

## source_hosts {#source-hosts}

`sourceHosts` — `shared/schema/integrations.ts:31`

| Proprietà TS        | Colonna SQL           | Dichiarazione                                                                |
| ------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `id`                | `id`                  | `text('id').primaryKey()`                                                    |
| `organizationId`    | `organization_id`     | `integer('organization_id') .notNull() .references(() => organizations.id)`  |
| `provider`          | `provider`            | `text('provider').$type<SourceHostProvider>().notNull()`                     |
| `apiUrl`            | `api_url`             | `text('api_url').notNull()`                                                  |
| `encryptedToken`    | `encrypted_token`     | `text('encrypted_token').notNull()`                                          |
| `tokenIv`           | `token_iv`            | `text('token_iv').notNull()`                                                 |
| `tokenAuthTag`      | `token_auth_tag`      | `text('token_auth_tag').notNull()`                                           |
| `createdBy`         | `created_by`          | `integer('created_by').references(() => users.id, { onDelete: 'set null' })` |
| `createdAt`         | `created_at`          | `timestamp('created_at').defaultNow().notNull()`                             |
| `updatedAt`         | `updated_at`          | `timestamp('updated_at').defaultNow().notNull()`                             |
| `lastDeliveryAt`    | `last_delivery_at`    | `timestamp('last_delivery_at')`                                              |
| `lastDeliveryError` | `last_delivery_error` | `text('last_delivery_error')`                                                |

## issue_trackers {#issue-trackers}

`issueTrackers` — `shared/schema/integrations.ts:72`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                |
| ---------------- | ----------------- | ---------------------------------------------------------------------------- |
| `id`             | `id`              | `text('id').primaryKey()`                                                    |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`  |
| `name`           | `name`            | `text('name').notNull()`                                                     |
| `provider`       | `provider`        | `text('provider').notNull()`                                                 |
| `baseUrl`        | `base_url`        | `text('base_url').notNull()`                                                 |
| `projectKey`     | `project_key`     | `text('project_key').notNull()`                                              |
| `issueType`      | `issue_type`      | `text('issue_type').default('Bug').notNull()`                                |
| `userEmail`      | `user_email`      | `text('user_email')`                                                         |
| `encryptedToken` | `encrypted_token` | `text('encrypted_token').notNull()`                                          |
| `tokenIv`        | `token_iv`        | `text('token_iv').notNull()`                                                 |
| `tokenAuthTag`   | `token_auth_tag`  | `text('token_auth_tag').notNull()`                                           |
| `createdBy`      | `created_by`      | `integer('created_by').references(() => users.id, { onDelete: 'set null' })` |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                             |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').defaultNow().notNull()`                             |

## requirements {#requirements}

`requirements` — `shared/schema/integrations.ts:102`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                    |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `id`             | `id`              | `serial('id').primaryKey()`                                                                      |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`                      |
| `key`            | `key`             | `text('key').notNull()`                                                                          |
| `title`          | `title`           | `text('title').notNull()`                                                                        |
| `description`    | `description`     | `text('description')`                                                                            |
| `kind`           | `kind`            | `text('kind').$type<RequirementKind>().notNull().default('story')`                               |
| `parentId`       | `parent_id`       | `integer('parent_id').references((): AnyPgColumn => requirements.id, { onDelete: 'set null', })` |
| `trackerId`      | `tracker_id`      | `text('tracker_id').references(() => issueTrackers.id, { onDelete: 'set null' })`                |
| `url`            | `url`             | `text('url')`                                                                                    |
| `externalType`   | `external_type`   | `text('external_type')`                                                                          |
| `externalStatus` | `external_status` | `text('external_status')`                                                                        |
| `syncedAt`       | `synced_at`       | `timestamp('synced_at')`                                                                         |
| `createdBy`      | `created_by`      | `integer('created_by').references(() => users.id, { onDelete: 'set null' })`                     |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                                 |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').defaultNow().notNull()`                                                 |

## test_management_connections {#test-management-connections}

`testManagementConnections` — `shared/schema/integrations.ts:138`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                |
| ---------------- | ----------------- | ---------------------------------------------------------------------------- |
| `id`             | `id`              | `text('id').primaryKey()`                                                    |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`  |
| `name`           | `name`            | `text('name').notNull()`                                                     |
| `provider`       | `provider`        | `text('provider').$type<TestManagementProvider>().notNull()`                 |
| `baseUrl`        | `base_url`        | `text('base_url').notNull()`                                                 |
| `username`       | `username`        | `text('username')`                                                           |
| `projectKey`     | `project_key`     | `text('project_key').notNull()`                                              |
| `suiteId`        | `suite_id`        | `text('suite_id')`                                                           |
| `testPlanKey`    | `test_plan_key`   | `text('test_plan_key')`                                                      |
| `encryptedToken` | `encrypted_token` | `text('encrypted_token').notNull()`                                          |
| `tokenIv`        | `token_iv`        | `text('token_iv').notNull()`                                                 |
| `tokenAuthTag`   | `token_auth_tag`  | `text('token_auth_tag').notNull()`                                           |
| `createdBy`      | `created_by`      | `integer('created_by').references(() => users.id, { onDelete: 'set null' })` |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                             |
| `updatedAt`      | `updated_at`      | `timestamp('updated_at').defaultNow().notNull()`                             |

## test_case_links {#test-case-links}

`testCaseLinks` — `shared/schema/integrations.ts:165`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                               |
| ---------------- | ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                                                 |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`                                 |
| `connectionId`   | `connection_id`   | `text('connection_id') .notNull() .references(() => testManagementConnections.id, { onDelete: 'cascade' })` |
| `testType`       | `test_type`       | `text('test_type').$type<'ui' &#124; 'api' &#124; 'mobile'>().notNull()`                                    |
| `testId`         | `test_id`         | `integer('test_id').references(() => tests.id, { onDelete: 'cascade' })`                                    |
| `apiTestId`      | `api_test_id`     | `integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' })`                             |
| `mobileTestId`   | `mobile_test_id`  | `integer('mobile_test_id')`                                                                                 |
| `caseKey`        | `case_key`        | `text('case_key').notNull()`                                                                                |
| `createdBy`      | `created_by`      | `integer('created_by').references(() => users.id, { onDelete: 'set null' })`                                |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                                            |

## test_management_publications {#test-management-publications}

`testManagementPublications` — `shared/schema/integrations.ts:188`

| Proprietà TS          | Colonna SQL              | Dichiarazione                                                                                                  |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `id`                  | `id`                     | `serial('id').primaryKey()`                                                                                    |
| `organizationId`      | `organization_id`        | `integer('organization_id') .notNull() .references(() => organizations.id)`                                    |
| `testPlanExecutionId` | `test_plan_execution_id` | `text('test_plan_execution_id') .notNull() .references(() => testPlanExecutions.id, { onDelete: 'cascade' })`  |
| `connectionId`        | `connection_id`          | `text('connection_id').references(() => testManagementConnections.id, { onDelete: 'set null', })`              |
| `connectionName`      | `connection_name`        | `text('connection_name').notNull()`                                                                            |
| `provider`            | `provider`               | `text('provider').notNull()`                                                                                   |
| `status`              | `status`                 | `text('status') .$type<'published' &#124; 'partial' &#124; 'failed' &#124; 'nothing_to_publish'>() .notNull()` |
| `externalKey`         | `external_key`           | `text('external_key')`                                                                                         |
| `externalUrl`         | `external_url`           | `text('external_url')`                                                                                         |
| `publishedCount`      | `published_count`        | `integer('published_count').notNull().default(0)`                                                              |
| `unmappedCount`       | `unmapped_count`         | `integer('unmapped_count').notNull().default(0)`                                                               |
| `message`             | `message`                | `text('message')`                                                                                              |
| `requestedBy`         | `requested_by`           | `integer('requested_by').references(() => users.id, { onDelete: 'set null' })`                                 |
| `createdAt`           | `created_at`             | `timestamp('created_at').defaultNow().notNull()`                                                               |

## requirement_tests {#requirement-tests}

`requirementTests` — `shared/schema/integrations.ts:220`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                                      |
| ---------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                                        |
| `organizationId` | `organization_id` | `integer('organization_id') .notNull() .references(() => organizations.id)`                        |
| `requirementId`  | `requirement_id`  | `integer('requirement_id') .notNull() .references(() => requirements.id, { onDelete: 'cascade' })` |
| `testType`       | `test_type`       | `text('test_type').$type<'ui' &#124; 'api' &#124; 'mobile'>().notNull()`                           |
| `testId`         | `test_id`         | `integer('test_id').references(() => tests.id, { onDelete: 'cascade' })`                           |
| `apiTestId`      | `api_test_id`     | `integer('api_test_id').references(() => apiTests.id, { onDelete: 'cascade' })`                    |
| `mobileTestId`   | `mobile_test_id`  | `integer('mobile_test_id').references(() => mobileTests.id, { onDelete: 'cascade', })`             |
| `createdBy`      | `created_by`      | `integer('created_by').references(() => users.id, { onDelete: 'set null' })`                       |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                                   |

## issue_links {#issue-links}

`issueLinks` — `shared/schema/integrations.ts:261`

| Proprietà TS       | Colonna SQL          | Dichiarazione                                                                                   |
| ------------------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| `id`               | `id`                 | `serial('id').primaryKey()`                                                                     |
| `organizationId`   | `organization_id`    | `integer('organization_id') .notNull() .references(() => organizations.id)`                     |
| `trackerId`        | `tracker_id`         | `text('tracker_id') .notNull() .references(() => issueTrackers.id, { onDelete: 'cascade' })`    |
| `dedupeKey`        | `dedupe_key`         | `text('dedupe_key').notNull()`                                                                  |
| `testPlanId`       | `test_plan_id`       | `text('test_plan_id').references(() => testPlans.id, { onDelete: 'set null' })`                 |
| `uiTestId`         | `ui_test_id`         | `integer('ui_test_id').references(() => tests.id, { onDelete: 'set null' })`                    |
| `testName`         | `test_name`          | `text('test_name').notNull()`                                                                   |
| `browser`          | `browser`            | `text('browser')`                                                                               |
| `issueKey`         | `issue_key`          | `text('issue_key').notNull()`                                                                   |
| `issueUrl`         | `issue_url`          | `text('issue_url').notNull()`                                                                   |
| `firstExecutionId` | `first_execution_id` | `text('first_execution_id').references(() => testPlanExecutions.id, { onDelete: 'set null', })` |
| `lastExecutionId`  | `last_execution_id`  | `text('last_execution_id').references(() => testPlanExecutions.id, { onDelete: 'set null', })`  |
| `occurrences`      | `occurrences`        | `integer('occurrences').default(1).notNull()`                                                   |
| `resolvedAt`       | `resolved_at`        | `timestamp('resolved_at')`                                                                      |
| `createdAt`        | `created_at`         | `timestamp('created_at').defaultNow().notNull()`                                                |
| `updatedAt`        | `updated_at`         | `timestamp('updated_at').defaultNow().notNull()`                                                |

## billing_plans {#billing-plans}

`billingPlans` — `shared/schema/billing.ts:23`

| Proprietà TS                 | Colonna SQL                     | Dichiarazione                                                                                            |
| ---------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `id`                         | `id`                            | `serial('id').primaryKey()`                                                                              |
| `code`                       | `code`                          | `text('code').notNull().unique()`                                                                        |
| `name`                       | `name`                          | `text('name').notNull()`                                                                                 |
| `priceMonthMinor`            | `price_month_minor`             | `bigint('price_month_minor', { mode: 'number' }).notNull().default(0)`                                   |
| `priceYearMinor`             | `price_year_minor`              | `bigint('price_year_minor', { mode: 'number' }).notNull().default(0)`                                    |
| `currency`                   | `currency`                      | `text('currency').notNull().default('eur')`                                                              |
| `trialDays`                  | `trial_days`                    | `integer('trial_days').notNull().default(0)`                                                             |
| `active`                     | `active`                        | `boolean('active').notNull().default(true)`                                                              |
| `maxConcurrentRuns`          | `max_concurrent_runs`           | `integer('max_concurrent_runs')`                                                                         |
| `maxQueuedRuns`              | `max_queued_runs`               | `integer('max_queued_runs')`                                                                             |
| `maxTests`                   | `max_tests`                     | `bigint('max_tests', { mode: 'number' })`                                                                |
| `maxArtifactBytes`           | `max_artifact_bytes`            | `bigint('max_artifact_bytes', { mode: 'number' })`                                                       |
| `maxMonthlyExecutionMinutes` | `max_monthly_execution_minutes` | `bigint('max_monthly_execution_minutes', { mode: 'number' })`                                            |
| `providerPriceIds`           | `provider_price_ids`            | `jsonb('provider_price_ids') .$type<Partial<Record<BillingInterval, string>>>() .notNull() .default({})` |
| `createdAt`                  | `created_at`                    | `timestamp('created_at').defaultNow().notNull()`                                                         |
| `updatedAt`                  | `updated_at`                    | `timestamp('updated_at').defaultNow().notNull()`                                                         |

## organization_subscriptions {#organization-subscriptions}

`organizationSubscriptions` — `shared/schema/billing.ts:52`

| Proprietà TS             | Colonna SQL                | Dichiarazione                                                                                        |
| ------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                     | `id`                       | `serial('id').primaryKey()`                                                                          |
| `organizationId`         | `organization_id`          | `integer('organization_id') .notNull() .references(() => organizations.id, { onDelete: 'cascade' })` |
| `planCode`               | `plan_code`                | `text('plan_code') .notNull() .references(() => billingPlans.code)`                                  |
| `status`                 | `status`                   | `text('status').$type<SubscriptionStatus>().notNull().default('active')`                             |
| `interval`               | `interval`                 | `text('interval').$type<BillingInterval>()`                                                          |
| `currentPeriodStart`     | `current_period_start`     | `timestamp('current_period_start')`                                                                  |
| `currentPeriodEnd`       | `current_period_end`       | `timestamp('current_period_end')`                                                                    |
| `trialEndsAt`            | `trial_ends_at`            | `timestamp('trial_ends_at')`                                                                         |
| `pastDueSince`           | `past_due_since`           | `timestamp('past_due_since')`                                                                        |
| `provider`               | `provider`                 | `text('provider').$type<BillingProviderName &#124; 'manual'>().notNull().default('manual')`          |
| `providerCustomerId`     | `provider_customer_id`     | `text('provider_customer_id')`                                                                       |
| `providerSubscriptionId` | `provider_subscription_id` | `text('provider_subscription_id')`                                                                   |
| `suspendedReason`        | `suspended_reason`         | `text('suspended_reason')`                                                                           |
| `createdAt`              | `created_at`               | `timestamp('created_at').defaultNow().notNull()`                                                     |
| `updatedAt`              | `updated_at`               | `timestamp('updated_at').defaultNow().notNull()`                                                     |

## billing_events {#billing-events}

`billingEvents` — `shared/schema/billing.ts:86`

| Proprietà TS     | Colonna SQL       | Dichiarazione                                                                             |
| ---------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `id`             | `id`              | `serial('id').primaryKey()`                                                               |
| `organizationId` | `organization_id` | `integer('organization_id').references(() => organizations.id, { onDelete: 'cascade', })` |
| `idempotencyKey` | `idempotency_key` | `text('idempotency_key').notNull().unique()`                                              |
| `source`         | `source`          | `text('source').notNull()`                                                                |
| `provider`       | `provider`        | `text('provider').notNull()`                                                              |
| `type`           | `type`            | `text('type').notNull()`                                                                  |
| `actor`          | `actor`           | `text('actor')`                                                                           |
| `payload`        | `payload`         | `jsonb('payload').$type<Record<string, unknown>>().notNull().default({})`                 |
| `createdAt`      | `created_at`      | `timestamp('created_at').defaultNow().notNull()`                                          |

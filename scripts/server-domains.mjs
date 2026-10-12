/**
 * Which domain every server module belongs to, and which domains it may import.
 *
 * server/ grew as a flat directory of ~190 modules, so nothing said that the billing code must not
 * reach into the plan runner, and import cycles between areas appeared without anyone deciding
 * them. Each domain here has a rank: a module may import its own domain and any domain of a LOWER
 * rank. Domains of the same rank are peers that must not import each other (the four test types).
 * Ranks only go up, so the domains cannot form a cycle.
 *
 * `.dependency-cruiser.mjs` turns this table into rules (`npm run deps:check`, run in CI), and
 * server/tests/domains.test.ts fails when a server module is in no domain or in two. The imports
 * that broke a rule when the table was written are listed in
 * `.dependency-cruiser-known-violations.json`; that list may only shrink.
 *
 * A module is named by its path under server/ without `.ts`; `dir/*` takes a whole directory.
 * Moving modules into `server/<domain>/` (one PR per domain) turns each list into one `dir/*`.
 */
export const SERVER_DOMAINS = [
  {
    name: 'platform',
    rank: 1,
    purpose: 'database, logging, crypto, queues, outbound HTTP, request context, observability',
    modules: [
      'config',
      'crypto',
      'db',
      'db-errors',
      'db-pool-settings',
      'logger',
      'loki-transport',
      'redis',
      'queue',
      'schema-state',
      'process-errors',
      'concurrency',
      'master-keys',
      'organization-keys',
      'zip',
      'security-headers',
      'job-payloads',
      'system-settings',
      'report-links',
      'outbound-http',
      'egress-policy',
      'egress-proxy',
      'totp',
      'observability/breadcrumbs',
      'observability/fingerprint',
      'observability/incident',
      'observability/metrics',
      'observability/queue',
      'observability/repro',
      'observability/stack',
      'observability/store',
      'observability/taps/runner',
      'observability/taps/jobs',
      'utils/*',
      'middleware/tenancy',
      'middleware/correlation',
      'middleware/rate-limit-store',
      'middleware/async-handler',
      'middleware/async-router',
    ],
  },
  {
    name: 'tenancy',
    rank: 2,
    purpose: 'organizations, memberships, quotas, billing, audit, artifact storage and metering',
    modules: [
      'organization-lifecycle',
      'organization-memberships',
      'member-removal',
      'tenant-quotas',
      'tenant-quota-admin',
      'installation-admin',
      'audit',
      'billing/*',
      'execution-usage',
      'artifact-store',
      'artifact-metering',
      'artifact-retention',
    ],
  },
  {
    name: 'messaging',
    rank: 3,
    purpose:
      'outgoing mail and its settings, templates and providers; test inboxes for mail and SMS',
    modules: [
      'mailer',
      'mail-delivery',
      'mail-messages',
      'mail-providers',
      'mail-settings',
      'mail-templates',
      'email-inbox',
      'sms-inbox',
    ],
  },
  {
    name: 'identity',
    rank: 4,
    purpose: 'sign-in, sessions, SSO, SCIM, MFA, API keys, user settings',
    modules: [
      'auth',
      'storage',
      'api-auth',
      'api-keys',
      'mfa',
      'oauth2',
      'sso',
      'sso-saml',
      'sso-domains',
      'scim',
      'password-reset',
      'registration',
      'user-settings',
      'webhook-tokens',
      'middleware/saml-session',
    ],
  },
  {
    name: 'authoring',
    rank: 5,
    purpose: 'tests, versions, suites, data, step groups, elements, AI and recorder authoring',
    modules: [
      'test-versions',
      'test-version-store',
      'test-version-target',
      'test-refs',
      'test-tags',
      'test-suites',
      'test-data',
      'step-groups',
      'step-elements',
      'custom-actions',
      'recorder-script',
      'nl-authoring',
      'ai-automation-service',
      'story-tests',
      'network-mocks',
      'catalog',
      'test-quarantine',
      'test-publishing',
    ],
  },
  {
    name: 'runtime',
    rank: 6,
    purpose:
      'what every test type runs on: agents and relay, variables, browsers and grids, run policies',
    modules: [
      'agents/*',
      'variables',
      'generators',
      'precondition-runner',
      'run-evidence',
      'run-policies',
      'flow-cursor',
      'value-comparison',
      'history-redaction',
      'matrix-evidence',
      'browsers',
      'browser-grids',
      'cleanup-runner',
      'run-shards',
      'runner-registry',
      'download-check',
      'failed-step-reason',
      'login-state',
      'database-step',
    ],
  },
  {
    name: 'web',
    rank: 7,
    purpose: 'browser tests: Playwright sessions, recording, step execution, accessibility, visual',
    modules: [
      'browser-session',
      'playwright-service',
      'playwright/*',
      'step-executor',
      'accessibility',
      'visual-testing',
      'web-performance',
      'debug-session',
      'browser-tasks',
      'playwright-reporter',
    ],
  },
  {
    name: 'api-tests',
    rank: 7,
    purpose: 'API tests: HTTP, SOAP, gRPC and other protocols, imports, load runs',
    modules: ['api-tests/*'],
  },
  {
    name: 'mobile',
    rank: 7,
    purpose: 'mobile tests: Appium, flows, inspector, bundles',
    modules: ['mobile/*'],
  },
  {
    name: 'bdd',
    rank: 7,
    purpose: 'BDD tests: Gherkin sources, definitions, profiles, execution',
    modules: ['bdd/*'],
  },
  {
    name: 'execution',
    rank: 8,
    purpose: 'plans and runs: orchestration, the plan pipeline, run state, snapshots, scheduling',
    modules: [
      'plan-run/*',
      'run-test',
      'test-execution-service',
      'execution-datasets',
      'execution-definitions',
      'execution-orchestrator',
      'execution-provenance',
      'execution-snapshot',
      'execution-state',
      'run-promotion',
      'run-recovery',
      'run-watch',
      'scheduler-service',
      'test-impact',
    ],
  },
  {
    name: 'reporting',
    rank: 9,
    purpose: 'reports, exports, analytics, failure analysis, flakiness',
    modules: [
      'analytics',
      'allure-export',
      'junit',
      'junit-report',
      'report-export',
      'report-html',
      'report-model',
      'failure-analysis',
      'flaky',
    ],
  },
  {
    name: 'integrations',
    rank: 10,
    purpose:
      'issue trackers, test management, commit status, chat notifications, webhooks, bundles',
    modules: [
      'issue-providers',
      'issue-store',
      'issue-tracking',
      'test-management',
      'test-management-providers',
      'commit-status',
      'notifications',
      'webhooks',
      'run-mail',
      'excel-service',
      'requirements',
      'test-bundle',
      'playwright-export',
    ],
  },
  {
    name: 'http',
    rank: 11,
    purpose: 'routers, the public API, request middleware, the live WebSocket',
    modules: ['routes/*', 'api-v1/*', 'middleware/*', 'observability/taps/express', 'websocket'],
  },
  {
    name: 'app',
    rank: 12,
    purpose: 'process entry points and wiring',
    modules: ['index', 'worker', 'routes', 'static', 'vite', 'health', 'startup-config'],
  },
];

/** Server modules that are not production code and so belong to no domain. */
export const NOT_IN_A_DOMAIN = /(\.test\.ts|\.d\.ts)$|^tests\//;

/**
 * The domain of a module, by its path relative to server/ (`auth.ts`, `billing/stripe.ts`).
 * An exact entry wins over a directory, so `middleware/tenancy` is platform while the rest of
 * `middleware/*` is http.
 */
export function domainOf(relativePath) {
  const p = relativePath.replace(/\\/g, '/');
  for (const d of SERVER_DOMAINS) {
    if (d.modules.some((m) => !m.endsWith('/*') && `${m}.ts` === p)) return d.name;
  }
  let best = null;
  for (const d of SERVER_DOMAINS) {
    for (const m of d.modules) {
      if (m.endsWith('/*') && p.startsWith(m.slice(0, -1))) {
        if (!best || m.length > best.length) best = { name: d.name, length: m.length };
      }
    }
  }
  return best ? best.name : null;
}

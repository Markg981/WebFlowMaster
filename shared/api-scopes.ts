/**
 * What an API key may be allowed to do.
 *
 * A key without scopes acts as its user everywhere, which is what every key did before these
 * existed. A key with scopes works only on /api/v1, and on each endpoint there only if it holds
 * the scope that endpoint names. The user's role still applies on top: a scope never lets a
 * viewer's key do what a viewer cannot, it only narrows what the key can do below that.
 */
export const API_SCOPES = {
  'projects:read': { minimumRole: 'viewer', description: 'Read accessible projects.' },
  'projects:write': {
    minimumRole: 'editor',
    description: 'Create, rename and delete accessible projects.',
  },
  'tests:read': { minimumRole: 'viewer', description: 'Read UI, manual and BDD tests.' },
  'tests:write': {
    minimumRole: 'editor',
    description: 'Create, update and delete UI, manual and BDD tests.',
  },
  'datasets:read': { minimumRole: 'viewer', description: 'Read shared test datasets.' },
  'datasets:write': {
    minimumRole: 'editor',
    description: 'Create, update and delete shared test datasets.',
  },
  'plans:write': {
    minimumRole: 'editor',
    description: 'Create, update and delete plans and replace their typed test membership.',
  },
  'api-tests:read': {
    minimumRole: 'viewer',
    description: 'Read API tests, with literal secrets replaced by variables.',
  },
  'api-tests:write': {
    minimumRole: 'editor',
    description: 'Create, update and delete API tests.',
  },
  'mobile-tests:read': { minimumRole: 'viewer', description: 'Read native mobile tests.' },
  'mobile-tests:write': {
    minimumRole: 'editor',
    description: 'Create, update and delete native mobile tests.',
  },
  'suites:read': {
    minimumRole: 'viewer',
    description: 'Export portable suites; API and mobile tests also need their read scope.',
  },
  'suites:write': {
    minimumRole: 'editor',
    description: 'Import portable suites; API and mobile tests also need their write scope.',
  },
  'plans:read': { minimumRole: 'viewer', description: 'List test plans.' },
  'runs:read': {
    minimumRole: 'viewer',
    description:
      'Read runs, their status, their JUnit reports and their screenshots, videos and other recognised evidence. Traces and HAR files also need runs:evidence.',
  },
  'runs:write': { minimumRole: 'editor', description: 'Start runs and cancel them.' },
  'runs:evidence': {
    minimumRole: 'editor',
    description:
      'Download raw run evidence that may hold credentials: Playwright traces, HAR files and unrecognised files.',
  },
  'schedules:read': { minimumRole: 'viewer', description: 'Read plan schedules.' },
  'schedules:write': {
    minimumRole: 'editor',
    description: 'Create, update, pause, resume and delete plan schedules.',
  },
  'environments:read': {
    minimumRole: 'viewer',
    description: 'Read environments and the names of their secrets, never the values.',
  },
  'environments:write': { minimumRole: 'editor', description: 'Create and delete environments.' },
  'secrets:write': {
    minimumRole: 'editor',
    description: 'Set, rotate and delete environment secrets; values are never read back.',
  },
  'tags:read': { minimumRole: 'viewer', description: 'Read tags and how many tests carry each.' },
  'tags:write': { minimumRole: 'editor', description: 'Create, rename and delete tags.' },
  'quarantine:read': { minimumRole: 'viewer', description: 'List the tests in quarantine.' },
  'quarantine:write': {
    minimumRole: 'editor',
    description: 'Quarantine tests and release them.',
  },
  'webhooks:read': {
    minimumRole: 'editor',
    description:
      "List a plan's webhooks (token prefixes only), as the web application lets editors.",
  },
  'webhooks:write': {
    minimumRole: 'editor',
    description: 'Create and delete plan webhooks; the token is shown once, on creation.',
  },
  'billing:read': {
    minimumRole: 'viewer',
    description:
      "Read the organization's plan, subscription status, limits in force and usage against them.",
  },
} as const;

export type ApiScope = keyof typeof API_SCOPES;

export const API_SCOPE_NAMES = Object.keys(API_SCOPES) as ApiScope[];

export function isApiScope(value: string): value is ApiScope {
  return Object.prototype.hasOwnProperty.call(API_SCOPES, value);
}

/** Where the scoped API lives. A scoped key authenticates nothing outside it. */
export const API_V1_PREFIX = '/api/v1';

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
    description: 'Create and rename accessible projects.',
  },
  'tests:read': { minimumRole: 'viewer', description: 'Read UI, manual and BDD tests.' },
  'tests:write': {
    minimumRole: 'editor',
    description: 'Create and update UI, manual and BDD tests.',
  },
  'datasets:read': { minimumRole: 'viewer', description: 'Read shared test datasets.' },
  'datasets:write': {
    minimumRole: 'editor',
    description: 'Create, update and delete shared test datasets.',
  },
  'plans:write': {
    minimumRole: 'editor',
    description: 'Create plans and replace their typed test membership.',
  },
  'api-tests:read': {
    minimumRole: 'viewer',
    description: 'Read API tests, with literal secrets replaced by variables.',
  },
  'api-tests:write': { minimumRole: 'editor', description: 'Create and update API tests.' },
  'mobile-tests:read': { minimumRole: 'viewer', description: 'Read native mobile tests.' },
  'mobile-tests:write': {
    minimumRole: 'editor',
    description: 'Create and update native mobile tests.',
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
    description: 'Read runs, their status and their JUnit reports.',
  },
  'runs:write': { minimumRole: 'editor', description: 'Start runs and cancel them.' },
} as const;

export type ApiScope = keyof typeof API_SCOPES;

export const API_SCOPE_NAMES = Object.keys(API_SCOPES) as ApiScope[];

export function isApiScope(value: string): value is ApiScope {
  return Object.prototype.hasOwnProperty.call(API_SCOPES, value);
}

/** Where the scoped API lives. A scoped key authenticates nothing outside it. */
export const API_V1_PREFIX = '/api/v1';

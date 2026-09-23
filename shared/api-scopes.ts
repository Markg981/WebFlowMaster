/**
 * What an API key may be allowed to do.
 *
 * A key without scopes acts as its user everywhere, which is what every key did before these
 * existed. A key with scopes works only on /api/v1, and on each endpoint there only if it holds
 * the scope that endpoint names. The user's role still applies on top: a scope never lets a
 * viewer's key do what a viewer cannot, it only narrows what the key can do below that.
 */
export const API_SCOPES = {
  'plans:read': { minimumRole: 'viewer', description: 'List test plans.' },
  'runs:read': { minimumRole: 'viewer', description: 'Read runs, their status and their JUnit reports.' },
  'runs:write': { minimumRole: 'editor', description: 'Start runs and cancel them.' },
} as const;

export type ApiScope = keyof typeof API_SCOPES;

export const API_SCOPE_NAMES = Object.keys(API_SCOPES) as ApiScope[];

export function isApiScope(value: string): value is ApiScope {
  return Object.prototype.hasOwnProperty.call(API_SCOPES, value);
}

/** Where the scoped API lives. A scoped key authenticates nothing outside it. */
export const API_V1_PREFIX = '/api/v1';

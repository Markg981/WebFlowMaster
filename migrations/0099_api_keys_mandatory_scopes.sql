-- API keys without scopes are no longer a credential (security audit C-03).
--
-- A key created before scopes (NULL) acted as its user everywhere: owner routes, SSO and MFA
-- bypassed. Scopes are now mandatory (api-key-auth refuses a NULL-scope key). So that existing
-- installs do not silently lose read access, every NULL-scope key is migrated to the narrowest
-- set matching read usage: all *:read scopes. Anything that wrote through such a key, or used it
-- outside /api/v1, must be re-issued with explicit write scopes.
UPDATE api_keys
SET scopes = ARRAY[
  'api-tests:read','billing:read','datasets:read','environments:read','mobile-tests:read',
  'plans:read','projects:read','quarantine:read','runs:read','schedules:read','suites:read',
  'tags:read','tests:read','webhooks:read'
]
WHERE scopes IS NULL;

/** API tests and their history, with the request model: assertions, extractions, authentication and bodies. */
import { pgTable, text, integer, serial, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { ApiPerformanceSchema, type ApiPerformance } from '../api-performance';
import { ProtocolConfigSchema, type ProtocolConfig } from '../api-protocol-config';
import { organizations, projects, users } from './identity';

export const apiTestHistory = pgTable(
  'api_test_history',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    method: text('method').notNull(),
    url: text('url').notNull(),
    queryParams: jsonb('query_params'),
    requestHeaders: jsonb('request_headers'),
    requestBody: text('request_body'),
    responseStatus: integer('response_status'),
    responseHeaders: jsonb('response_headers'),
    responseBody: text('response_body'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('api_test_history_user_id_idx').on(table.userId),
    index('api_test_history_organization_id_idx').on(table.organizationId),
  ],
);

export const apiTests = pgTable(
  'api_tests',
  {
    id: serial('id').primaryKey(),
    // The organization's, not the person's: a removed member's API tests are handed to another
    // member (server/member-removal.ts), never deleted with them (migration 0040).
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    publishedVersion: integer('published_version'),
    name: text('name').notNull(),
    method: text('method').notNull(),
    url: text('url').notNull(),
    queryParams: jsonb('query_params'),
    requestHeaders: jsonb('request_headers'),
    requestBody: text('request_body'),
    assertions: jsonb('assertions'),
    /**
     * Values to capture from the response for later requests in the same plan run.
     *
     * Assertions could read a response but nothing could take a value out of one, so a test
     * could only check one endpoint in isolation — never a flow. See ExtractionSchema.
     */
    extractions: jsonb('extractions'),
    /**
     * Send the request several times and hold its response times against thresholds — see
     * shared/api-performance.ts. Null: the test sends it once, as it always did.
     */
    performance: jsonb('performance').$type<ApiPerformance>(),
    authType: text('auth_type'),
    authParams: jsonb('auth_params'),
    bodyType: text('body_type'),
    bodyRawContentType: text('body_raw_content_type'),
    bodyFormData: jsonb('body_form_data'),
    bodyUrlEncoded: jsonb('body_url_encoded'),
    bodyGraphqlQuery: text('body_graphql_query'),
    bodyGraphqlVariables: text('body_graphql_variables'),
    /** A gRPC test's .proto (server/api-tests/api-protocols.ts, migration 0069). */
    protoDefinition: text('proto_definition'),
    protocolConfig: jsonb('protocol_config').$type<ProtocolConfig>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),

    // NEW Fields for reporting
    module: text('module'),
    featureArea: text('feature_area'),
    scenario: text('scenario'),
    component: text('component'),
    priority: text('priority').default('Medium'),
    severity: text('severity').default('Major'),
  },
  (table) => [
    index('api_tests_user_id_idx').on(table.userId),
    index('api_tests_project_id_idx').on(table.projectId),
    index('api_tests_organization_id_idx').on(table.organizationId),
  ],
);

// --- Assertion Schemas ---
export const AssertionSourceSchema = z.enum([
  'status_code',
  'header',
  'body_json_path',
  'body_text',
  'response_time',
  // An XML answer, such as SOAP's (server/api-tests/api-protocols.ts).
  'body_xpath',
]);
export const AssertionComparisonSchema = z.enum([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'exists',
  'not_exists',
  'is_empty',
  'is_not_empty',
  'greater_than',
  'less_than',
  'greater_than_or_equals',
  'less_than_or_equals',
  'matches_regex',
  'not_matches_regex',
]);

export const AssertionSchema = z.object({
  id: z.string().uuid().describe('Client-generated unique ID for the assertion row'),
  source: AssertionSourceSchema,
  property: z
    .string()
    .optional()
    .describe('e.g., Header name, JSONPath expression, or empty for status_code/body_text'),
  comparison: AssertionComparisonSchema,
  targetValue: z.string().optional().describe('Expected value; regex for matches_regex'),
  enabled: z.boolean().default(true),
});
export type Assertion = z.infer<typeof AssertionSchema>;

// --- Extraction Schemas ---
//
// An assertion reads a response; an extraction takes a value out of one and binds it to a
// name, so the requests that follow in the same plan run can use it as `{{name}}`. Without
// it an API test can only check a single endpoint in isolation, and a real API test is a
// flow — authenticate, create, read back, delete.

/** Deliberately the assertion vocabulary: the same places, read for a different purpose. */
export const ExtractionSourceSchema = z.enum([
  'status_code',
  'header',
  'body_json_path',
  'body_text',
  'body_xpath',
]);

export const ExtractionSchema = z.object({
  id: z.string().uuid().describe('Client-generated unique ID for the extraction row'),
  name: z
    .string()
    .min(1)
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      'Use letters, digits and underscores, starting with a letter or underscore',
    )
    .describe('The name the captured value is bound to, used as {{name}} later'),
  source: ExtractionSourceSchema,
  property: z
    .string()
    .optional()
    .describe('Header name or JSONPath; unused for status_code and body_text'),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// --- API Authentication Schemas ---
export const AuthTypeSchema = z.enum([
  'inherit',
  'none',
  'basic',
  'bearer',
  'jwtBearer',
  'digest',
  'oauth1',
  'oauth2',
  'hawk',
  'aws',
  'ntlm',
  'apiKey',
  'akamai',
  'asap',
]);
export type AuthType = z.infer<typeof AuthTypeSchema>;

export const BasicAuthParamsSchema = z.object({
  username: z.string(),
  password: z.string(),
});
export type BasicAuthParams = z.infer<typeof BasicAuthParamsSchema>;
export const BearerTokenAuthParamsSchema = z.object({ token: z.string() });
export type BearerTokenAuthParams = z.infer<typeof BearerTokenAuthParamsSchema>;
export const ApiKeyAuthParamsSchema = z.object({
  key: z.string(),
  value: z.string(),
  addTo: z.enum(['header', 'query']),
});
export type ApiKeyAuthParams = z.infer<typeof ApiKeyAuthParamsSchema>;

/**
 * OAuth 2.0, in the two grants a test runner can complete on its own.
 *
 * Not the authorization-code grant: that one requires a human at a browser consenting to a
 * screen, which is not something a schedule at 3am can do. `client_credentials` is how a
 * service authenticates to an enterprise API, and `password` covers the older deployments
 * that still accept it — between them they reach most of what is worth testing.
 *
 * Every field defaults, so a saved test from before this existed — `{ type: 'oauth2' }`
 * with no params at all — still parses. The runner refuses at send time and says which
 * field is missing, which is a better place to find out than a schema error on load.
 */
export const OAuth2AuthParamsSchema = z.object({
  grantType: z.enum(['client_credentials', 'password']).default('client_credentials'),
  tokenUrl: z.string().default(''),
  clientId: z.string().default(''),
  clientSecret: z.string().default(''),
  scope: z.string().default(''),
  // `password` grant only.
  username: z.string().default(''),
  password: z.string().default(''),
  /**
   * Where the client credentials go. RFC 6749 §2.3.1 prefers the Basic header and requires
   * servers to support it; some accept them only in the body, so both are offered.
   */
  clientAuth: z.enum(['header', 'body']).default('header'),
});
export type OAuth2AuthParams = z.infer<typeof OAuth2AuthParamsSchema>;

/**
 * The other schemes of the dropdown (server/api-auth.ts). Every field defaults, like OAuth 2.0's,
 * so a test saved while they were only names — `{ type: 'digest' }` — still loads; the runner
 * says which field is missing when it is sent.
 */
export const JWT_ALGORITHMS = [
  'HS256',
  'HS384',
  'HS512',
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'ES512',
] as const;
export const JwtBearerAuthParamsSchema = z.object({
  algorithm: z.enum(JWT_ALGORITHMS).default('HS256'),
  /** The shared secret for HS*, the PEM private key for RS* and ES*. */
  secret: z.string().default(''),
  secretBase64: z.boolean().default(false),
  /** The claims, as JSON. iat is added when absent. */
  payload: z.string().default('{}'),
  /** Extra header fields, as JSON (kid, typ…). */
  headers: z.string().default('{}'),
  addTo: z.enum(['header', 'query']).default('header'),
  headerPrefix: z.string().default('Bearer'),
  queryParam: z.string().default('token'),
});
export const DigestAuthParamsSchema = z.object({
  username: z.string().default(''),
  password: z.string().default(''),
});
export const OAuth1AuthParamsSchema = z.object({
  signatureMethod: z
    .enum(['HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'PLAINTEXT'])
    .default('HMAC-SHA1'),
  consumerKey: z.string().default(''),
  consumerSecret: z.string().default(''),
  token: z.string().default(''),
  tokenSecret: z.string().default(''),
  realm: z.string().default(''),
  addTo: z.enum(['header', 'query']).default('header'),
});
export const HawkAuthParamsSchema = z.object({
  authId: z.string().default(''),
  authKey: z.string().default(''),
  algorithm: z.enum(['sha256', 'sha1']).default('sha256'),
  ext: z.string().default(''),
  /** Hash the body into the MAC, as servers that verify payloads require. */
  includePayloadHash: z.boolean().default(false),
});
export const AwsSigV4AuthParamsSchema = z.object({
  accessKey: z.string().default(''),
  secretKey: z.string().default(''),
  sessionToken: z.string().default(''),
  region: z.string().default('us-east-1'),
  service: z.string().default(''),
});
export const NtlmAuthParamsSchema = z.object({
  username: z.string().default(''),
  password: z.string().default(''),
  domain: z.string().default(''),
  workstation: z.string().default(''),
});
export const AkamaiEdgeGridAuthParamsSchema = z.object({
  clientToken: z.string().default(''),
  clientSecret: z.string().default(''),
  accessToken: z.string().default(''),
  /** Headers to include in the signature, by name, comma-separated. */
  headersToSign: z.string().default(''),
  maxBody: z.number().int().positive().default(131072),
});
export const AsapAuthParamsSchema = z.object({
  algorithm: z.enum(['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']).default('RS256'),
  issuer: z.string().default(''),
  audience: z.string().default(''),
  keyId: z.string().default(''),
  /** PEM private key. */
  privateKey: z.string().default(''),
  subject: z.string().default(''),
  expirySeconds: z.number().int().positive().max(3600).default(60),
  /** More claims, as JSON. */
  additionalClaims: z.string().default('{}'),
});

export const AuthParamsSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(AuthTypeSchema.enum.basic),
    params: BasicAuthParamsSchema,
  }),
  z.object({
    type: z.literal(AuthTypeSchema.enum.bearer),
    params: BearerTokenAuthParamsSchema,
  }),
  z.object({
    type: z.literal(AuthTypeSchema.enum.apiKey),
    params: ApiKeyAuthParamsSchema,
  }),
  z.object({ type: z.literal(AuthTypeSchema.enum.inherit) }),
  z.object({ type: z.literal(AuthTypeSchema.enum.none) }),
  z.object({
    type: z.literal(AuthTypeSchema.enum.jwtBearer),
    params: JwtBearerAuthParamsSchema.default({}),
  }),
  z.object({
    type: z.literal(AuthTypeSchema.enum.digest),
    params: DigestAuthParamsSchema.default({}),
  }),
  z.object({
    type: z.literal(AuthTypeSchema.enum.oauth1),
    params: OAuth1AuthParamsSchema.default({}),
  }),
  z.object({
    type: z.literal(AuthTypeSchema.enum.oauth2),
    params: OAuth2AuthParamsSchema.default({}),
  }),
  z.object({ type: z.literal(AuthTypeSchema.enum.hawk), params: HawkAuthParamsSchema.default({}) }),
  z.object({
    type: z.literal(AuthTypeSchema.enum.aws),
    params: AwsSigV4AuthParamsSchema.default({}),
  }),
  z.object({ type: z.literal(AuthTypeSchema.enum.ntlm), params: NtlmAuthParamsSchema.default({}) }),
  z.object({
    type: z.literal(AuthTypeSchema.enum.akamai),
    params: AkamaiEdgeGridAuthParamsSchema.default({}),
  }),
  z.object({ type: z.literal(AuthTypeSchema.enum.asap), params: AsapAuthParamsSchema.default({}) }),
]);
export type AuthParams = z.infer<typeof AuthParamsSchema>;

/**
 * The schemes the runner can actually satisfy.
 *
 * All fourteen the enum lists, since the eight that had only ever been names in the dropdown
 * were implemented (server/api-auth.ts). The list stays so that a scheme added to the enum
 * later is shown as unavailable, and refused by the runner, until it does something.
 *
 * Shared so those two cannot disagree about which is which; an architecture test pins the
 * runner's own handling against this list.
 */
export const IMPLEMENTED_AUTH_TYPES = [
  'none',
  'inherit',
  'basic',
  'bearer',
  'apiKey',
  'oauth2',
  'jwtBearer',
  'digest',
  'oauth1',
  'hawk',
  'aws',
  'ntlm',
  'akamai',
  'asap',
] as const satisfies readonly AuthType[];

export function isImplementedAuthType(type: AuthType): boolean {
  return (IMPLEMENTED_AUTH_TYPES as readonly AuthType[]).includes(type);
}

const bodyTypesArray = [
  'none',
  'form-data',
  'x-www-form-urlencoded',
  'raw',
  'binary',
  'GraphQL',
] as const;
export const BodyTypeSchema = z.enum(bodyTypesArray);
export type BodyType = z.infer<typeof BodyTypeSchema>;

export const KeyValuePairSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
});
export type KeyValuePair = z.infer<typeof KeyValuePairSchema>;

export const FormDataFieldMetadataSchema = z.union([
  z.object({
    id: z.string(),
    key: z.string(),
    enabled: z.boolean(),
    type: z.literal('text'),
    value: z.string(),
  }),
  z.object({
    id: z.string(),
    key: z.string(),
    enabled: z.boolean(),
    type: z.literal('file'),
    fileName: z.string(),
    fileType: z.string(),
  }),
]);
export type FormDataFieldMetadata = z.infer<typeof FormDataFieldMetadataSchema>;

export const insertApiTestHistorySchema = createInsertSchema(apiTestHistory, {}).omit({
  id: true,
  createdAt: true,
  userId: true,
  // The tenancy boundary: never accepted from the client, always derived server-side
  // from the authenticated session.
  organizationId: true,
});
export type InsertApiTestHistoryPayload = z.infer<typeof insertApiTestHistorySchema>;

/**
 * A request's address: absolute, or made absolute by its {{variables}} — `{{baseUrl}}/orders`,
 * `https://{{host}}/api` — which the runner fills in from the environment (server/api-tests/api-test-runner.ts).
 * A plain `.url()` refused those, so a test could not follow an environment's base address.
 */
export function isRequestUrl(value: string): boolean {
  const filled = value
    .trim()
    .replace(/^\{\{\s*[\w.$]+\s*\}\}/, 'https://placeholder.invalid')
    .replace(/\{\{[^}]*\}\}/g, 'x');
  try {
    new URL(filled);
    return true;
  } catch {
    return false;
  }
}

export const insertApiTestSchema = createInsertSchema(apiTests, {
  name: z.string().min(1, 'Test name cannot be empty'),
  method: z.string().min(1, 'HTTP method is required'),
  url: z
    .string()
    .refine(
      isRequestUrl,
      'Invalid URL format: an absolute URL, or one starting with a variable such as {{baseUrl}}',
    ),
  module: z.string().optional().nullable(),
  featureArea: z.string().optional().nullable(),
  scenario: z.string().optional().nullable(),
  component: z.string().optional().nullable(),
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']).optional().nullable(),
  severity: z.enum(['Blocker', 'Critical', 'Major', 'Minor']).optional().nullable(),
  // Typed rather than left as raw jsonb: a malformed extraction is only discovered at run
  // time otherwise, in a worker, halfway through a scheduled plan.
  extractions: z.array(ExtractionSchema).optional().nullable(),
  performance: ApiPerformanceSchema.optional().nullable(),
  protocolConfig: ProtocolConfigSchema.optional().nullable(),
})
  .omit({
    id: true,
    publishedVersion: true,
    createdAt: true,
    updatedAt: true,
    userId: true,
    // The tenancy boundary: never accepted from the client, always derived server-side
    // from the authenticated session.
    organizationId: true,
    projectId: true,
    queryParams: true,
    requestHeaders: true,
    requestBody: true,
    assertions: true,
    authParams: true,
    bodyFormData: true,
    bodyUrlEncoded: true,
  })
  .extend({
    queryParams: z
      .record(z.string().or(z.array(z.string())))
      .optional()
      .nullable(),
    requestHeaders: z.record(z.string()).optional().nullable(),
    requestBody: z.any().optional().nullable(),
    assertions: z.array(AssertionSchema).optional().nullable(),
    authType: AuthTypeSchema.optional().nullable(),
    authParams: AuthParamsSchema.optional().nullable(),
    bodyType: BodyTypeSchema.optional().nullable(),
    bodyRawContentType: z.string().optional().nullable(),
    bodyFormData: z.array(FormDataFieldMetadataSchema).optional().nullable(),
    bodyUrlEncoded: z.array(KeyValuePairSchema).optional().nullable(),
    bodyGraphqlQuery: z.string().optional().nullable(),
    bodyGraphqlVariables: z.string().optional().nullable(),
  });

export const updateApiTestSchema = insertApiTestSchema.partial().extend({
  queryParams: z
    .record(z.string().or(z.array(z.string())))
    .optional()
    .nullable(),
  requestHeaders: z.record(z.string()).optional().nullable(),
  requestBody: z.any().optional().nullable(),
  assertions: z.array(AssertionSchema).optional().nullable(),
  authType: AuthTypeSchema.optional().nullable(),
  authParams: AuthParamsSchema.optional().nullable(),
  bodyType: BodyTypeSchema.optional().nullable(),
  bodyRawContentType: z.string().optional().nullable(),
  bodyFormData: z.array(FormDataFieldMetadataSchema).optional().nullable(),
  bodyUrlEncoded: z.array(KeyValuePairSchema).optional().nullable(),
  bodyGraphqlQuery: z.string().optional().nullable(),
  bodyGraphqlVariables: z.string().optional().nullable(),
});

export type ApiTestHistoryEntry = typeof apiTestHistory.$inferSelect;
export type InsertApiTestHistoryEntry = typeof apiTestHistory.$inferInsert;
export type ApiTest = typeof apiTests.$inferSelect;
export type InsertApiTest = typeof apiTests.$inferInsert;

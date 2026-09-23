import { API_SCOPES, type ApiScope } from '@shared/api-scopes';
import { EXECUTION_STATUSES } from '@shared/execution-status';

/**
 * The description of /api/v1, served at /api/v1/openapi.json.
 *
 * Written by hand rather than generated, and held to the router by
 * server/api-v1/openapi.test.ts: every route is here with the scope its guard checks, and
 * nothing is here that the router does not serve. A document that drifts from the API is
 * worse than none, because a generated client believes it.
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});

const secured = (scope: ApiScope) => ({
  security: [{ bearerKey: [] }, { headerKey: [] }],
  'x-required-scope': scope,
});

const common = {
  '401': errorResponse('No usable API key was sent.'),
  '403': errorResponse("The key lacks the scope, or its account's role is below what the scope needs."),
};

const paginated = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
  { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
];

const runId = { name: 'runId', in: 'path', required: true, schema: { type: 'string' } };

const scopeList = (Object.entries(API_SCOPES) as Array<[ApiScope, (typeof API_SCOPES)[ApiScope]]>)
  .map(([scope, { minimumRole, description }]) => `- \`${scope}\` (role ${minimumRole} or higher): ${description}`)
  .join('\n');

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'WebFlowMaster API',
    version: '1.0.0',
    description:
      'Start test plan runs from a pipeline, wait for them, and collect their results.\n\n' +
      'Authenticate with an API key, as `Authorization: Bearer <key>` or `X-API-Key: <key>`. ' +
      'A key with scopes works only here, and on each endpoint only with the scope it names:\n\n' +
      `${scopeList}\n\n` +
      'Errors are always `{ "error": { "code", "message" } }`; branch on `code`.',
  },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: {
      bearerKey: { type: 'http', scheme: 'bearer', description: 'An API key, `wfm_…`.' },
      headerKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', examples: ['insufficient_scope', 'plan_not_found', 'queue_quota_exceeded'] },
              message: { type: 'string' },
            },
            additionalProperties: true,
          },
        },
      },
      Plan: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: ['string', 'null'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Run: {
        type: 'object',
        required: ['id', 'planId', 'status', 'trigger', 'links'],
        properties: {
          id: { type: 'string' },
          planId: { type: 'string' },
          planName: { type: ['string', 'null'] },
          status: { type: 'string', enum: [...EXECUTION_STATUSES] },
          trigger: { type: 'string', enum: ['manual', 'scheduled', 'webhook', 'api'] },
          attempt: { type: 'integer' },
          maxAttempts: { type: 'integer' },
          queuedAt: { type: 'string', format: 'date-time' },
          startedAt: { type: ['string', 'null'], format: 'date-time' },
          completedAt: { type: ['string', 'null'], format: 'date-time' },
          durationMs: { type: ['integer', 'null'] },
          tests: {
            type: 'object',
            properties: {
              total: { type: ['integer', 'null'] },
              passed: { type: ['integer', 'null'] },
              failed: { type: ['integer', 'null'] },
              skipped: { type: ['integer', 'null'] },
              quarantinedFailures: {
                type: 'integer',
                description: 'Of the failed tests, those in quarantine. They are counted in failed but do not decide the status.',
              },
            },
          },
          runner: { type: ['string', 'null'], description: 'The runner that took the run, as host:pid:suffix.' },
          failure: {
            type: ['object', 'null'],
            properties: { code: { type: 'string' }, message: { type: ['string', 'null'] } },
          },
          links: {
            type: 'object',
            properties: { self: { type: 'string' }, junit: { type: 'string' } },
          },
        },
      },
    },
  },
  paths: {
    '/api/v1/plans': {
      get: {
        operationId: 'listPlans',
        summary: "The organization's test plans, by name.",
        ...secured('plans:read'),
        parameters: paginated,
        responses: {
          '200': {
            description: 'A page of plans.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { items: { type: 'array', items: ref('Plan') }, limit: { type: 'integer' }, offset: { type: 'integer' } },
                },
              },
            },
          },
          ...common,
        },
      },
    },
    '/api/v1/plans/{planId}/runs': {
      post: {
        operationId: 'startRun',
        summary: 'Start a run of a plan.',
        description:
          'Queues the run and answers at once; poll `Location` until `status` is no longer queued, running or cancelling. ' +
          'Send an `Idempotency-Key` to make retrying the request safe: the same key returns the same run.',
        ...secured('runs:write'),
        parameters: [
          { name: 'planId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 255 } },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  environmentId: { type: 'integer', description: 'The environment to run against.' },
                  updateBaselines: { type: 'boolean', description: "Make this run's screenshots the new visual baselines." },
                },
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'Queued.',
            headers: { Location: { schema: { type: 'string' }, description: 'The run.' } },
            content: { 'application/json': { schema: ref('Run') } },
          },
          '400': errorResponse('The body or a header is not valid.'),
          ...common,
          '404': errorResponse('No such plan, or no such environment, in this organization.'),
          '429': errorResponse("The organization's queue is full (`queue_quota_exceeded`)."),
          '503': errorResponse('The run could not be handed to a worker; retry with the same Idempotency-Key.'),
        },
      },
    },
    '/api/v1/runs': {
      get: {
        operationId: 'listRuns',
        summary: 'Runs, most recent first.',
        ...secured('runs:read'),
        parameters: [
          ...paginated,
          { name: 'planId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: [...EXECUTION_STATUSES] } },
        ],
        responses: {
          '200': {
            description: 'A page of runs.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { items: { type: 'array', items: ref('Run') }, limit: { type: 'integer' }, offset: { type: 'integer' } },
                },
              },
            },
          },
          '400': errorResponse('An unknown status.'),
          ...common,
        },
      },
    },
    '/api/v1/runs/{runId}': {
      get: {
        operationId: 'getRun',
        summary: 'One run: its status and its counts.',
        ...secured('runs:read'),
        parameters: [runId],
        responses: {
          '200': { description: 'The run.', content: { 'application/json': { schema: ref('Run') } } },
          ...common,
          '404': errorResponse('No such run in this organization.'),
        },
      },
    },
    '/api/v1/runs/{runId}/cancel': {
      post: {
        operationId: 'cancelRun',
        summary: 'Stop a run.',
        description: 'A queued run is cancelled at once (200); a running one is asked to stop (202) and ends at its next step.',
        ...secured('runs:write'),
        parameters: [runId],
        responses: {
          '200': { description: 'Cancelled.', content: { 'application/json': { schema: ref('Run') } } },
          '202': { description: 'Asked to stop.', content: { 'application/json': { schema: ref('Run') } } },
          ...common,
          '404': errorResponse('No such run in this organization.'),
          '409': errorResponse('The run has already ended.'),
        },
      },
    },
    '/api/v1/runs/{runId}/junit': {
      get: {
        operationId: 'getRunJUnit',
        summary: 'The run as JUnit XML, for the build\'s own test report.',
        ...secured('runs:read'),
        parameters: [runId],
        responses: {
          '200': { description: 'JUnit XML.', content: { 'application/xml': { schema: { type: 'string' } } } },
          ...common,
          '404': errorResponse('No such run in this organization.'),
        },
      },
    },
  },
} as const;

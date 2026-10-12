import {
  anyObject,
  date,
  error,
  idParameter,
  integer,
  nullableDate,
  nullableObject,
  nullableText,
  object,
  operation,
  pagination,
  ref,
  text,
} from './authoring-openapi';
// The public contracts of server/http/api-v1/management.ts, written out like the authoring ones.

/** What a run leaves behind, by file type; `evidenceKindOf` in management.ts decides. */
export const EVIDENCE_KINDS = [
  'screenshot',
  'video',
  'trace',
  'log',
  'report',
  'data',
  'other',
] as const;

const scheduleFields = {
  testPlanId: { ...text, minLength: 1, maxLength: 100 },
  scheduleName: { ...text, minLength: 1, maxLength: 200 },
  frequency: {
    ...text,
    minLength: 1,
    maxLength: 200,
    description:
      'As the web application saves it: `once`, `daily`, `weekly`, `every_N_minutes`, `every_N_hours`, or `cron:<expression>`.',
  },
  nextRunAt: {
    oneOf: [date, { type: 'number', exclusiveMinimum: 0 }],
    description:
      'When it first runs: an ISO 8601 date-time, or Unix seconds. For a CRON or every_N frequency the first occurrence of the pattern at or after it, in the schedule’s zone.',
  },
  timezone: { ...text, minLength: 1, maxLength: 100, description: 'An IANA zone; UTC by default.' },
  environment: { ...nullableText, maxLength: 200 },
  browsers: { type: ['array', 'null'], maxItems: 10, items: { ...text, minLength: 1 } },
  notificationConfigOverride: nullableObject,
  executionParameters: nullableObject,
  isActive: { type: 'boolean' },
  retryOnFailure: { ...text, enum: ['none', 'once', 'twice'] },
};
const environmentFields = {
  name: { ...text, minLength: 1, maxLength: 120 },
  description: { ...nullableText, maxLength: 2000 },
};
const tagCounts = {
  uiCount: { type: 'integer', minimum: 0 },
  apiCount: { type: 'integer', minimum: 0 },
  mobileCount: { type: 'integer', minimum: 0 },
};
const webhookFields = {
  id: integer,
  testPlanId: text,
  name: { ...text, minLength: 1, maxLength: 80 },
  tokenPrefix: { ...text, description: 'The first characters of the token, to tell two apart.' },
  createdAt: date,
  lastUsedAt: nullableDate,
};

const planQuotas = {
  maxConcurrentRuns: { type: ['integer', 'null'] },
  maxQueuedRuns: { type: ['integer', 'null'] },
  maxTests: { type: ['integer', 'null'] },
  maxArtifactBytes: { type: ['integer', 'null'] },
  maxMonthlyExecutionMinutes: { type: ['integer', 'null'] },
};
export const managementSchemas = {
  BillingPlan: object(
    {
      code: text,
      name: text,
      priceMonthMinor: { type: 'integer', minimum: 0 },
      priceYearMinor: { type: 'integer', minimum: 0 },
      currency: { ...text, description: 'ISO 4217, lowercase.' },
      trialDays: { type: 'integer', minimum: 0 },
      active: { type: 'boolean' },
      quotas: {
        type: 'object',
        properties: planQuotas,
        description: 'Null: the installation default.',
      },
      providerPriceIds: anyObject,
    },
    ['code', 'name', 'quotas'],
  ),
  Billing: object(
    {
      provider: { ...text, enum: ['none', 'stripe'] },
      plan: ref('BillingPlan'),
      subscription: object(
        {
          organizationId: integer,
          planCode: text,
          status: { ...text, enum: ['trialing', 'active', 'past_due', 'suspended', 'cancelled'] },
          interval: { ...nullableText, enum: ['month', 'year', null] },
          currentPeriodStart: nullableDate,
          currentPeriodEnd: nullableDate,
          trialEndsAt: nullableDate,
          pastDueSince: nullableDate,
          provider: text,
          providerCustomerId: nullableText,
          providerSubscriptionId: nullableText,
          suspendedReason: nullableText,
          updatedAt: date,
        },
        ['organizationId', 'planCode', 'status'],
      ),
      entitlement: object(
        {
          runsBlocked: { type: 'boolean' },
          reason: {
            ...nullableText,
            enum: ['suspended', 'cancelled', 'past_due_grace_expired', null],
          },
          graceEndsAt: nullableDate,
        },
        ['runsBlocked'],
      ),
      quotas: {
        type: 'object',
        description:
          'The limits in force: an installation administrator’s override, else the plan’s, else the installation default.',
        properties: { mode: { ...text, enum: ['off', 'monitor', 'enforce'] }, ...planQuotas },
      },
      usage: anyObject,
      pastDueGraceDays: { type: 'integer', minimum: 0 },
    },
    ['provider', 'plan', 'subscription', 'entitlement', 'quotas', 'usage', 'pastDueGraceDays'],
  ),
  ScheduleInput: object(scheduleFields, ['testPlanId', 'scheduleName', 'frequency', 'nextRunAt']),
  SchedulePatch: object(scheduleFields),
  Schedule: object({
    id: text,
    ...scheduleFields,
    nextRunAt: date,
    testPlanName: nullableText,
    createdAt: date,
    updatedAt: nullableDate,
  }),
  EnvironmentInput: object(environmentFields, ['name']),
  Environment: object({
    id: integer,
    ...environmentFields,
    createdAt: date,
    loginStateCapturedAt: {
      ...nullableDate,
      description: 'When a saved browser login was captured for it; the login itself never leaves.',
    },
  }),
  SecretValue: object({ value: { ...text, minLength: 1, maxLength: 100000 } }, ['value']),
  Secret: object(
    {
      id: integer,
      environmentId: integer,
      keyName: { ...text, pattern: '^[\\w.]+$', maxLength: 120 },
      createdAt: date,
      updatedAt: date,
    },
    ['id', 'environmentId', 'keyName'],
  ),
  Evidence: object(
    {
      path: { ...text, description: 'Below the run’s own directory.' },
      kind: { ...text, enum: [...EVIDENCE_KINDS] },
      contentType: text,
      size: { type: 'integer', minimum: 0 },
      url: { ...text, description: 'Where the file is served from, with the same key.' },
    },
    ['path', 'kind', 'contentType', 'size', 'url'],
  ),
  TagInput: object({ name: { ...text, minLength: 1, maxLength: 60 } }, ['name']),
  Tag: object({ id: text, name: text, createdAt: date, ...tagCounts }, ['id', 'name']),
  TagDeletion: object(
    {
      id: text,
      removedFrom: {
        type: 'integer',
        minimum: 0,
        description: 'How many tests carried the tag.',
      },
    },
    ['id', 'removedFrom'],
  ),
  QuarantineInput: object(
    {
      testType: { ...text, enum: ['ui', 'api', 'mobile'] },
      testId: integer,
      reason: { ...text, minLength: 1, maxLength: 2000 },
    },
    ['testType', 'testId', 'reason'],
  ),
  QuarantineRelease: object({ note: { ...text, maxLength: 2000 } }),
  Quarantine: object(
    {
      id: integer,
      testType: { ...text, enum: ['ui', 'api', 'mobile'] },
      testId: integer,
      reason: text,
      quarantinedAt: date,
      releasedAt: nullableDate,
      releaseNote: nullableText,
    },
    ['id', 'testType', 'testId', 'reason', 'quarantinedAt'],
  ),
  QuarantinedTest: object(
    {
      id: integer,
      testType: { ...text, enum: ['ui', 'api', 'mobile'] },
      testId: integer,
      testName: nullableText,
      reason: text,
      quarantinedAt: date,
      quarantinedBy: nullableText,
      evidence: {
        ...anyObject,
        description:
          'How the test has done since it was set aside, as the web application shows it.',
      },
    },
    ['id', 'testType', 'testId', 'reason', 'quarantinedAt'],
  ),
  WebhookInput: object({ name: { ...text, minLength: 1, maxLength: 80 } }, ['name']),
  Webhook: object(webhookFields, ['id', 'testPlanId', 'name', 'tokenPrefix']),
  WebhookCreated: object(
    {
      ...webhookFields,
      token: {
        ...text,
        description:
          'Shown here and never again; send it as X-Webhook-Token to /api/webhooks/execute.',
      },
    },
    ['id', 'testPlanId', 'name', 'tokenPrefix', 'token'],
  ),
};

const runId = idParameter('runId', true);
const scheduleId = idParameter('scheduleId', true);
const environmentId = idParameter('environmentId');
const keyName = {
  name: 'keyName',
  in: 'path',
  required: true,
  schema: { ...text, pattern: '^[\\w.]+$' },
};
const withTotal = (item: string) => ({
  ...object(
    {
      items: { type: 'array', items: ref(item) },
      limit: integer,
      offset: { type: 'integer', minimum: 0 },
      total: { type: 'integer', minimum: 0 },
    },
    ['items', 'limit', 'offset', 'total'],
  ),
});

export const managementPaths = {
  '/api/v1/schedules': {
    get: operation({
      id: 'listSchedules',
      scope: 'schedules:read',
      response: 'Schedule',
      list: true,
      parameters: [...pagination, { name: 'testPlanId', in: 'query', schema: text }],
      summary: 'List plan schedules, newest first.',
    }),
    post: operation({
      id: 'createSchedule',
      scope: 'schedules:write',
      input: 'ScheduleInput',
      response: 'Schedule',
      status: 201,
      summary: 'Schedule a plan; runs are made on behalf of the key’s account.',
    }),
  },
  '/api/v1/schedules/{scheduleId}': {
    get: operation({
      id: 'getSchedule',
      scope: 'schedules:read',
      response: 'Schedule',
      parameters: scheduleId,
      summary: 'Read a schedule.',
    }),
    patch: operation({
      id: 'updateSchedule',
      scope: 'schedules:write',
      input: 'SchedulePatch',
      response: 'Schedule',
      parameters: scheduleId,
      summary: 'Change a schedule; a change to when it runs recomputes its next run.',
    }),
    delete: operation({
      id: 'deleteSchedule',
      scope: 'schedules:write',
      status: 204,
      parameters: scheduleId,
      summary: 'Delete a schedule.',
    }),
  },
  '/api/v1/schedules/{scheduleId}/pause': {
    post: operation({
      id: 'pauseSchedule',
      scope: 'schedules:write',
      response: 'Schedule',
      parameters: scheduleId,
      summary: 'Stop a schedule from firing, keeping it.',
    }),
  },
  '/api/v1/schedules/{scheduleId}/resume': {
    post: operation({
      id: 'resumeSchedule',
      scope: 'schedules:write',
      response: 'Schedule',
      parameters: scheduleId,
      summary: 'Let a paused schedule fire again.',
    }),
  },
  '/api/v1/environments': {
    get: operation({
      id: 'listEnvironments',
      scope: 'environments:read',
      response: 'Environment',
      list: true,
      parameters: pagination,
      summary: 'List environments, by name.',
    }),
    post: operation({
      id: 'createEnvironment',
      scope: 'environments:write',
      input: 'EnvironmentInput',
      response: 'Environment',
      status: 201,
      summary: 'Create an environment; names are unique in the organization, ignoring case.',
    }),
  },
  '/api/v1/environments/{environmentId}': {
    get: operation({
      id: 'getEnvironment',
      scope: 'environments:read',
      response: 'Environment',
      parameters: environmentId,
      summary: 'Read an environment.',
    }),
    delete: operation({
      id: 'deleteEnvironment',
      scope: 'environments:write',
      status: 204,
      parameters: environmentId,
      summary: 'Delete an environment and its secrets.',
    }),
  },
  '/api/v1/environments/{environmentId}/secrets': {
    get: operation({
      id: 'listSecrets',
      scope: 'environments:read',
      response: 'Secret',
      list: true,
      parameters: [...environmentId, ...pagination],
      summary: 'The names of an environment’s secrets, never their values.',
    }),
  },
  '/api/v1/environments/{environmentId}/secrets/{keyName}': {
    put: operation({
      id: 'setSecret',
      scope: 'secrets:write',
      input: 'SecretValue',
      response: 'Secret',
      status: 201,
      parameters: [...environmentId, keyName],
      summary: 'Set a secret (201) or rotate one that exists (200). The value is never read back.',
      responses: {
        '200': {
          description: 'Rotated: the stored value was replaced.',
          content: { 'application/json': { schema: ref('Secret') } },
        },
      },
    }),
    delete: operation({
      id: 'deleteSecret',
      scope: 'secrets:write',
      status: 204,
      parameters: [...environmentId, keyName],
      summary: 'Delete a secret.',
    }),
  },
  '/api/v1/runs/{runId}/evidence': {
    get: operation({
      id: 'listRunEvidence',
      scope: 'runs:read',
      parameters: [...runId, ...pagination],
      summary: 'The files a run left behind: screenshots, videos, traces, logs and reports.',
      description:
        'Each file carries the URL it is served from. A run whose evidence retention has removed answers an empty page with `purged: true`.',
      responses: {
        '200': {
          description: 'A page of files, by path, with how many there are.',
          content: {
            'application/json': {
              schema: {
                ...withTotal('Evidence'),
                properties: {
                  ...withTotal('Evidence').properties,
                  purged: { type: 'boolean' },
                },
              },
            },
          },
        },
        '502': error('The artifact store could not be reached (`artifact_store_unavailable`).'),
      },
    }),
  },
  '/api/v1/runs/{runId}/artifacts/{path}': {
    get: operation({
      id: 'getRunArtifact',
      scope: 'runs:read',
      parameters: [
        ...runId,
        {
          name: 'path',
          in: 'path',
          required: true,
          schema: text,
          description: 'The file’s path below the run’s directory, as the evidence list gives it.',
        },
      ],
      summary: 'One evidence file, streamed with its content type.',
      responses: {
        '200': {
          description: 'The file.',
          content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
        },
        '502': error('The artifact store could not be reached (`artifact_store_unavailable`).'),
      },
    }),
  },
  '/api/v1/tags': {
    get: operation({
      id: 'listTags',
      scope: 'tags:read',
      response: 'Tag',
      list: true,
      parameters: pagination,
      summary: 'List tags, by name, with how many tests of each kind carry them.',
    }),
    post: operation({
      id: 'createTag',
      scope: 'tags:write',
      input: 'TagInput',
      response: 'Tag',
      status: 201,
      summary: 'Create a tag (201), or answer the one that already has the name (200).',
      responses: {
        '200': {
          description: 'A tag with this name, ignoring case, already existed.',
          content: { 'application/json': { schema: ref('Tag') } },
        },
      },
    }),
  },
  '/api/v1/tags/{tagId}': {
    get: operation({
      id: 'getTag',
      scope: 'tags:read',
      response: 'Tag',
      parameters: idParameter('tagId', true),
      summary: 'Read a tag.',
    }),
    patch: operation({
      id: 'renameTag',
      scope: 'tags:write',
      input: 'TagInput',
      response: 'Tag',
      parameters: idParameter('tagId', true),
      summary: 'Rename a tag; every test carrying it follows.',
    }),
    delete: operation({
      id: 'deleteTag',
      scope: 'tags:write',
      response: 'TagDeletion',
      parameters: idParameter('tagId', true),
      summary: 'Delete a tag and remove it from every test; says how many.',
    }),
  },
  '/api/v1/quarantine': {
    get: operation({
      id: 'listQuarantine',
      scope: 'quarantine:read',
      parameters: pagination,
      summary: 'The tests in quarantine, newest first, and how each has done since.',
      responses: {
        '200': {
          description: 'A page of quarantined tests.',
          content: { 'application/json': { schema: withTotal('QuarantinedTest') } },
        },
      },
    }),
    post: operation({
      id: 'quarantineTest',
      scope: 'quarantine:write',
      input: 'QuarantineInput',
      response: 'Quarantine',
      status: 201,
      summary: 'Set a test aside: its failures no longer decide a run’s status.',
      responses: { '409': error('`already_quarantined`: the test is already in quarantine.') },
    }),
  },
  '/api/v1/quarantine/{quarantineId}/release': {
    post: operation({
      id: 'releaseQuarantine',
      scope: 'quarantine:write',
      input: 'QuarantineRelease',
      response: 'Quarantine',
      parameters: idParameter('quarantineId'),
      summary: 'Bring a test back: its failures count again from the next run.',
      responses: { '409': error('`already_released`: the test is no longer in quarantine.') },
    }),
  },
  '/api/v1/plans/{planId}/webhooks': {
    get: operation({
      id: 'listWebhooks',
      scope: 'webhooks:read',
      response: 'Webhook',
      list: true,
      parameters: [...idParameter('planId', true), ...pagination],
      summary: 'A plan’s webhooks, newest first; token prefixes only.',
    }),
    post: operation({
      id: 'createWebhook',
      scope: 'webhooks:write',
      input: 'WebhookInput',
      response: 'WebhookCreated',
      status: 201,
      parameters: idParameter('planId', true),
      summary: 'Create a webhook that starts the plan; the token is shown once.',
    }),
  },
  '/api/v1/webhooks/{webhookId}': {
    delete: operation({
      id: 'deleteWebhook',
      scope: 'webhooks:write',
      status: 204,
      parameters: idParameter('webhookId'),
      summary: 'Delete a webhook; its token stops working at once.',
    }),
  },
  '/api/v1/billing': {
    get: operation({
      id: 'getBilling',
      scope: 'billing:read',
      response: 'Billing',
      summary:
        'The organization’s plan, subscription status, the limits in force and its usage against them.',
      description:
        'While `entitlement.runsBlocked` is true, starting a run answers `402 subscription_suspended`; reading runs and evidence still works.',
    }),
  },
};

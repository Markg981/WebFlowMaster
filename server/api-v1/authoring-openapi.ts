import type { ApiScope } from '@shared/api-scopes';

// Explicit public contracts, independent of database columns and runtime route imports.
const integer = { type: 'integer', minimum: 1 } as const;
const text = { type: 'string' } as const;
const nullableText = { type: ['string', 'null'] } as const;
const date = { type: 'string', format: 'date-time' } as const;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const projectFields = {
  name: { ...text, minLength: 1, maxLength: 200 },
};
const testFields = {
  name: { ...text, minLength: 1, maxLength: 200 },
  url: { ...text, maxLength: 4000 },
  projectId: { type: ['integer', 'null'], minimum: 1 },
  sequence: {
    type: 'array',
    maxItems: 2000,
    items: { type: 'object', additionalProperties: true },
  },
  elements: {
    type: 'array',
    maxItems: 2000,
    default: [],
    items: { type: 'object', additionalProperties: true },
  },
  bdd: {},
  dataset: {},
  preconditions: {},
  cleanups: {},
  module: nullableText,
  featureArea: nullableText,
  scenario: nullableText,
  component: nullableText,
  priority: nullableText,
  severity: nullableText,
  status: { ...text, enum: ['draft', 'ready', 'archived'] },
};
const anyObject = { type: 'object', additionalProperties: true } as const;
const nullableObject = { type: ['object', 'null'], additionalProperties: true } as const;
const nullableArray = { type: ['array', 'null'], items: anyObject } as const;
const apiTestFields = {
  name: { ...text, minLength: 1, maxLength: 200 },
  method: { ...text, minLength: 1, maxLength: 20 },
  url: {
    ...text,
    description: 'An absolute URL, or one starting with a variable such as {{baseUrl}}.',
  },
  projectId: { type: ['integer', 'null'], minimum: 1 },
  module: nullableText,
  featureArea: nullableText,
  scenario: nullableText,
  component: nullableText,
  priority: { type: ['string', 'null'], enum: ['Critical', 'High', 'Medium', 'Low', null] },
  severity: { type: ['string', 'null'], enum: ['Blocker', 'Critical', 'Major', 'Minor', null] },
  queryParams: nullableObject,
  requestHeaders: { type: ['object', 'null'], additionalProperties: text },
  requestBody: {},
  assertions: nullableArray,
  extractions: nullableArray,
  performance: nullableObject,
  authType: nullableText,
  authParams: {
    ...nullableObject,
    description:
      'Reads replace literal secrets with {{<type>_<parameter>}}; sending that variable back keeps the stored secret.',
  },
  bodyType: nullableText,
  bodyRawContentType: nullableText,
  bodyFormData: nullableArray,
  bodyUrlEncoded: nullableArray,
  bodyGraphqlQuery: nullableText,
  bodyGraphqlVariables: nullableText,
  protoDefinition: nullableText,
  protocolConfig: nullableObject,
};
const mobileTestFields = {
  name: { ...text, minLength: 1, maxLength: 200 },
  platform: { ...text, enum: ['android', 'ios'] },
  app: {
    ...text,
    minLength: 1,
    maxLength: 1000,
    description: 'bs://…, lt://…, an http(s):// address, or a local Appium path.',
  },
  deviceName: { ...text, minLength: 1, maxLength: 120 },
  osVersion: { ...nullableText, maxLength: 20 },
  deviceMatrix: { type: 'array', maxItems: 20, default: [], items: anyObject },
  projectId: { type: ['integer', 'null'], minimum: 1 },
  gridId: { ...nullableText, maxLength: 100 },
  steps: { type: 'array', maxItems: 200, items: anyObject },
};
const datasetFields = {
  name: { ...text, pattern: '^[a-z][a-z0-9_]{0,49}$' },
  description: { ...nullableText, maxLength: 500 },
  columns: {
    type: 'array',
    minItems: 1,
    maxItems: 50,
    uniqueItems: true,
    items: { ...text, pattern: '^[A-Za-z_][A-Za-z0-9_]{0,49}$' },
  },
  rows: {
    type: 'array',
    minItems: 1,
    maxItems: 1000,
    items: { type: 'object', additionalProperties: { ...text, maxLength: 10000 } },
  },
};
const selectedTests = {
  type: 'array',
  maxItems: 2000,
  items: object({ id: integer, type: { ...text, enum: ['ui', 'api', 'mobile'] } }, ['id', 'type']),
};
const planFields = {
  name: { ...text, minLength: 1, maxLength: 200 },
  description: { ...nullableText, maxLength: 2000 },
  selectedTests,
  maxParallelTests: { type: 'integer', minimum: 1, maximum: 16 },
  shards: { type: 'integer', minimum: 1, maximum: 8 },
  pageLoadTimeout: { type: 'integer', minimum: 1000, maximum: 600000 },
  elementTimeout: { type: 'integer', minimum: 1000, maximum: 600000 },
  captureScreenshots: { ...text, enum: ['never', 'on_failed_steps', 'always'] },
  captureVideo: { ...text, enum: ['never', 'on_failure', 'always'] },
  captureTrace: { ...text, enum: ['never', 'on_failure', 'always'] },
  agentPool: { ...nullableText, pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
  locales: {
    type: 'array',
    maxItems: 10,
    items: { ...text, description: 'Valid BCP 47 locale, canonicalized and deduplicated on save.' },
  },
};

export const authoringSchemas = {
  ProjectInput: object(projectFields, ['name']),
  ProjectPatch: object(projectFields, ['name']),
  Project: object({
    id: integer,
    ...projectFields,
    restricted: { type: 'boolean' },
    createdAt: date,
  }),
  TestInput: object(testFields, ['name', 'url', 'sequence']),
  TestPatch: object(testFields),
  AuthoredTest: object({
    id: integer,
    ...testFields,
    createdAt: date,
    updatedAt: date,
    publishedVersion: { type: ['integer', 'null'] },
  }),
  ApiTestInput: object(apiTestFields, ['name', 'method', 'url']),
  ApiTestPatch: object(apiTestFields),
  AuthoredApiTest: object({
    id: integer,
    ...apiTestFields,
    createdAt: date,
    updatedAt: date,
    publishedVersion: { type: ['integer', 'null'] },
  }),
  MobileTestInput: object(mobileTestFields, ['name', 'platform', 'app', 'deviceName', 'steps']),
  MobileTestPatch: object(mobileTestFields),
  AuthoredMobileTest: object({
    id: integer,
    ...mobileTestFields,
    createdAt: date,
    updatedAt: date,
    publishedVersion: { type: ['integer', 'null'] },
  }),
  DatasetInput: object(datasetFields, ['name', 'columns', 'rows']),
  Dataset: object({ id: integer, ...datasetFields, createdAt: date, updatedAt: date }),
  PlanInput: object(planFields, ['name']),
  PlanPatch: object(planFields),
  AuthoredPlan: object({ id: text, ...planFields, createdAt: date, updatedAt: date }),
  SuiteExportInput: object(
    {
      projectId: integer,
      format: { ...text, enum: ['json', 'yaml', 'gherkin'], default: 'json' },
      include: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        default: ['tests'],
        items: { ...text, enum: ['tests', 'apiTests', 'mobileTests'] },
        description:
          'apiTests also needs api-tests:read, mobileTests mobile-tests:read; Gherkin carries tests only.',
      },
    },
    ['projectId'],
  ),
  SuiteExport: object({
    format: { ...text, enum: ['json', 'yaml', 'gherkin'] },
    content: text,
    fileName: text,
    secretsReplaced: { type: 'array', items: text },
    withReferences: { type: 'array', items: text },
  }),
  SuiteImportInput: object(
    {
      projectId: integer,
      content: { ...text, minLength: 1, maxLength: 2000000 },
      format: { ...text, enum: ['json', 'yaml', 'gherkin'] },
      dryRun: { type: 'boolean', default: false },
    },
    ['projectId', 'content'],
  ),
  SuiteImport: object(
    {
      dryRun: { type: 'boolean' },
      results: {
        type: 'array',
        items: object(
          {
            kind: { ...text, enum: ['test', 'api_test', 'mobile_test', 'mobile_step_group'] },
            name: text,
            id: integer,
            outcome: { ...text, enum: ['created', 'updated', 'unchanged'] },
          },
          ['kind', 'name', 'outcome'],
        ),
      },
    },
    ['dryRun', 'results'],
  ),
};

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});
const page = (item: string) =>
  object(
    {
      items: { type: 'array', items: ref(item) },
      limit: integer,
      offset: { type: 'integer', minimum: 0 },
    },
    ['items', 'limit', 'offset'],
  );
const pagination = [
  { name: 'limit', in: 'query', schema: { ...integer, maximum: 100, default: 20 } },
  { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
];
type OperationOptions = {
  id: string;
  scope: ApiScope;
  response?: string;
  input?: string;
  status?: number;
  parameters?: unknown[];
  summary: string;
  list?: boolean;
};
function operation({
  id,
  scope,
  response,
  input,
  status = 200,
  parameters = [],
  summary,
  list,
}: OperationOptions) {
  return {
    operationId: id,
    summary,
    security: [{ bearerKey: [] }, { headerKey: [] }],
    'x-required-scope': scope,
    parameters,
    ...(input
      ? { requestBody: { required: true, content: { 'application/json': { schema: ref(input) } } } }
      : {}),
    responses: {
      ...(input === 'SuiteImportInput'
        ? {
            '200': {
              description: 'Validated dry run; no writes.',
              content: { 'application/json': { schema: ref('SuiteImport') } },
            },
          }
        : {}),
      [String(status)]: {
        description: 'Success.',
        ...(response
          ? { content: { 'application/json': { schema: list ? page(response) : ref(response) } } }
          : {}),
      },
      '400': error('Invalid body, identifier or referenced resource.'),
      '401': error('No usable credential.'),
      '403': error('Insufficient scope, role or project access.'),
      '404': error('No such resource visible to this account.'),
      '409': error('Name conflict or dataset still in use.'),
      '429': error('Rate limit or tenant quota exceeded.'),
      '500': error('The operation failed; writes are rolled back.'),
    },
  };
}
const idParameter = (name: string, string = false) => [
  { name, in: 'path', required: true, schema: string ? text : integer },
];
export const authoringPaths = {
  '/api/v1/projects': {
    get: operation({
      id: 'listProjects',
      scope: 'projects:read',
      response: 'Project',
      list: true,
      parameters: pagination,
      summary: 'List visible projects.',
    }),
    post: operation({
      id: 'createProject',
      scope: 'projects:write',
      input: 'ProjectInput',
      response: 'Project',
      status: 201,
      summary: 'Create an open project.',
    }),
  },
  '/api/v1/projects/{projectId}': {
    get: operation({
      id: 'getProject',
      scope: 'projects:read',
      response: 'Project',
      parameters: idParameter('projectId'),
      summary: 'Read a visible project.',
    }),
    patch: operation({
      id: 'updateProject',
      scope: 'projects:write',
      input: 'ProjectPatch',
      response: 'Project',
      parameters: idParameter('projectId'),
      summary: 'Update project name or description.',
    }),
  },
  '/api/v1/tests': {
    get: operation({
      id: 'listTests',
      scope: 'tests:read',
      response: 'AuthoredTest',
      list: true,
      parameters: [...pagination, { name: 'projectId', in: 'query', schema: integer }],
      summary: 'List visible web, manual and BDD tests.',
    }),
    post: operation({
      id: 'createTest',
      scope: 'tests:write',
      input: 'TestInput',
      response: 'AuthoredTest',
      status: 201,
      summary: 'Create a test and its first version.',
    }),
  },
  '/api/v1/tests/{testId}': {
    get: operation({
      id: 'getTest',
      scope: 'tests:read',
      response: 'AuthoredTest',
      parameters: idParameter('testId'),
      summary: 'Read a visible test definition.',
    }),
    patch: operation({
      id: 'updateTest',
      scope: 'tests:write',
      input: 'TestPatch',
      response: 'AuthoredTest',
      parameters: idParameter('testId'),
      summary: 'Update the working copy and record a version.',
    }),
  },
  '/api/v1/api-tests': {
    get: operation({
      id: 'listApiTests',
      scope: 'api-tests:read',
      response: 'AuthoredApiTest',
      list: true,
      parameters: [...pagination, { name: 'projectId', in: 'query', schema: integer }],
      summary: 'List visible API tests, literal secrets replaced by variables.',
    }),
    post: operation({
      id: 'createApiTest',
      scope: 'api-tests:write',
      input: 'ApiTestInput',
      response: 'AuthoredApiTest',
      status: 201,
      summary: 'Create an API test and its first version.',
    }),
  },
  '/api/v1/api-tests/{apiTestId}': {
    get: operation({
      id: 'getApiTest',
      scope: 'api-tests:read',
      response: 'AuthoredApiTest',
      parameters: idParameter('apiTestId'),
      summary: 'Read a visible API test definition.',
    }),
    patch: operation({
      id: 'updateApiTest',
      scope: 'api-tests:write',
      input: 'ApiTestPatch',
      response: 'AuthoredApiTest',
      parameters: idParameter('apiTestId'),
      summary: 'Update an API test and record a version.',
    }),
  },
  '/api/v1/mobile-tests': {
    get: operation({
      id: 'listMobileTests',
      scope: 'mobile-tests:read',
      response: 'AuthoredMobileTest',
      list: true,
      parameters: [...pagination, { name: 'projectId', in: 'query', schema: integer }],
      summary: 'List visible native mobile tests.',
    }),
    post: operation({
      id: 'createMobileTest',
      scope: 'mobile-tests:write',
      input: 'MobileTestInput',
      response: 'AuthoredMobileTest',
      status: 201,
      summary: 'Create a mobile test and its first version.',
    }),
  },
  '/api/v1/mobile-tests/{mobileTestId}': {
    get: operation({
      id: 'getMobileTest',
      scope: 'mobile-tests:read',
      response: 'AuthoredMobileTest',
      parameters: idParameter('mobileTestId'),
      summary: 'Read a visible mobile test definition.',
    }),
    patch: operation({
      id: 'updateMobileTest',
      scope: 'mobile-tests:write',
      input: 'MobileTestPatch',
      response: 'AuthoredMobileTest',
      parameters: idParameter('mobileTestId'),
      summary: 'Update a mobile test, checked as a whole, and record a version.',
    }),
  },
  '/api/v1/datasets': {
    get: operation({
      id: 'listDatasets',
      scope: 'datasets:read',
      response: 'Dataset',
      list: true,
      parameters: pagination,
      summary: 'List shared datasets.',
    }),
    post: operation({
      id: 'createDataset',
      scope: 'datasets:write',
      input: 'DatasetInput',
      response: 'Dataset',
      status: 201,
      summary: 'Create a shared dataset.',
    }),
  },
  '/api/v1/datasets/{datasetId}': {
    get: operation({
      id: 'getDataset',
      scope: 'datasets:read',
      response: 'Dataset',
      parameters: idParameter('datasetId'),
      summary: 'Read a shared dataset.',
    }),
    put: operation({
      id: 'replaceDataset',
      scope: 'datasets:write',
      input: 'DatasetInput',
      response: 'Dataset',
      parameters: idParameter('datasetId'),
      summary: 'Replace a shared dataset.',
    }),
    delete: operation({
      id: 'deleteDataset',
      scope: 'datasets:write',
      status: 204,
      parameters: idParameter('datasetId'),
      summary: 'Delete a dataset unused by tests.',
    }),
  },
  '/api/v1/plans': {
    post: operation({
      id: 'createPlan',
      scope: 'plans:write',
      input: 'PlanInput',
      response: 'AuthoredPlan',
      status: 201,
      summary: 'Provision a plan with visible typed test references.',
    }),
  },
  '/api/v1/plans/{planId}': {
    get: operation({
      id: 'getPlan',
      scope: 'plans:read',
      response: 'AuthoredPlan',
      parameters: idParameter('planId', true),
      summary: 'Read a plan and its selected tests.',
    }),
    patch: operation({
      id: 'updatePlan',
      scope: 'plans:write',
      input: 'PlanPatch',
      response: 'AuthoredPlan',
      parameters: idParameter('planId', true),
      summary: 'Update a plan and replace its test selection.',
    }),
  },
  '/api/v1/suites/export': {
    post: operation({
      id: 'exportSuite',
      scope: 'suites:read',
      input: 'SuiteExportInput',
      response: 'SuiteExport',
      summary: 'Export project tests using the versioned suite bundle.',
    }),
  },
  '/api/v1/suites/import': {
    post: operation({
      id: 'importSuite',
      scope: 'suites:write',
      input: 'SuiteImportInput',
      response: 'SuiteImport',
      status: 201,
      summary: 'Validate or transactionally import a suite into a project.',
    }),
  },
};

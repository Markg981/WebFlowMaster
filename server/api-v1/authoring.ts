import type { Router, Request, Response, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, eq, ne, sql } from 'drizzle-orm';
import {
  projects,
  projectMembers,
  tests,
  apiTests,
  mobileTests,
  mobileStepGroups,
  browserGrids,
  testDataSets,
  testPlans,
  testPlanSelectedTests,
  insertTestSchema,
  insertApiTestSchema,
  insertTestPlanSchema,
  AUDIT_ACTIONS,
  type Test,
  type ApiTest,
  type MobileTest,
  type Project,
  type TestDataSet,
  type TestPlan,
} from '@shared/schema';
import { testDataSetInputSchema, sharedSetIdOf } from '@shared/test-data';
import { manualSequenceProblem } from '@shared/manual-tests';
import { MOBILE_GRID_PROVIDERS, mobileTestFieldsSchema, refineMobileTest } from '@shared/mobile';
import { type ApiScope } from '@shared/api-scopes';
import { apiError, holdsScope, requireScope } from '../middleware/require-scope';
import {
  withTenantTransaction,
  runAsOrganization,
  getTenantOrgId,
  type TenantTx,
} from '../middleware/tenancy';
import { auditActor, recordAudit } from '../audit';
import { recordTestVersion, recordTypedTestVersion } from '../test-version-store';
import { BddDefinitionError, prepareBddForSave } from '../bdd-definition';
import { assertSelectedTestsBelongTo, SELECTED_TESTS_NOT_FOUND } from '../routes/selected-tests';
import { testsUsingSet } from '../test-data';
import {
  exportBundle,
  parseBundle,
  sameAs,
  withoutSecrets,
  keepRedactedSecrets,
  API_TEST_FIELDS,
  BundleError,
} from '../test-bundle';
import { importMobileCatalog, MOBILE_BUNDLE_FIELDS } from '../mobile-bundle';
import { prepareMobileSteps, MobileDefinitionError } from '../mobile-step-groups';
import { GherkinError } from '../gherkin';
import { lockOrganizationRuns, quotaErrorBody } from '../tenant-quotas';

const numericId = z.coerce.number().int().positive();
export const projectCreateSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();
export const projectUpdateSchema = projectCreateSchema;
// The allowlist is deliberate: a new column must not silently enlarge the public API.
export const testCreateSchema = insertTestSchema
  .pick({
    name: true,
    url: true,
    sequence: true,
    elements: true,
    projectId: true,
    bdd: true,
    preconditions: true,
    cleanups: true,
    dataset: true,
    status: true,
    module: true,
    featureArea: true,
    scenario: true,
    component: true,
    priority: true,
    severity: true,
  })
  .extend({
    name: z.string().trim().min(1).max(200),
    url: z.string().max(4000),
    sequence: z.array(z.record(z.unknown())).max(2000),
    elements: z.array(z.record(z.unknown())).max(2000).default([]),
    projectId: z.number().int().positive().nullable().optional(),
    status: z.enum(['draft', 'ready', 'archived']).optional(),
  })
  .strict();
export const testUpdateSchema = testCreateSchema
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field.');
const atLeastOneField = (body: object) => Object.keys(body).length > 0;
export const apiTestCreateSchema = insertApiTestSchema
  .pick({
    name: true,
    method: true,
    url: true,
    module: true,
    featureArea: true,
    scenario: true,
    component: true,
    priority: true,
    severity: true,
    queryParams: true,
    requestHeaders: true,
    requestBody: true,
    assertions: true,
    extractions: true,
    performance: true,
    authType: true,
    authParams: true,
    bodyType: true,
    bodyRawContentType: true,
    bodyFormData: true,
    bodyUrlEncoded: true,
    bodyGraphqlQuery: true,
    bodyGraphqlVariables: true,
    protoDefinition: true,
    protocolConfig: true,
  })
  .extend({
    name: z.string().trim().min(1).max(200),
    method: z.string().trim().min(1).max(20),
    projectId: z.number().int().positive().nullable().optional(),
  })
  .strict();
export const apiTestUpdateSchema = apiTestCreateSchema
  .partial()
  .strict()
  .refine(atLeastOneField, 'Send at least one field.');
export const mobileTestCreateSchema = mobileTestFieldsSchema.strict().superRefine(refineMobileTest);
export const mobileTestUpdateSchema = mobileTestFieldsSchema
  .partial()
  .strict()
  .refine(atLeastOneField, 'Send at least one field.');
export const datasetCreateSchema = testDataSetInputSchema;
export const datasetUpdateSchema = testDataSetInputSchema;
const membershipSchema = z
  .array(
    z.object({ id: z.number().int().positive(), type: z.enum(['ui', 'api', 'mobile']) }).strict(),
  )
  .max(2000)
  .refine(
    (list) => new Set(list.map((test) => `${test.type}:${test.id}`)).size === list.length,
    'A test is listed twice.',
  );
export const planCreateSchema = insertTestPlanSchema
  .pick({
    name: true,
    description: true,
    maxParallelTests: true,
    shards: true,
    pageLoadTimeout: true,
    elementTimeout: true,
    captureScreenshots: true,
    captureVideo: true,
    captureTrace: true,
    agentPool: true,
    locales: true,
  })
  .extend({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    selectedTests: membershipSchema.default([]),
  })
  .strict();
export const planUpdateSchema = planCreateSchema
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field.');
/** The kinds of test a suite can carry; an export holds the UI, manual and BDD tests unless asked. */
export const SUITE_KINDS = ['tests', 'apiTests', 'mobileTests'] as const;
export const suiteExportSchema = z
  .object({
    projectId: z.number().int().positive(),
    format: z.enum(['json', 'yaml', 'gherkin']).default('json'),
    include: z.array(z.enum(SUITE_KINDS)).min(1).max(3).default(['tests']),
  })
  .strict();
export const suiteImportSchema = z
  .object({
    projectId: z.number().int().positive(),
    content: z.string().min(1).max(2_000_000),
    format: z.enum(['json', 'yaml', 'gherkin']).optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();
export const authoringSchemas = {
  projectCreateSchema,
  projectUpdateSchema,
  testCreateSchema,
  testUpdateSchema,
  apiTestCreateSchema,
  apiTestUpdateSchema,
  mobileTestCreateSchema,
  mobileTestUpdateSchema,
  datasetCreateSchema,
  datasetUpdateSchema,
  planCreateSchema,
  planUpdateSchema,
  suiteExportSchema,
  suiteImportSchema,
};

export function publicProject(row: Project) {
  return { id: row.id, name: row.name, restricted: row.restricted, createdAt: row.createdAt };
}
export function publicTest(row: Test) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    url: row.url,
    sequence: row.sequence,
    elements: row.elements,
    bdd: row.bdd,
    preconditions: row.preconditions,
    cleanups: row.cleanups,
    dataset: row.dataset,
    status: row.status,
    publishedVersion: row.publishedVersion,
    module: row.module,
    featureArea: row.featureArea,
    scenario: row.scenario,
    component: row.component,
    priority: row.priority,
    severity: row.severity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
/** Literal secrets in the authorization read as the variables an export writes (test-bundle.ts). */
export function publicApiTest(row: ApiTest) {
  const fields = Object.fromEntries(
    API_TEST_FIELDS.map((field) => [field, (row as Record<string, unknown>)[field] ?? null]),
  );
  return {
    id: row.id,
    projectId: row.projectId,
    ...withoutSecrets(fields, []),
    publishedVersion: row.publishedVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export function publicMobileTest(row: MobileTest) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    platform: row.platform,
    app: row.app,
    deviceName: row.deviceName,
    osVersion: row.osVersion,
    deviceMatrix: row.deviceMatrix,
    gridId: row.gridId,
    steps: row.steps,
    publishedVersion: row.publishedVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export function publicDataset(row: TestDataSet) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    columns: row.columns,
    rows: row.rows,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export function publicPlan(row: TestPlan, selectedTests: z.infer<typeof membershipSchema>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    selectedTests,
    maxParallelTests: row.maxParallelTests,
    shards: row.shards,
    pageLoadTimeout: row.pageLoadTimeout,
    elementTimeout: row.elementTimeout,
    captureScreenshots: row.captureScreenshots,
    captureVideo: row.captureVideo,
    captureTrace: row.captureTrace,
    agentPool: row.agentPool,
    locales: row.locales,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

class AuthoringError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
/** A second scope the request needs for part of its work, on top of the route's own. */
function requireAlso(req: Request, scope: ApiScope) {
  if (!holdsScope(req, scope))
    throw new AuthoringError(
      403,
      'insufficient_scope',
      `This API key does not have the "${scope}" scope.`,
      { requiredScope: scope },
    );
}
function notFound(kind: string): never {
  throw new AuthoringError(
    404,
    `${kind}_not_found`,
    `There is no such ${kind.replace('api_', 'API ').replace('_', ' ')} in this organization.`,
  );
}
function idOf(req: Request, name: string) {
  const id = numericId.safeParse(req.params[name]);
  if (!id.success)
    throw new AuthoringError(400, 'invalid_request', 'The identifier must be a positive integer.');
  return id.data;
}
function body<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  return valid(schema, req.body);
}
function valid<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AuthoringError(
      400,
      'invalid_request',
      result.error.issues[0]?.message ?? 'Invalid request.',
    );
  return result.data;
}
function page(req: Request) {
  const parsed = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .safeParse(req.query);
  if (!parsed.success) throw new AuthoringError(400, 'invalid_request', 'Invalid pagination.');
  return parsed.data;
}
function handled(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof AuthoringError) {
        apiError(res, error.status, error.code, error.message, error.extra);
        return;
      }
      const quota = quotaErrorBody(error);
      if (quota) {
        apiError(res, 429, String(quota.code), String(quota.error));
        return;
      }
      if (
        error instanceof z.ZodError ||
        error instanceof GherkinError ||
        error instanceof BddDefinitionError ||
        error instanceof MobileDefinitionError ||
        error instanceof BundleError ||
        SELECTED_TESTS_NOT_FOUND.test((error as Error).message ?? '')
      ) {
        apiError(res, 400, 'invalid_request', (error as Error).message);
        return;
      }
      const cause = error as { cause?: { code?: string }; code?: string };
      if ((cause.cause?.code ?? cause.code) === '42501') {
        apiError(res, 403, 'project_read_only', 'The project does not allow this change.');
        return;
      }
      if ((cause.cause?.code ?? cause.code) === '23505') {
        apiError(res, 409, 'name_conflict', 'This name already exists.');
        return;
      }
      apiError(res, 500, 'internal_error', 'The authoring operation could not be completed.');
    }
  };
}
async function editableProject(tx: TenantTx, req: Request, id: number | null | undefined) {
  if (id == null) return;
  const [project] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) notFound('project');
  if (project.restricted && req.user!.role !== 'owner') {
    const [member] = await tx
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, req.user!.id)))
      .limit(1);
    if (member?.role !== 'editor')
      throw new AuthoringError(403, 'project_read_only', 'The project does not allow this change.');
  }
}
async function saveTest(
  tx: TenantTx,
  req: Request,
  input: z.infer<typeof testCreateSchema> | z.infer<typeof testUpdateSchema>,
  existing?: Test,
) {
  await editableProject(tx, req, existing?.projectId);
  await editableProject(tx, req, input.projectId);
  const problem = manualSequenceProblem(input.sequence);
  if (problem) throw new AuthoringError(400, 'manual_step_empty', problem);
  await validateDataset(tx, input.dataset);
  const name = input.name ?? existing?.name;
  const [duplicate] = await tx
    .select({ id: tests.id })
    .from(tests)
    .where(existing ? and(eq(tests.name, name!), ne(tests.id, existing.id)) : eq(tests.name, name!))
    .limit(1);
  if (duplicate)
    throw new AuthoringError(409, 'name_conflict', 'A test with this name already exists.');
  const definition = await prepareBddForSave(tx, input, existing);
  const [row] = existing
    ? await tx
        .update(tests)
        .set({ ...definition, updatedAt: new Date() })
        .where(eq(tests.id, existing.id))
        .returning()
    : await tx
        .insert(tests)
        .values({
          ...(definition as z.infer<typeof testCreateSchema>),
          userId: req.user!.id,
          organizationId: req.user!.organizationId,
        })
        .returning();
  if (!row)
    throw new AuthoringError(403, 'project_read_only', 'The project does not allow this change.');
  await recordTestVersion(tx, {
    testId: row.id,
    test: row,
    organizationId: req.user!.organizationId,
    userId: req.user!.id,
  });
  await recordAudit(tx, {
    action: existing ? AUDIT_ACTIONS.TEST_UPDATED : AUDIT_ACTIONS.TEST_CREATED,
    actor: auditActor(req),
    targetType: 'test',
    targetId: row.id,
    metadata: { name: row.name },
  });
  return row;
}
async function validateDataset(tx: TenantTx, dataset: unknown) {
  const id = sharedSetIdOf(dataset);
  if (id === null) return;
  const [row] = await tx
    .select({ id: testDataSets.id })
    .from(testDataSets)
    .where(eq(testDataSets.id, id))
    .limit(1);
  if (!row)
    throw new AuthoringError(
      400,
      'invalid_request',
      'The referenced dataset does not exist in this organization.',
    );
}
async function saveApiTest(
  tx: TenantTx,
  req: Request,
  input: z.infer<typeof apiTestCreateSchema> | z.infer<typeof apiTestUpdateSchema>,
  existing?: ApiTest,
) {
  await editableProject(tx, req, existing?.projectId);
  await editableProject(tx, req, input.projectId);
  const name = input.name ?? existing?.name;
  const [duplicate] = await tx
    .select({ id: apiTests.id })
    .from(apiTests)
    .where(
      existing ? and(eq(apiTests.name, name!), ne(apiTests.id, existing.id)) : eq(apiTests.name, name!),
    )
    .limit(1);
  if (duplicate)
    throw new AuthoringError(409, 'name_conflict', 'An API test with this name already exists.');
  const fields =
    existing && input.authParams !== undefined
      ? { ...input, authParams: keepRedactedSecrets(input.authParams, existing.authParams) }
      : input;
  const [row] = existing
    ? await tx
        .update(apiTests)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(apiTests.id, existing.id))
        .returning()
    : await tx
        .insert(apiTests)
        .values({
          ...(fields as z.infer<typeof apiTestCreateSchema>),
          userId: req.user!.id,
          organizationId: req.user!.organizationId,
        })
        .returning();
  if (!row)
    throw new AuthoringError(403, 'project_read_only', 'The project does not allow this change.');
  await recordTypedTestVersion(tx, {
    testType: 'api',
    testId: row.id,
    organizationId: req.user!.organizationId,
    userId: req.user!.id,
    test: row,
  });
  await recordAudit(tx, {
    action: existing ? AUDIT_ACTIONS.API_TEST_UPDATED : AUDIT_ACTIONS.API_TEST_CREATED,
    actor: auditActor(req),
    targetType: 'api_test',
    targetId: row.id,
    // Names only: an API test's headers and body are exactly where tokens live.
    metadata: existing ? { name: row.name, fields: Object.keys(input) } : { name: row.name },
  });
  return row;
}
async function saveMobileTest(
  tx: TenantTx,
  req: Request,
  input: z.infer<typeof mobileTestCreateSchema>,
  existing?: MobileTest,
) {
  await editableProject(tx, req, existing?.projectId);
  await editableProject(tx, req, input.projectId);
  const [duplicate] = await tx
    .select({ id: mobileTests.id })
    .from(mobileTests)
    .where(
      existing
        ? sql`lower(${mobileTests.name}) = lower(${input.name}) AND ${mobileTests.id} <> ${existing.id}`
        : sql`lower(${mobileTests.name}) = lower(${input.name})`,
    )
    .limit(1);
  if (duplicate)
    throw new AuthoringError(409, 'name_conflict', 'A mobile test with this name already exists.');
  if (input.gridId) {
    const [grid] = await tx
      .select({ provider: browserGrids.provider })
      .from(browserGrids)
      .where(eq(browserGrids.id, input.gridId))
      .limit(1);
    if (!grid || !(MOBILE_GRID_PROVIDERS as readonly string[]).includes(grid.provider))
      throw new AuthoringError(
        400,
        'invalid_request',
        'The grid must be a BrowserStack or LambdaTest grid of this organization.',
      );
  }
  await lockOrganizationRuns(tx, getTenantOrgId()!);
  await prepareMobileSteps(tx, input);
  const fields = {
    ...input,
    osVersion: input.osVersion || null,
    gridId: input.gridId || null,
    projectId: input.projectId ?? null,
  };
  const [row] = existing
    ? await tx
        .update(mobileTests)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(mobileTests.id, existing.id))
        .returning()
    : await tx
        .insert(mobileTests)
        .values({ ...fields, organizationId: req.user!.organizationId, createdBy: req.user!.id })
        .returning();
  if (!row)
    throw new AuthoringError(403, 'project_read_only', 'The project does not allow this change.');
  await recordTypedTestVersion(tx, {
    testType: 'mobile',
    testId: row.id,
    organizationId: req.user!.organizationId,
    userId: req.user!.id,
    test: row,
  });
  await recordAudit(tx, {
    action: existing ? AUDIT_ACTIONS.MOBILE_TEST_UPDATED : AUDIT_ACTIONS.MOBILE_TEST_CREATED,
    actor: auditActor(req),
    targetType: 'mobile_test',
    targetId: row.id,
    metadata: { name: row.name, platform: row.platform },
  });
  return row;
}
/** A mobile test's stored definition as the create schema reads it, for a patch to land on. */
function mobileDefinitionOf(row: MobileTest) {
  return {
    ...Object.fromEntries(MOBILE_BUNDLE_FIELDS.map((field) => [field, row[field]])),
    projectId: row.projectId,
    gridId: row.gridId,
  };
}
async function members(tx: TenantTx, planId: string) {
  return (
    await tx
      .select()
      .from(testPlanSelectedTests)
      .where(eq(testPlanSelectedTests.testPlanId, planId))
      .orderBy(testPlanSelectedTests.id)
  ).map((row) => ({
    type: row.testType as 'ui' | 'api' | 'mobile',
    id: (row.testType === 'ui'
      ? row.testId
      : row.testType === 'api'
        ? row.apiTestId
        : row.mobileTestId)!,
  }));
}
async function replaceMembers(
  tx: TenantTx,
  req: Request,
  planId: string,
  selected: z.infer<typeof membershipSchema>,
) {
  await assertSelectedTestsBelongTo(tx, req.user!.organizationId, selected);
  await tx.delete(testPlanSelectedTests).where(eq(testPlanSelectedTests.testPlanId, planId));
  if (selected.length)
    await tx.insert(testPlanSelectedTests).values(
      selected.map((test) => ({
        organizationId: req.user!.organizationId,
        testPlanId: planId,
        testType: test.type,
        testId: test.type === 'ui' ? test.id : null,
        apiTestId: test.type === 'api' ? test.id : null,
        mobileTestId: test.type === 'mobile' ? test.id : null,
      })),
    );
}

export const authoringOperations: Array<{
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  scope: ApiScope;
  body?: keyof typeof authoringSchemas;
  response: string;
  status: number;
}> = [];
export function registerAuthoringRoutes(router: Router) {
  function route(
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    scope: ApiScope,
    handler: (req: Request, res: Response) => Promise<unknown>,
    response: string,
    status = 200,
    schema?: keyof typeof authoringSchemas,
  ) {
    authoringOperations.push({
      method,
      path,
      scope,
      response,
      status,
      ...(schema ? { body: schema } : {}),
    });
    router[method](path, requireScope(scope), handled(handler));
  }
  route(
    'get',
    '/api/v1/projects',
    'projects:read',
    async (req, res) => {
      const p = page(req);
      const rows = await withTenantTransaction((tx) =>
        tx.select().from(projects).orderBy(projects.id).limit(p.limit).offset(p.offset),
      );
      res.json({ items: rows.map(publicProject), ...p });
    },
    'ProjectPage',
  );
  route(
    'post',
    '/api/v1/projects',
    'projects:write',
    async (req, res) => {
      const input = body(projectCreateSchema, req);
      const row = await withTenantTransaction(async (tx) => {
        const [row] = await tx
          .insert(projects)
          .values({ ...input, userId: req.user!.id, organizationId: req.user!.organizationId })
          .returning();
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.PROJECT_CREATED,
          actor: auditActor(req),
          targetType: 'project',
          targetId: row.id,
          metadata: { name: row.name },
        });
        return row;
      });
      res.status(201).json(publicProject(row));
    },
    'Project',
    201,
    'projectCreateSchema',
  );
  route(
    'get',
    '/api/v1/projects/:projectId',
    'projects:read',
    async (req, res) => {
      const id = idOf(req, 'projectId');
      const [row] = await withTenantTransaction((tx) =>
        tx.select().from(projects).where(eq(projects.id, id)).limit(1),
      );
      if (!row) notFound('project');
      res.json(publicProject(row));
    },
    'Project',
  );
  route(
    'patch',
    '/api/v1/projects/:projectId',
    'projects:write',
    async (req, res) => {
      const id = idOf(req, 'projectId'),
        input = body(projectUpdateSchema, req);
      const row = await withTenantTransaction(async (tx) => {
        await editableProject(tx, req, id);
        const [row] = await tx.update(projects).set(input).where(eq(projects.id, id)).returning();
        if (!row)
          throw new AuthoringError(
            403,
            'project_read_only',
            'The project does not allow this change.',
          );
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.PROJECT_UPDATED,
          actor: auditActor(req),
          targetType: 'project',
          targetId: id,
          metadata: { field: 'name', name: row.name },
        });
        return row;
      });
      res.json(publicProject(row));
    },
    'Project',
    200,
    'projectUpdateSchema',
  );
  route(
    'get',
    '/api/v1/tests',
    'tests:read',
    async (req, res) => {
      const p = page(req);
      const filter =
        req.query.projectId === undefined
          ? undefined
          : eq(tests.projectId, numericId.parse(req.query.projectId));
      const rows = await withTenantTransaction((tx) =>
        tx.select().from(tests).where(filter).orderBy(tests.id).limit(p.limit).offset(p.offset),
      );
      res.json({ items: rows.map(publicTest), ...p });
    },
    'TestPage',
  );
  route(
    'get',
    '/api/v1/tests/:testId',
    'tests:read',
    async (req, res) => {
      const id = idOf(req, 'testId');
      const [row] = await withTenantTransaction((tx) =>
        tx.select().from(tests).where(eq(tests.id, id)).limit(1),
      );
      if (!row) notFound('test');
      res.json(publicTest(row));
    },
    'AuthoringTest',
  );
  route(
    'post',
    '/api/v1/tests',
    'tests:write',
    async (req, res) => {
      const input = body(testCreateSchema, req);
      res
        .status(201)
        .json(publicTest(await withTenantTransaction((tx) => saveTest(tx, req, input))));
    },
    'AuthoringTest',
    201,
    'testCreateSchema',
  );
  route(
    'patch',
    '/api/v1/tests/:testId',
    'tests:write',
    async (req, res) => {
      const id = idOf(req, 'testId'),
        input = body(testUpdateSchema, req);
      const row = await withTenantTransaction(async (tx) => {
        const [existing] = await tx.select().from(tests).where(eq(tests.id, id)).limit(1);
        if (!existing) notFound('test');
        return saveTest(tx, req, input, existing);
      });
      res.json(publicTest(row));
    },
    'AuthoringTest',
    200,
    'testUpdateSchema',
  );
  route(
    'get',
    '/api/v1/api-tests',
    'api-tests:read',
    async (req, res) => {
      const p = page(req);
      const filter =
        req.query.projectId === undefined
          ? undefined
          : eq(apiTests.projectId, valid(numericId, req.query.projectId));
      const rows = await withTenantTransaction((tx) =>
        tx
          .select()
          .from(apiTests)
          .where(filter)
          .orderBy(apiTests.id)
          .limit(p.limit)
          .offset(p.offset),
      );
      res.json({ items: rows.map(publicApiTest), ...p });
    },
    'ApiTestPage',
  );
  route(
    'get',
    '/api/v1/api-tests/:apiTestId',
    'api-tests:read',
    async (req, res) => {
      const id = idOf(req, 'apiTestId');
      const [row] = await withTenantTransaction((tx) =>
        tx.select().from(apiTests).where(eq(apiTests.id, id)).limit(1),
      );
      if (!row) notFound('api_test');
      res.json(publicApiTest(row));
    },
    'AuthoredApiTest',
  );
  route(
    'post',
    '/api/v1/api-tests',
    'api-tests:write',
    async (req, res) => {
      const input = body(apiTestCreateSchema, req);
      res
        .status(201)
        .json(publicApiTest(await withTenantTransaction((tx) => saveApiTest(tx, req, input))));
    },
    'AuthoredApiTest',
    201,
    'apiTestCreateSchema',
  );
  route(
    'patch',
    '/api/v1/api-tests/:apiTestId',
    'api-tests:write',
    async (req, res) => {
      const id = idOf(req, 'apiTestId'),
        input = body(apiTestUpdateSchema, req);
      const row = await withTenantTransaction(async (tx) => {
        const [existing] = await tx.select().from(apiTests).where(eq(apiTests.id, id)).limit(1);
        if (!existing) notFound('api_test');
        return saveApiTest(tx, req, input, existing);
      });
      res.json(publicApiTest(row));
    },
    'AuthoredApiTest',
    200,
    'apiTestUpdateSchema',
  );
  route(
    'get',
    '/api/v1/mobile-tests',
    'mobile-tests:read',
    async (req, res) => {
      const p = page(req);
      const filter =
        req.query.projectId === undefined
          ? undefined
          : eq(mobileTests.projectId, valid(numericId, req.query.projectId));
      const rows = await withTenantTransaction((tx) =>
        tx
          .select()
          .from(mobileTests)
          .where(filter)
          .orderBy(mobileTests.id)
          .limit(p.limit)
          .offset(p.offset),
      );
      res.json({ items: rows.map(publicMobileTest), ...p });
    },
    'MobileTestPage',
  );
  route(
    'get',
    '/api/v1/mobile-tests/:mobileTestId',
    'mobile-tests:read',
    async (req, res) => {
      const id = idOf(req, 'mobileTestId');
      const [row] = await withTenantTransaction((tx) =>
        tx.select().from(mobileTests).where(eq(mobileTests.id, id)).limit(1),
      );
      if (!row) notFound('mobile_test');
      res.json(publicMobileTest(row));
    },
    'AuthoredMobileTest',
  );
  route(
    'post',
    '/api/v1/mobile-tests',
    'mobile-tests:write',
    async (req, res) => {
      const input = body(mobileTestCreateSchema, req);
      res
        .status(201)
        .json(
          publicMobileTest(await withTenantTransaction((tx) => saveMobileTest(tx, req, input))),
        );
    },
    'AuthoredMobileTest',
    201,
    'mobileTestCreateSchema',
  );
  route(
    'patch',
    '/api/v1/mobile-tests/:mobileTestId',
    'mobile-tests:write',
    async (req, res) => {
      const id = idOf(req, 'mobileTestId'),
        input = body(mobileTestUpdateSchema, req);
      const row = await withTenantTransaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(mobileTests)
          .where(eq(mobileTests.id, id))
          .limit(1);
        if (!existing) notFound('mobile_test');
        // A partial change is checked as the whole test it makes: steps against the platform.
        const merged = valid(mobileTestCreateSchema, { ...mobileDefinitionOf(existing), ...input });
        return saveMobileTest(tx, req, merged, existing);
      });
      res.json(publicMobileTest(row));
    },
    'AuthoredMobileTest',
    200,
    'mobileTestUpdateSchema',
  );
  route(
    'get',
    '/api/v1/datasets',
    'datasets:read',
    async (req, res) => {
      const p = page(req);
      const rows = await withTenantTransaction((tx) =>
        tx.select().from(testDataSets).orderBy(testDataSets.id).limit(p.limit).offset(p.offset),
      );
      res.json({ items: rows.map(publicDataset), ...p });
    },
    'DatasetPage',
  );
  route(
    'get',
    '/api/v1/datasets/:datasetId',
    'datasets:read',
    async (req, res) => {
      const id = idOf(req, 'datasetId');
      const [row] = await withTenantTransaction((tx) =>
        tx.select().from(testDataSets).where(eq(testDataSets.id, id)).limit(1),
      );
      if (!row) notFound('dataset');
      res.json(publicDataset(row));
    },
    'Dataset',
  );
  for (const method of ['post', 'put'] as const)
    route(
      method,
      method === 'post' ? '/api/v1/datasets' : '/api/v1/datasets/:datasetId',
      'datasets:write',
      async (req, res) => {
        const input = body(datasetCreateSchema, req),
          id = method === 'put' ? idOf(req, 'datasetId') : undefined;
        const row = await withTenantTransaction(async (tx) => {
          if (id) {
            const [existing] = await tx.select().from(testDataSets).where(eq(testDataSets.id, id));
            if (!existing) notFound('dataset');
          }
          const [duplicate] = await tx
            .select({ id: testDataSets.id })
            .from(testDataSets)
            .where(
              id
                ? and(eq(testDataSets.name, input.name), ne(testDataSets.id, id))
                : eq(testDataSets.name, input.name),
            )
            .limit(1);
          if (duplicate)
            throw new AuthoringError(
              409,
              'name_conflict',
              'A dataset with this name already exists.',
            );
          const values = {
            ...input,
            description: input.description ?? null,
            rows: input.rows.map((row) =>
              Object.fromEntries(input.columns.map((column) => [column, row[column] ?? ''])),
            ),
          };
          const [row] = id
            ? await tx
                .update(testDataSets)
                .set({ ...values, updatedAt: new Date() })
                .where(eq(testDataSets.id, id))
                .returning()
            : await tx
                .insert(testDataSets)
                .values({ ...values, organizationId: req.user!.organizationId })
                .returning();
          await recordAudit(tx, {
            action: id ? AUDIT_ACTIONS.TEST_DATA_SET_UPDATED : AUDIT_ACTIONS.TEST_DATA_SET_CREATED,
            actor: auditActor(req),
            targetType: 'test_data_set',
            targetId: row.id,
            metadata: { name: row.name, rows: row.rows.length },
          });
          return row;
        });
        res.status(method === 'post' ? 201 : 200).json(publicDataset(row));
      },
      'Dataset',
      method === 'post' ? 201 : 200,
      method === 'post' ? 'datasetCreateSchema' : 'datasetUpdateSchema',
    );
  route(
    'delete',
    '/api/v1/datasets/:datasetId',
    'datasets:write',
    async (req, res) => {
      const id = idOf(req, 'datasetId');
      // Shared datasets are organization resources. Check dependencies across every project;
      // reporting only a boolean keeps restricted test names out of the response.
      await runAsOrganization(req.user!.organizationId, () =>
        withTenantTransaction(async (tx) => {
          const [row] = await tx.select().from(testDataSets).where(eq(testDataSets.id, id));
          if (!row) notFound('dataset');
          if ((await testsUsingSet(tx, id)).length)
            throw new AuthoringError(409, 'dataset_in_use', 'Tests still reference this dataset.');
          await tx.delete(testDataSets).where(eq(testDataSets.id, id));
          await recordAudit(tx, {
            action: AUDIT_ACTIONS.TEST_DATA_SET_DELETED,
            actor: auditActor(req),
            targetType: 'test_data_set',
            targetId: id,
            metadata: { name: row.name },
          });
        }),
      );
      res.status(204).end();
    },
    'Empty',
    204,
  );
  route(
    'get',
    '/api/v1/plans/:planId',
    'plans:read',
    async (req, res) => {
      res.json(
        await withTenantTransaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(testPlans)
            .where(eq(testPlans.id, req.params.planId))
            .limit(1);
          if (!row) notFound('plan');
          return publicPlan(row, await members(tx, row.id));
        }),
      );
    },
    'AuthoringPlan',
  );
  for (const method of ['post', 'patch'] as const)
    route(
      method,
      method === 'post' ? '/api/v1/plans' : '/api/v1/plans/:planId',
      'plans:write',
      async (req, res) => {
        const input = method === 'post' ? body(planCreateSchema, req) : body(planUpdateSchema, req);
        const { selectedTests, ...fields } = input;
        const id = method === 'post' ? randomUUID() : req.params.planId;
        const result = await withTenantTransaction(async (tx) => {
          if (method === 'patch') {
            const [row] = await tx.select().from(testPlans).where(eq(testPlans.id, id)).limit(1);
            if (!row) notFound('plan');
          }
          const [row] =
            method === 'post'
              ? await tx
                  .insert(testPlans)
                  .values({
                    ...(fields as z.infer<typeof planCreateSchema>),
                    id,
                    userId: req.user!.id,
                    organizationId: req.user!.organizationId,
                  })
                  .returning()
              : await tx
                  .update(testPlans)
                  .set({ ...fields, updatedAt: new Date() })
                  .where(eq(testPlans.id, id))
                  .returning();
          if (selectedTests !== undefined) await replaceMembers(tx, req, id, selectedTests);
          await recordAudit(tx, {
            action: method === 'post' ? AUDIT_ACTIONS.PLAN_CREATED : AUDIT_ACTIONS.PLAN_UPDATED,
            actor: auditActor(req),
            targetType: 'test_plan',
            targetId: id,
            metadata: { name: row.name },
          });
          return publicPlan(row, await members(tx, id));
        });
        res.status(method === 'post' ? 201 : 200).json(result);
      },
      'AuthoringPlan',
      method === 'post' ? 201 : 200,
      method === 'post' ? 'planCreateSchema' : 'planUpdateSchema',
    );
  route(
    'post',
    '/api/v1/suites/export',
    'suites:read',
    async (req, res) => {
      const input = body(suiteExportSchema, req);
      const include = new Set(input.include);
      if (input.format === 'gherkin' && (include.has('apiTests') || include.has('mobileTests')))
        throw new AuthoringError(
          400,
          'invalid_request',
          'Gherkin carries UI, manual and BDD tests only; export API and mobile tests as JSON or YAML.',
        );
      if (include.has('apiTests')) requireAlso(req, 'api-tests:read');
      if (include.has('mobileTests')) requireAlso(req, 'mobile-tests:read');
      const result = await withTenantTransaction(async (tx) => {
        const [project] = await tx
          .select()
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .limit(1);
        if (!project) notFound('project');
        const rows = include.has('tests')
          ? await tx.select().from(tests).where(eq(tests.projectId, input.projectId)).limit(501)
          : [];
        const apiRows = include.has('apiTests')
          ? await tx
              .select()
              .from(apiTests)
              .where(eq(apiTests.projectId, input.projectId))
              .limit(501)
          : [];
        const mobileRows = include.has('mobileTests')
          ? await tx
              .select()
              .from(mobileTests)
              .where(eq(mobileTests.projectId, input.projectId))
              .limit(501)
          : [];
        if (rows.length + apiRows.length + mobileRows.length > 500)
          throw new AuthoringError(
            400,
            'suite_too_large',
            'A suite may contain at most 500 tests.',
          );
        // The export keeps only the groups its tests call, and names them by platform and name.
        const groups = mobileRows.length ? await tx.select().from(mobileStepGroups) : [];
        const exported = exportBundle(
          {
            project: project.name,
            tests: rows,
            apiTests: apiRows,
            mobileTests: mobileRows,
            mobileStepGroups: groups,
          },
          input.format,
        );
        if (Buffer.byteLength(exported.content, 'utf8') > 2_000_000)
          throw new AuthoringError(
            400,
            'suite_too_large',
            'A suite may contain at most 2 MB of content.',
          );
        return exported;
      });
      res.json({ format: input.format, ...result });
    },
    'SuiteExport',
    200,
    'suiteExportSchema',
  );
  route(
    'post',
    '/api/v1/suites/import',
    'suites:write',
    async (req, res) => {
      const input = body(suiteImportSchema, req);
      const bundle = parseBundle(input.content, input.format === 'gherkin' ? 'gherkin' : undefined);
      if (
        bundle.tests.length + bundle.apiTests.length + bundle.mobileTests.length > 500 ||
        bundle.mobileStepGroups.length > 500
      )
        throw new AuthoringError(
          400,
          'invalid_request',
          'Import accepts at most 500 tests and 500 mobile step groups.',
        );
      if (bundle.apiTests.length) requireAlso(req, 'api-tests:write');
      if (bundle.mobileTests.length || bundle.mobileStepGroups.length)
        requireAlso(req, 'mobile-tests:write');
      const results = await withTenantTransaction(async (tx) => {
        await editableProject(tx, req, input.projectId);
        const results: Array<{
          kind: 'test' | 'api_test' | 'mobile_test' | 'mobile_step_group';
          name: string;
          id?: number;
          outcome: 'created' | 'updated' | 'unchanged';
        }> = [];
        const seen = new Set<string>();
        for (const raw of bundle.tests) {
          const candidate = testCreateSchema.safeParse({
            ...raw,
            elements: [],
            projectId: input.projectId,
          });
          if (!candidate.success)
            throw new AuthoringError(
              400,
              'invalid_request',
              candidate.error.issues[0]?.message ?? 'Invalid test.',
            );
          if (seen.has(candidate.data.name))
            throw new AuthoringError(400, 'invalid_request', 'A test name is listed twice.');
          seen.add(candidate.data.name);
          const [existing] = await tx
            .select()
            .from(tests)
            .where(eq(tests.name, candidate.data.name))
            .limit(1);
          if (existing && existing.projectId !== input.projectId)
            throw new AuthoringError(
              409,
              'name_conflict',
              'A test with this name belongs to another accessible project.',
            );
          const problem = manualSequenceProblem(candidate.data.sequence);
          if (problem) throw new AuthoringError(400, 'manual_step_empty', problem);
          await validateDataset(tx, candidate.data.dataset);
          await prepareBddForSave(tx, candidate.data, existing);
          if (input.dryRun) {
            results.push({
              kind: 'test',
              name: candidate.data.name,
              outcome: existing ? 'updated' : 'created',
            });
          } else {
            const row = await saveTest(tx, req, candidate.data, existing);
            results.push({
              kind: 'test',
              name: row.name,
              id: row.id,
              outcome: existing ? 'updated' : 'created',
            });
          }
        }
        const seenApi = new Set<string>();
        for (const raw of bundle.apiTests) {
          const candidate = valid(apiTestCreateSchema, { ...raw, projectId: input.projectId });
          if (seenApi.has(candidate.name))
            throw new AuthoringError(400, 'invalid_request', 'An API test name is listed twice.');
          seenApi.add(candidate.name);
          const same = await tx
            .select()
            .from(apiTests)
            .where(eq(apiTests.name, candidate.name))
            .limit(2);
          const existing = same[0];
          if (same.length > 1 || (existing && existing.projectId !== input.projectId))
            throw new AuthoringError(
              409,
              'name_conflict',
              `The API test name "${candidate.name}" is already used elsewhere in the organization.`,
            );
          const incoming = existing
            ? { ...candidate, authParams: keepRedactedSecrets(candidate.authParams, existing.authParams) }
            : candidate;
          if (existing && sameAs(existing as unknown as Record<string, unknown>, incoming, API_TEST_FIELDS)) {
            results.push({ kind: 'api_test', name: existing.name, id: existing.id, outcome: 'unchanged' });
          } else if (input.dryRun) {
            results.push({ kind: 'api_test', name: candidate.name, outcome: existing ? 'updated' : 'created' });
          } else {
            const row = await saveApiTest(tx, req, candidate, existing);
            results.push({
              kind: 'api_test',
              name: row.name,
              id: row.id,
              outcome: existing ? 'updated' : 'created',
            });
          }
        }
        // An existing mobile test keeps its project in the catalogue import; here it must be this one.
        for (const raw of bundle.mobileTests) {
          const [existing] = await tx
            .select({ projectId: mobileTests.projectId })
            .from(mobileTests)
            .where(sql`lower(${mobileTests.name}) = lower(${String(raw.name ?? '')})`)
            .limit(1);
          if (existing && existing.projectId !== input.projectId)
            throw new AuthoringError(
              409,
              'name_conflict',
              `The mobile test name "${String(raw.name)}" belongs to another project.`,
            );
        }
        const native = await importMobileCatalog(tx, {
          bundle,
          projectId: input.projectId,
          dryRun: input.dryRun,
          userId: req.user!.id,
          actor: auditActor(req),
          canEditProject: async (id) => {
            try {
              await editableProject(tx, req, id);
              return true;
            } catch {
              return false;
            }
          },
        });
        for (const outcome of native) {
          // The public import is all or nothing: one invalid item rolls the whole suite back.
          if (outcome.outcome === 'invalid')
            throw new AuthoringError(
              400,
              'invalid_request',
              `${outcome.kind === 'mobile_test' ? 'Mobile test' : 'Mobile step group'} "${outcome.name}": ${outcome.reason}`,
            );
          results.push({ kind: outcome.kind, name: outcome.name, outcome: outcome.outcome });
        }
        if (!input.dryRun)
          await recordAudit(tx, {
            action: AUDIT_ACTIONS.TESTS_IMPORTED,
            actor: auditActor(req),
            targetType: 'project',
            targetId: input.projectId,
            metadata: { count: results.length },
          });
        return results;
      });
      res.status(input.dryRun ? 200 : 201).json({ dryRun: input.dryRun, results });
    },
    'SuiteImport',
    201,
    'suiteImportSchema',
  );
}

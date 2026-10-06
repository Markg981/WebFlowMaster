import type { Router, Request, Response, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, eq, ne } from 'drizzle-orm';
import {
  projects,
  projectMembers,
  tests,
  testDataSets,
  testPlans,
  testPlanSelectedTests,
  insertTestSchema,
  insertTestPlanSchema,
  AUDIT_ACTIONS,
  type Test,
  type Project,
  type TestDataSet,
  type TestPlan,
} from '@shared/schema';
import { testDataSetInputSchema, sharedSetIdOf } from '@shared/test-data';
import { manualSequenceProblem } from '@shared/manual-tests';
import { type ApiScope } from '@shared/api-scopes';
import { apiError, requireScope } from '../middleware/require-scope';
import { withTenantTransaction, runAsOrganization, type TenantTx } from '../middleware/tenancy';
import { auditActor, recordAudit } from '../audit';
import { recordTestVersion } from '../test-version-store';
import { BddDefinitionError, prepareBddForSave } from '../bdd-definition';
import { assertSelectedTestsBelongTo, SELECTED_TESTS_NOT_FOUND } from '../routes/selected-tests';
import { testsUsingSet } from '../test-data';
import { exportBundle, parseBundle, BundleError } from '../test-bundle';
import { GherkinError } from '../gherkin';
import { quotaErrorBody } from '../tenant-quotas';

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
export const suiteExportSchema = z
  .object({
    projectId: z.number().int().positive(),
    format: z.enum(['json', 'yaml', 'gherkin']).default('json'),
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
  ) {
    super(message);
  }
}
function notFound(kind: string): never {
  throw new AuthoringError(
    404,
    `${kind}_not_found`,
    `There is no such ${kind} in this organization.`,
  );
}
function idOf(req: Request, name: string) {
  const id = numericId.safeParse(req.params[name]);
  if (!id.success)
    throw new AuthoringError(400, 'invalid_request', 'The identifier must be a positive integer.');
  return id.data;
}
function body<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  const result = schema.safeParse(req.body);
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
        apiError(res, error.status, error.code, error.message);
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
      const result = await withTenantTransaction(async (tx) => {
        const [project] = await tx
          .select()
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .limit(1);
        if (!project) notFound('project');
        const rows = await tx
          .select()
          .from(tests)
          .where(eq(tests.projectId, input.projectId))
          .limit(501);
        if (rows.length > 500)
          throw new AuthoringError(
            400,
            'suite_too_large',
            'A suite may contain at most 500 tests.',
          );
        const exported = exportBundle(
          { project: project.name, tests: rows, apiTests: [] },
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
        bundle.tests.length > 500 ||
        bundle.apiTests.length ||
        bundle.mobileTests.length ||
        bundle.mobileStepGroups.length
      )
        throw new AuthoringError(
          400,
          'invalid_request',
          'Import accepts at most 500 UI, manual or BDD tests.',
        );
      const results = await withTenantTransaction(async (tx) => {
        await editableProject(tx, req, input.projectId);
        const results = [];
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
            results.push({ name: candidate.data.name, outcome: existing ? 'updated' : 'created' });
          } else {
            const row = await saveTest(tx, req, candidate.data, existing);
            results.push({ name: row.name, id: row.id, outcome: existing ? 'updated' : 'created' });
          }
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

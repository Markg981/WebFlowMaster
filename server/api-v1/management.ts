import type { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, asc, desc, eq, getTableColumns, ne, sql } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  environments,
  secrets,
  tags,
  testTags,
  testPlans,
  testPlanExecutions,
  testPlanSchedules,
  testPlanWebhooks,
  type TestPlanSchedule,
  type TestQuarantine,
} from '@shared/schema';
import { type ApiScope } from '@shared/api-scopes';
import { requireScope } from '../middleware/require-scope';
import { withTenantTransaction, getTenantOrgId, type TenantTx } from '../middleware/tenancy';
import { auditActor, changedFields, recordAudit } from '../tenancy/audit';
import schedulerService, {
  assertValidTimezone,
  DEFAULT_SCHEDULE_TIMEZONE,
  firstRunAt,
} from '../execution/scheduler-service';
import { encryptSecret } from '../crypto';
import { normaliseTagName } from '../authoring/test-tags';
import {
  QuarantineError,
  listOpenQuarantines,
  quarantineTest,
  releaseQuarantine,
} from '../authoring/test-quarantine';
import { generateWebhookToken } from '../identity/webhook-tokens';
import {
  artifactStore,
  assertSafeKey,
  contentTypeFor,
  RESULTS_PREFIX,
} from '../tenancy/artifact-store';
import { executionArtifactAvailability } from '../tenancy/artifact-metering';
import { billingSummary } from '../tenancy/billing/service';
import logger from '../logger';
import { EVIDENCE_KINDS } from './management-openapi';
import {
  AuthoringError,
  atLeastOneField,
  body,
  handled,
  idOf,
  notFound,
  page,
  valid,
} from './authoring';

/**
 * The rest of what a pipeline or an operator's script manages around tests and runs: when plans
 * run (schedules), what they run against (environments and their secrets), what a run left
 * behind (evidence), how tests are grouped (tags), which are set aside (quarantine) and what
 * may start a plan from outside (webhooks).
 *
 * Each endpoint does what the web application's own route does, with the same service functions
 * and audit entries, and answers in this API's shapes: written out, so a column added for a page
 * does not become part of the contract.
 */

const scheduleFields = {
  testPlanId: z.string().min(1).max(100),
  scheduleName: z.string().trim().min(1).max(200),
  frequency: z.string().trim().min(1).max(200),
  /** ISO 8601 date-time, or Unix seconds, as the web application sends it. */
  nextRunAt: z.union([z.string().datetime({ offset: true }), z.number().positive()]),
  timezone: z.string().trim().min(1).max(100).optional(),
  environment: z.string().max(200).nullable().optional(),
  browsers: z.array(z.string().min(1).max(50)).max(10).nullable().optional(),
  notificationConfigOverride: z.record(z.unknown()).nullable().optional(),
  executionParameters: z.record(z.unknown()).nullable().optional(),
  isActive: z.boolean().optional(),
  retryOnFailure: z.enum(['none', 'once', 'twice']).optional(),
};
export const scheduleCreateSchema = z.object(scheduleFields).strict();
export const scheduleUpdateSchema = scheduleCreateSchema
  .partial()
  .strict()
  .refine(atLeastOneField, 'Send at least one field.');
export const environmentCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();
export const secretValueSchema = z.object({ value: z.string().min(1).max(100_000) }).strict();
export const tagNameSchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();
export const quarantineCreateSchema = z
  .object({
    testType: z.enum(['ui', 'api', 'mobile']),
    testId: z.number().int().positive(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
export const quarantineReleaseSchema = z
  .object({ note: z.string().trim().max(2000).optional() })
  .strict();
export const webhookCreateSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const managementSchemas = {
  scheduleCreateSchema,
  scheduleUpdateSchema,
  environmentCreateSchema,
  secretValueSchema,
  tagNameSchema,
  quarantineCreateSchema,
  quarantineReleaseSchema,
  webhookCreateSchema,
};

/** The name has to survive being written as `{{name}}`: the substitution pattern is [\w.]+. */
const secretKeyName = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[\w.]+$/);

// jsonb columns of a schedule are stored via JSON.stringify (the web application's convention,
// which the scheduler reads) and parsed back here.
const parsed = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);
export function publicSchedule(row: TestPlanSchedule, testPlanName: string | null) {
  return {
    id: row.id,
    testPlanId: row.testPlanId,
    testPlanName,
    scheduleName: row.scheduleName,
    frequency: row.frequency,
    nextRunAt: row.nextRunAt,
    timezone: row.timezone,
    environment: row.environment,
    browsers: parsed(row.browsers),
    notificationConfigOverride: parsed(row.notificationConfigOverride),
    executionParameters: parsed(row.executionParameters),
    isActive: row.isActive,
    retryOnFailure: row.retryOnFailure,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export function publicEnvironment(row: typeof environments.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    /** Whether a saved login exists and how old it is; never the session itself. */
    loginStateCapturedAt: row.loginStateCapturedAt,
  };
}
/** The columns that may leave the server. Never the ciphertext, the iv or the auth tag. */
const publicSecretColumns = {
  id: secrets.id,
  environmentId: secrets.environmentId,
  keyName: secrets.keyName,
  createdAt: secrets.createdAt,
  updatedAt: secrets.updatedAt,
};
export function publicSecret(row: typeof secrets.$inferSelect) {
  const { id, environmentId, keyName, createdAt, updatedAt } = row;
  return { id, environmentId, keyName, createdAt, updatedAt };
}
export function publicQuarantine(row: TestQuarantine) {
  return {
    id: row.id,
    testType: row.testType,
    testId: (row.testType === 'ui'
      ? row.testId
      : row.testType === 'api'
        ? row.apiTestId
        : row.mobileTestId)!,
    reason: row.reason,
    quarantinedAt: row.quarantinedAt,
    releasedAt: row.releasedAt,
    releaseNote: row.releaseNote,
  };
}
/** What a listing shows: never the hash, which is still a secret's shadow. */
export function publicWebhook(row: typeof testPlanWebhooks.$inferSelect) {
  return {
    id: row.id,
    testPlanId: row.testPlanId,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}
export function evidenceKindOf(relativePath: string): (typeof EVIDENCE_KINDS)[number] {
  const extension = relativePath.toLowerCase().replace(/^.*\./, '.');
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return 'screenshot';
  if (['.webm', '.mp4'].includes(extension)) return 'video';
  if (extension === '.zip') return 'trace';
  if (['.txt', '.log'].includes(extension)) return 'log';
  if (['.html', '.pdf'].includes(extension)) return 'report';
  if (['.json', '.har', '.xml', '.csv'].includes(extension)) return 'data';
  return 'other';
}

const toDate = (value: string | number) =>
  typeof value === 'number' ? new Date(value * 1000) : new Date(value);
function checkedTimezone(timezone: string | undefined) {
  if (!timezone) return;
  try {
    assertValidTimezone(timezone);
  } catch (error) {
    throw new AuthoringError(400, 'invalid_request', (error as Error).message);
  }
}
function checkedFirstRun(frequency: string, requested: Date, timezone: string) {
  try {
    return firstRunAt(frequency, requested, timezone);
  } catch (error) {
    throw new AuthoringError(400, 'invalid_request', (error as Error).message);
  }
}
async function scheduleWithPlan(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({ ...getTableColumns(testPlanSchedules), testPlanName: testPlans.name })
    .from(testPlanSchedules)
    .leftJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id))
    .where(eq(testPlanSchedules.id, id))
    .limit(1);
  if (!row) notFound('schedule');
  const { testPlanName, ...schedule } = row;
  return { schedule, testPlanName };
}
async function setScheduleActive(req: Request, res: Response, isActive: boolean) {
  const id = req.params.scheduleId;
  const result = await withTenantTransaction(async (tx) => {
    await scheduleWithPlan(tx, id);
    const [row] = await tx
      .update(testPlanSchedules)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(testPlanSchedules.id, id))
      .returning();
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.SCHEDULE_UPDATED,
      actor: auditActor(req),
      targetType: 'schedule',
      targetId: id,
      metadata: { name: row.scheduleName, fields: ['isActive'], isActive },
    });
    return scheduleWithPlan(tx, id);
  });
  await schedulerService.updateScheduleJob(result.schedule);
  res.json(publicSchedule(result.schedule, result.testPlanName));
}
async function environmentOf(tx: TenantTx, id: number) {
  const [row] = await tx.select().from(environments).where(eq(environments.id, id)).limit(1);
  if (!row) notFound('environment');
  return row;
}
const tagColumns = {
  id: tags.id,
  name: tags.name,
  createdAt: tags.createdAt,
  uiCount: sql<number>`count(distinct ${testTags.testId})`,
  apiCount: sql<number>`count(distinct ${testTags.apiTestId})`,
  mobileCount: sql<number>`count(distinct ${testTags.mobileTestId})`,
};
function publicTag(row: {
  id: string;
  name: string;
  createdAt: Date;
  uiCount: number;
  apiCount: number;
  mobileCount: number;
}) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    uiCount: Number(row.uiCount ?? 0),
    apiCount: Number(row.apiCount ?? 0),
    mobileCount: Number(row.mobileCount ?? 0),
  };
}
async function tagWithCounts(tx: TenantTx, id: string) {
  const [row] = await tx
    .select(tagColumns)
    .from(tags)
    .leftJoin(testTags, eq(testTags.tagId, tags.id))
    .where(eq(tags.id, id))
    .groupBy(tags.id, tags.name, tags.createdAt)
    .limit(1);
  if (!row) notFound('tag');
  return publicTag(row);
}
async function tagNamed(tx: TenantTx, name: string, except?: string) {
  const [row] = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(
      except
        ? and(sql`lower(${tags.name}) = lower(${name})`, ne(tags.id, except))
        : sql`lower(${tags.name}) = lower(${name})`,
    )
    .limit(1);
  return row;
}
/** The service's own refusals, in this API's envelope. */
function quarantineHandled<T>(work: Promise<T>): Promise<T> {
  return work.catch((error: unknown) => {
    if (error instanceof QuarantineError)
      throw new AuthoringError(
        error.status,
        error.code === 'not_found' ? 'quarantine_not_found' : error.code,
        error.message,
      );
    throw error;
  });
}

export const managementOperations: Array<{
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  scope: ApiScope;
  body?: keyof typeof managementSchemas;
  response: string;
  status: number;
}> = [];
export function registerManagementRoutes(router: Router) {
  function route(
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    scope: ApiScope,
    handler: (req: Request, res: Response) => Promise<unknown>,
    response: string,
    status = 200,
    schema?: keyof typeof managementSchemas,
  ) {
    managementOperations.push({
      method,
      path,
      scope,
      response,
      status,
      ...(schema ? { body: schema } : {}),
    });
    router[method](path, requireScope(scope), handled(handler));
  }

  // ─── Schedules ───
  route(
    'get',
    '/api/v1/schedules',
    'schedules:read',
    async (req, res) => {
      const p = page(req);
      const filter =
        typeof req.query.testPlanId === 'string' && req.query.testPlanId
          ? eq(testPlanSchedules.testPlanId, req.query.testPlanId)
          : undefined;
      const rows = await withTenantTransaction((tx) =>
        tx
          .select({ ...getTableColumns(testPlanSchedules), testPlanName: testPlans.name })
          .from(testPlanSchedules)
          .leftJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id))
          .where(filter)
          .orderBy(desc(testPlanSchedules.createdAt), testPlanSchedules.id)
          .limit(p.limit)
          .offset(p.offset),
      );
      res.json({
        items: rows.map(({ testPlanName, ...row }) => publicSchedule(row, testPlanName)),
        ...p,
      });
    },
    'SchedulePage',
  );
  route(
    'get',
    '/api/v1/schedules/:scheduleId',
    'schedules:read',
    async (req, res) => {
      const result = await withTenantTransaction((tx) =>
        scheduleWithPlan(tx, req.params.scheduleId),
      );
      res.json(publicSchedule(result.schedule, result.testPlanName));
    },
    'Schedule',
  );
  route(
    'post',
    '/api/v1/schedules',
    'schedules:write',
    async (req, res) => {
      const input = body(scheduleCreateSchema, req);
      checkedTimezone(input.timezone);
      const timezone = input.timezone ?? DEFAULT_SCHEDULE_TIMEZONE;
      const nextRunAt = checkedFirstRun(input.frequency, toDate(input.nextRunAt), timezone);
      const id = randomUUID();
      const result = await withTenantTransaction(async (tx) => {
        const [plan] = await tx
          .select({ id: testPlans.id, name: testPlans.name })
          .from(testPlans)
          .where(eq(testPlans.id, input.testPlanId))
          .limit(1);
        if (!plan) notFound('plan');
        await tx.insert(testPlanSchedules).values({
          id,
          testPlanId: plan.id,
          organizationId: req.user!.organizationId,
          // Scheduled runs are made on behalf of whoever created the schedule.
          userId: req.user!.id,
          scheduleName: input.scheduleName,
          frequency: input.frequency,
          nextRunAt,
          timezone,
          environment: input.environment ?? null,
          browsers: input.browsers ? JSON.stringify(input.browsers) : null,
          notificationConfigOverride: input.notificationConfigOverride
            ? JSON.stringify(input.notificationConfigOverride)
            : null,
          executionParameters: input.executionParameters
            ? JSON.stringify(input.executionParameters)
            : null,
          isActive: input.isActive ?? true,
          retryOnFailure: input.retryOnFailure ?? 'none',
          updatedAt: new Date(),
        });
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.SCHEDULE_CREATED,
          actor: auditActor(req),
          targetType: 'schedule',
          targetId: id,
          metadata: {
            name: input.scheduleName,
            planId: plan.id,
            planName: plan.name,
            frequency: input.frequency,
          },
        });
        return scheduleWithPlan(tx, id);
      });
      // Outside the transaction: the scheduler runs its own queries, which would deadlock the
      // shared connection under PGlite and escape RLS under node-postgres.
      await schedulerService.addScheduleJob(result.schedule);
      res.status(201).json(publicSchedule(result.schedule, result.testPlanName));
    },
    'Schedule',
    201,
    'scheduleCreateSchema',
  );
  route(
    'patch',
    '/api/v1/schedules/:scheduleId',
    'schedules:write',
    async (req, res) => {
      const id = req.params.scheduleId,
        input = body(scheduleUpdateSchema, req);
      checkedTimezone(input.timezone);
      const result = await withTenantTransaction(async (tx) => {
        const { schedule: current } = await scheduleWithPlan(tx, id);
        if (input.testPlanId !== undefined && input.testPlanId !== current.testPlanId) {
          const [plan] = await tx
            .select({ id: testPlans.id })
            .from(testPlans)
            .where(eq(testPlans.id, input.testPlanId))
            .limit(1);
          if (!plan) notFound('plan');
        }
        const values: Partial<typeof testPlanSchedules.$inferInsert> = { updatedAt: new Date() };
        if (input.testPlanId !== undefined) values.testPlanId = input.testPlanId;
        if (input.scheduleName !== undefined) values.scheduleName = input.scheduleName;
        if (input.frequency !== undefined) values.frequency = input.frequency;
        if (input.timezone !== undefined) values.timezone = input.timezone;
        if (input.environment !== undefined) values.environment = input.environment;
        if (input.browsers !== undefined)
          values.browsers = input.browsers ? JSON.stringify(input.browsers) : null;
        if (input.notificationConfigOverride !== undefined)
          values.notificationConfigOverride = input.notificationConfigOverride
            ? JSON.stringify(input.notificationConfigOverride)
            : null;
        if (input.executionParameters !== undefined)
          values.executionParameters = input.executionParameters
            ? JSON.stringify(input.executionParameters)
            : null;
        if (input.isActive !== undefined) values.isActive = input.isActive;
        if (input.retryOnFailure !== undefined) values.retryOnFailure = input.retryOnFailure;
        // A change to when it runs recomputes the first run, as on create — against the row as
        // it is for whatever the request leaves out.
        if (
          input.frequency !== undefined ||
          input.timezone !== undefined ||
          input.nextRunAt !== undefined
        )
          values.nextRunAt = checkedFirstRun(
            input.frequency ?? current.frequency,
            input.nextRunAt !== undefined ? toDate(input.nextRunAt) : current.nextRunAt,
            input.timezone ?? current.timezone ?? DEFAULT_SCHEDULE_TIMEZONE,
          );
        const [row] = await tx
          .update(testPlanSchedules)
          .set(values)
          .where(eq(testPlanSchedules.id, id))
          .returning();
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.SCHEDULE_UPDATED,
          actor: auditActor(req),
          targetType: 'schedule',
          targetId: id,
          metadata: {
            name: row.scheduleName,
            fields: changedFields(input as Record<string, unknown>),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });
        return scheduleWithPlan(tx, id);
      });
      await schedulerService.updateScheduleJob(result.schedule);
      res.json(publicSchedule(result.schedule, result.testPlanName));
    },
    'Schedule',
    200,
    'scheduleUpdateSchema',
  );
  route(
    'post',
    '/api/v1/schedules/:scheduleId/pause',
    'schedules:write',
    (req, res) => setScheduleActive(req, res, false),
    'Schedule',
  );
  route(
    'post',
    '/api/v1/schedules/:scheduleId/resume',
    'schedules:write',
    (req, res) => setScheduleActive(req, res, true),
    'Schedule',
  );
  route(
    'delete',
    '/api/v1/schedules/:scheduleId',
    'schedules:write',
    async (req, res) => {
      const id = req.params.scheduleId;
      await withTenantTransaction(async (tx) => {
        const [row] = await tx
          .delete(testPlanSchedules)
          .where(eq(testPlanSchedules.id, id))
          .returning();
        if (!row) notFound('schedule');
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.SCHEDULE_DELETED,
          actor: auditActor(req),
          targetType: 'schedule',
          targetId: id,
          metadata: { name: row.scheduleName, planId: row.testPlanId },
        });
      });
      await schedulerService.removeScheduleJob(id);
      res.status(204).end();
    },
    'Empty',
    204,
  );

  // ─── Environments and their secrets ───
  route(
    'get',
    '/api/v1/environments',
    'environments:read',
    async (req, res) => {
      const p = page(req);
      const rows = await withTenantTransaction((tx) =>
        tx
          .select()
          .from(environments)
          .orderBy(asc(environments.name), environments.id)
          .limit(p.limit)
          .offset(p.offset),
      );
      res.json({ items: rows.map(publicEnvironment), ...p });
    },
    'EnvironmentPage',
  );
  route(
    'get',
    '/api/v1/environments/:environmentId',
    'environments:read',
    async (req, res) => {
      const id = idOf(req, 'environmentId');
      res.json(publicEnvironment(await withTenantTransaction((tx) => environmentOf(tx, id))));
    },
    'Environment',
  );
  route(
    'post',
    '/api/v1/environments',
    'environments:write',
    async (req, res) => {
      const input = body(environmentCreateSchema, req);
      const row = await withTenantTransaction(async (tx) => {
        // Names are unique within the organization, without case (migration 0041).
        const [duplicate] = await tx
          .select({ id: environments.id })
          .from(environments)
          .where(sql`lower(${environments.name}) = lower(${input.name})`)
          .limit(1);
        if (duplicate)
          throw new AuthoringError(
            409,
            'name_conflict',
            'An environment with this name already exists.',
          );
        const [row] = await tx
          .insert(environments)
          .values({
            name: input.name,
            description: input.description ?? null,
            // Both derived from the key, never from the body.
            userId: req.user!.id,
            organizationId: req.user!.organizationId,
          })
          .returning();
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.ENVIRONMENT_CREATED,
          actor: auditActor(req),
          targetType: 'environment',
          targetId: row.id,
          metadata: { name: row.name },
        });
        return row;
      });
      res.status(201).json(publicEnvironment(row));
    },
    'Environment',
    201,
    'environmentCreateSchema',
  );
  route(
    'delete',
    '/api/v1/environments/:environmentId',
    'environments:write',
    async (req, res) => {
      const id = idOf(req, 'environmentId');
      await withTenantTransaction(async (tx) => {
        // Its secrets go with it (cascade): an orphaned secret would still be decryptable.
        const [row] = await tx.delete(environments).where(eq(environments.id, id)).returning();
        if (!row) notFound('environment');
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.ENVIRONMENT_DELETED,
          actor: auditActor(req),
          targetType: 'environment',
          targetId: id,
          metadata: { name: row.name },
        });
      });
      res.status(204).end();
    },
    'Empty',
    204,
  );
  route(
    'get',
    '/api/v1/environments/:environmentId/secrets',
    'environments:read',
    async (req, res) => {
      const id = idOf(req, 'environmentId'),
        p = page(req);
      const rows = await withTenantTransaction(async (tx) => {
        await environmentOf(tx, id);
        return tx
          .select(publicSecretColumns)
          .from(secrets)
          .where(eq(secrets.environmentId, id))
          .orderBy(asc(secrets.keyName))
          .limit(p.limit)
          .offset(p.offset);
      });
      res.json({ items: rows, ...p });
    },
    'SecretPage',
  );
  route(
    'put',
    '/api/v1/environments/:environmentId/secrets/:keyName',
    'secrets:write',
    async (req, res) => {
      const id = idOf(req, 'environmentId'),
        keyName = valid(secretKeyName, req.params.keyName),
        input = body(secretValueSchema, req);
      const result = await withTenantTransaction(async (tx) => {
        await environmentOf(tx, id);
        // With the organization's own key; the tenant transaction is found on its own.
        const { encryptedValue, iv, authTag } = await encryptSecret(
          input.value,
          req.user!.organizationId,
        );
        // Replace rather than accumulate: two rows with one name make `{{name}}` resolve to
        // whichever the query happens to return first.
        const replaced = await tx
          .delete(secrets)
          .where(and(eq(secrets.environmentId, id), eq(secrets.keyName, keyName)))
          .returning();
        const [row] = await tx
          .insert(secrets)
          .values({
            environmentId: id,
            keyName,
            encryptedValue,
            iv,
            authTag,
            userId: req.user!.id,
            organizationId: req.user!.organizationId,
          })
          .returning();
        // The name and where it lives. Never the value, in any form.
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.SECRET_SET,
          actor: auditActor(req),
          targetType: 'secret',
          targetId: row.id,
          metadata: { keyName, environmentId: id, rotated: replaced.length > 0 },
        });
        return { row: publicSecret(row), rotated: replaced.length > 0 };
      });
      res.status(result.rotated ? 200 : 201).json(result.row);
    },
    'Secret',
    201,
    'secretValueSchema',
  );
  route(
    'delete',
    '/api/v1/environments/:environmentId/secrets/:keyName',
    'secrets:write',
    async (req, res) => {
      const id = idOf(req, 'environmentId'),
        keyName = valid(secretKeyName, req.params.keyName);
      await withTenantTransaction(async (tx) => {
        await environmentOf(tx, id);
        const [row] = await tx
          .delete(secrets)
          .where(and(eq(secrets.environmentId, id), eq(secrets.keyName, keyName)))
          .returning();
        if (!row) notFound('secret');
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.SECRET_DELETED,
          actor: auditActor(req),
          targetType: 'secret',
          targetId: row.id,
          metadata: { keyName, environmentId: id },
        });
      });
      res.status(204).end();
    },
    'Empty',
    204,
  );

  // ─── Run evidence ───
  route(
    'get',
    '/api/v1/runs/:runId/evidence',
    'runs:read',
    async (req, res) => {
      const p = page(req);
      const [run] = await withTenantTransaction((tx) =>
        tx
          .select({
            id: testPlanExecutions.id,
            testPlanId: testPlanExecutions.testPlanId,
            organizationId: testPlanExecutions.organizationId,
            artifactsPurgedAt: testPlanExecutions.artifactsPurgedAt,
          })
          .from(testPlanExecutions)
          .where(eq(testPlanExecutions.id, req.params.runId))
          .limit(1),
      );
      if (!run) notFound('run');
      const prefix = `${RESULTS_PREFIX}${run.testPlanId}/${run.id}/`;
      const store = artifactStore();
      let listed: Array<{ key: string; size: number }> = [];
      if (!run.artifactsPurgedAt && store.list) {
        try {
          listed = await store.list(prefix);
        } catch (error) {
          logger.error({
            message: 'The artifact store could not be listed',
            runId: run.id,
            error: (error as Error)?.message,
          });
          throw new AuthoringError(
            502,
            'artifact_store_unavailable',
            'The artifact store could not be reached.',
          );
        }
      }
      // Files whose retention has lapsed, or that were never committed to the quota, stay out.
      const retained = await executionArtifactAvailability(
        run.organizationId,
        run.testPlanId,
        run.id,
      );
      const items = listed
        .map((file) => ({ relative: file.key.slice(prefix.length), size: file.size }))
        .filter((file) => file.relative && retained(file.relative))
        .sort((a, b) => a.relative.localeCompare(b.relative))
        .map((file) => ({
          path: file.relative,
          kind: evidenceKindOf(file.relative),
          contentType: contentTypeFor(file.relative),
          size: file.size,
          url: `/api/v1/runs/${run.id}/artifacts/${file.relative
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`,
        }));
      res.json({
        items: items.slice(p.offset, p.offset + p.limit),
        ...p,
        total: items.length,
        purged: !!run.artifactsPurgedAt,
      });
    },
    'EvidencePage',
  );
  route(
    'get',
    '/api/v1/runs/:runId/artifacts/:path(*)',
    'runs:read',
    async (req, res) => {
      const [run] = await withTenantTransaction((tx) =>
        tx
          .select({ id: testPlanExecutions.id, testPlanId: testPlanExecutions.testPlanId })
          .from(testPlanExecutions)
          .where(eq(testPlanExecutions.id, req.params.runId))
          .limit(1),
      );
      if (!run) notFound('run');
      // The key is the run's own directory and the path below it. The check is what decides
      // that a request for ../../../.env is not a screenshot, whichever store would be asked.
      let key: string;
      try {
        key = assertSafeKey(
          `${RESULTS_PREFIX}${run.testPlanId}/${run.id}/${String(req.params.path ?? '').replace(/\\/g, '/')}`,
        );
      } catch {
        throw new AuthoringError(400, 'invalid_request', 'The artifact path is not valid.');
      }
      let artifact;
      try {
        artifact = await artifactStore().open(key);
      } catch (error) {
        logger.error({
          message: 'The artifact store could not be read',
          runId: run.id,
          key,
          error: (error as Error)?.message,
        });
        throw new AuthoringError(
          502,
          'artifact_store_unavailable',
          'The artifact store could not be reached.',
        );
      }
      if (!artifact) notFound('artifact');
      // Immutable once written: a run's evidence is never rewritten.
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Content-Type', artifact.contentType);
      // An HTML artifact (a Lighthouse report) runs its own inline scripts; sandboxed without
      // allow-same-origin it cannot read this application's cookies or call its API.
      if (/^text\/html/i.test(artifact.contentType)) {
        res.setHeader(
          'Content-Security-Policy',
          "sandbox allow-scripts allow-popups; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:",
        );
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }
      if (artifact.size !== undefined) res.setHeader('Content-Length', String(artifact.size));
      artifact.stream.on('error', (error) => {
        logger.error({
          message: 'Artifact stream failed',
          runId: run.id,
          key,
          error: error.message,
        });
        res.destroy(error);
      });
      artifact.stream.pipe(res);
    },
    'Binary',
  );

  // ─── Tags ───
  route(
    'get',
    '/api/v1/tags',
    'tags:read',
    async (req, res) => {
      const p = page(req);
      const rows = await withTenantTransaction((tx) =>
        tx
          .select(tagColumns)
          .from(tags)
          .leftJoin(testTags, eq(testTags.tagId, tags.id))
          .groupBy(tags.id, tags.name, tags.createdAt)
          .orderBy(asc(tags.name), tags.id)
          .limit(p.limit)
          .offset(p.offset),
      );
      res.json({ items: rows.map(publicTag), ...p });
    },
    'TagPage',
  );
  route(
    'get',
    '/api/v1/tags/:tagId',
    'tags:read',
    async (req, res) => {
      res.json(await withTenantTransaction((tx) => tagWithCounts(tx, req.params.tagId)));
    },
    'Tag',
  );
  route(
    'post',
    '/api/v1/tags',
    'tags:write',
    async (req, res) => {
      const name = normaliseTagName(body(tagNameSchema, req).name);
      // A name that already exists answers 200 with the tag that has it: two callers tagging
      // tests at the same time both mean the same "smoke". Creating answers 201.
      const outcome = await withTenantTransaction(async (tx) => {
        const existing = await tagNamed(tx, name);
        if (existing) return { created: false, tag: await tagWithCounts(tx, existing.id) };
        const [row] = await tx
          .insert(tags)
          .values({ id: randomUUID(), organizationId: req.user!.organizationId, name })
          .returning();
        return { created: true, tag: await tagWithCounts(tx, row.id) };
      });
      res.status(outcome.created ? 201 : 200).json(outcome.tag);
    },
    'Tag',
    201,
    'tagNameSchema',
  );
  route(
    'patch',
    '/api/v1/tags/:tagId',
    'tags:write',
    async (req, res) => {
      const id = req.params.tagId,
        name = normaliseTagName(body(tagNameSchema, req).name);
      // Every test carrying the tag follows the rename.
      const tag = await withTenantTransaction(async (tx) => {
        await tagWithCounts(tx, id);
        if (await tagNamed(tx, name, id))
          throw new AuthoringError(409, 'name_conflict', 'A tag with this name already exists.');
        await tx.update(tags).set({ name }).where(eq(tags.id, id));
        return tagWithCounts(tx, id);
      });
      res.json(tag);
    },
    'Tag',
    200,
    'tagNameSchema',
  );
  route(
    'delete',
    '/api/v1/tags/:tagId',
    'tags:write',
    async (req, res) => {
      const id = req.params.tagId;
      // Not refused while in use: a tag describes tests without changing what any of them does.
      // The count of assignments removed comes back so the answer is not silent about it.
      const outcome = await withTenantTransaction(async (tx) => {
        const [{ count } = { count: 0 }] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(testTags)
          .where(eq(testTags.tagId, id));
        const [row] = await tx.delete(tags).where(eq(tags.id, id)).returning();
        if (!row) notFound('tag');
        return { id: row.id, removedFrom: Number(count ?? 0) };
      });
      res.json(outcome);
    },
    'TagDeletion',
  );

  // ─── Quarantine ───
  route(
    'get',
    '/api/v1/quarantine',
    'quarantine:read',
    async (req, res) => {
      const p = page(req);
      const rows = await withTenantTransaction((tx) => listOpenQuarantines(tx));
      res.json({ items: rows.slice(p.offset, p.offset + p.limit), ...p, total: rows.length });
    },
    'QuarantinePage',
  );
  route(
    'post',
    '/api/v1/quarantine',
    'quarantine:write',
    async (req, res) => {
      const input = body(quarantineCreateSchema, req);
      const row = await quarantineHandled(
        withTenantTransaction((tx) =>
          quarantineTest(tx, {
            ref: { type: input.testType, id: input.testId },
            reason: input.reason,
            organizationId: getTenantOrgId()!,
            actor: auditActor(req),
          }),
        ),
      );
      res.status(201).json(publicQuarantine(row));
    },
    'Quarantine',
    201,
    'quarantineCreateSchema',
  );
  route(
    'post',
    '/api/v1/quarantine/:quarantineId/release',
    'quarantine:write',
    async (req, res) => {
      const id = idOf(req, 'quarantineId'),
        input = valid(quarantineReleaseSchema, req.body ?? {});
      const row = await quarantineHandled(
        withTenantTransaction((tx) =>
          releaseQuarantine(tx, {
            quarantineId: id,
            note: input.note || null,
            actor: auditActor(req),
          }),
        ),
      );
      res.json(publicQuarantine(row));
    },
    'Quarantine',
    200,
    'quarantineReleaseSchema',
  );

  // ─── Plan webhooks ───
  route(
    'get',
    '/api/v1/plans/:planId/webhooks',
    'webhooks:read',
    async (req, res) => {
      const p = page(req);
      const rows = await withTenantTransaction(async (tx) => {
        const [plan] = await tx
          .select({ id: testPlans.id })
          .from(testPlans)
          .where(eq(testPlans.id, req.params.planId))
          .limit(1);
        if (!plan) notFound('plan');
        return tx
          .select()
          .from(testPlanWebhooks)
          .where(eq(testPlanWebhooks.testPlanId, plan.id))
          .orderBy(desc(testPlanWebhooks.createdAt), testPlanWebhooks.id)
          .limit(p.limit)
          .offset(p.offset);
      });
      res.json({ items: rows.map(publicWebhook), ...p });
    },
    'WebhookPage',
  );
  route(
    'post',
    '/api/v1/plans/:planId/webhooks',
    'webhooks:write',
    async (req, res) => {
      const input = body(webhookCreateSchema, req);
      const { token, tokenHash, tokenPrefix } = generateWebhookToken();
      const created = await withTenantTransaction(async (tx) => {
        const [plan] = await tx
          .select({ id: testPlans.id })
          .from(testPlans)
          .where(eq(testPlans.id, req.params.planId))
          .limit(1);
        if (!plan) notFound('plan');
        const [row] = await tx
          .insert(testPlanWebhooks)
          .values({
            testPlanId: plan.id,
            organizationId: req.user!.organizationId,
            name: input.name,
            tokenHash,
            tokenPrefix,
          })
          .returning();
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.WEBHOOK_CREATED,
          actor: auditActor(req),
          targetType: 'webhook',
          targetId: String(row.id),
          // The prefix, never the token and never its hash.
          metadata: { name: row.name, testPlanId: plan.id, tokenPrefix },
        });
        return publicWebhook(row);
      });
      // `token` appears here and nowhere else, ever: the row holds its hash.
      res.status(201).json({ ...created, token });
    },
    'WebhookCreated',
    201,
    'webhookCreateSchema',
  );
  route(
    'delete',
    '/api/v1/webhooks/:webhookId',
    'webhooks:write',
    async (req, res) => {
      const id = idOf(req, 'webhookId');
      await withTenantTransaction(async (tx) => {
        const [row] = await tx
          .delete(testPlanWebhooks)
          .where(eq(testPlanWebhooks.id, id))
          .returning();
        if (!row) notFound('webhook');
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.WEBHOOK_DELETED,
          actor: auditActor(req),
          targetType: 'webhook',
          targetId: String(row.id),
          metadata: { name: row.name, testPlanId: row.testPlanId, tokenPrefix: row.tokenPrefix },
        });
      });
      res.status(204).end();
    },
    'Empty',
    204,
  );

  // ─── Billing ───
  route(
    'get',
    '/api/v1/billing',
    'billing:read',
    async (_req, res) => {
      res.json(await billingSummary(getTenantOrgId()!));
    },
    'Billing',
  );
}

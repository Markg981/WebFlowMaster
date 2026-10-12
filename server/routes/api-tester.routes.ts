import { asyncRouter } from '../middleware/async-router';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  apiTestHistory,
  AssertionSchema,
  AuthParamsSchema,
  ExtractionSchema,
  insertApiTestHistorySchema,
} from '@shared/schema';
import { ProtocolConfigSchema } from '@shared/api-protocol-config';
import { runApiRequest } from '../api-test-runner';
import { withExecutionUsage } from '../execution-usage';
import { redactHistoryEntry } from '../history-redaction';
import loggerPromise from '../logger';
import { asyncHandler } from '../middleware/async-handler';
import { sharedHeavyRateLimit } from '../middleware/rate-limits';
import { requireRole } from '../middleware/require-role';
import { withTenantTransaction } from '../middleware/tenancy';
import { quotaErrorBody, quotaErrorStatus } from '../tenant-quotas';
import { defaultVariables, resolveVariables } from '../variables';

/**
 * The API tester page: sending a request from the browser through the server, and the
 * history of what each person sent.
 */

const router = asyncRouter();
const logger = await loggerPromise;
// After requireRole, so it counts for the user the role check has already established.
const heavyLimit = sharedHeavyRateLimit();

const proxyApiRequestBodySchema = z.object({
  method: z.string(),
  // Not .url(): saved tests legitimately hold {{baseUrl}}/... here. The URL is
  // validated below, once the variables have been resolved.
  url: z.string().min(1),
  queryParams: z.record(z.any()).optional(),
  headers: z.record(z.string()).optional(),
  body: z.any().optional(),
  // A form-data or binary body, which cannot travel in `body`: a browser FormData or File
  // serialises to `{}`. See ApiRequestSpec.multipart.
  multipart: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ key: z.string().min(1), type: z.literal('text'), value: z.string() }),
        z.object({
          key: z.string().min(1),
          type: z.literal('file'),
          fileName: z.string(),
          contentType: z.string().optional().nullable(),
          base64: z.string(),
        }),
      ]),
    )
    .optional()
    .nullable(),
  binary: z
    .object({ contentType: z.string().optional().nullable(), base64: z.string() })
    .optional()
    .nullable(),
  assertions: z.array(AssertionSchema).optional(),
  // Captured here as well as in a plan, so the tester can see what a request would hand
  // to the next one rather than finding out only when the plan runs.
  extractions: z.array(ExtractionSchema).optional(),
  // The settings, not the finished header. The page used to build the Authorization
  // header in the browser and send only that, which meant `{{name}}` in a token reached
  // the target literally — the environment's values are here, not there — and the same
  // test authenticated one way from the page and another from a schedule.
  auth: AuthParamsSchema.optional().nullable(),
  // Which environment resolves `{{name}}`. The organization it must belong to comes from
  // the session, so naming another tenant's environment resolves nothing.
  environmentId: z.number().int().positive().optional().nullable(),
  // A gRPC test's service definition.
  protoDefinition: z.string().max(500_000).optional().nullable(),
  protocolConfig: ProtocolConfigSchema.optional().nullable(),
});

router.post(
  '/api/proxy-api-request',
  requireRole('editor'),
  heavyLimit,
  asyncHandler(async (req, res) => {
    const parseResult = proxyApiRequestBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res
        .status(400)
        .json({ error: 'Invalid request payload', details: parseResult.error.flatten() });
    }
    const { environmentId, ...spec } = parseResult.data;

    // The environment supplies the variables here exactly as it does for a scheduled run,
    // so a request that works in the tester works in a plan. Its id is the caller's; the
    // organization it must belong to is the session's.
    const vars = await resolveVariables({
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
      environmentId: Number.isInteger(environmentId) ? environmentId : null,
    });

    // One implementation, shared with the scheduled runner. Keeping a second copy here is
    // what let the two drift until test-execution-service gave up and shipped
    // `Math.random() > 0.2` in place of executing anything at all.
    let result: Awaited<ReturnType<typeof runApiRequest>>;
    try {
      result = await withExecutionUsage('api', () => runApiRequest(spec, vars));
    } catch (error) {
      const quota = quotaErrorBody(error);
      if (quota) return res.status(quotaErrorStatus(error)).json(quota);
      throw error;
    }

    if (result.error) {
      logger.error('Error in /api/proxy-api-request:', {
        error: result.error,
        url: spec.url,
        method: spec.method,
      });
      return res.status(500).json({
        success: false,
        error: result.error,
        details: result.error,
        duration: result.durationMs,
      });
    }

    res.status(200).json({
      success: true,
      status: result.status,
      headers: result.headers,
      body: result.body,
      duration: result.durationMs,
      assertionResults: result.assertions,
      // Present so the tester can see what a request would hand to the next one in a plan,
      // rather than finding out only when the plan runs.
      extracted: result.extracted,
      extractionErrors: result.extractionErrors,
    });
  }),
);

router.post(
  '/api/api-test-history',
  requireRole('editor'),
  asyncHandler(async (req, res) => {
    const parseResult = insertApiTestHistorySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res
        .status(400)
        .json({ error: 'Invalid history data', details: parseResult.error.flatten() });
    }
    // The environment the request ran in, so its values can be taken back out of what is
    // stored. Only the environment's own values: the defaults (baseUrl) are configuration,
    // not secrets, and replacing them would only make entries harder to read.
    const environmentId = Number(req.body?.environmentId);
    const resolved =
      Number.isInteger(environmentId) && environmentId > 0
        ? await resolveVariables({
            userId: req.user!.id,
            organizationId: req.user!.organizationId,
            environmentId,
          })
        : {};
    const defaults = defaultVariables();
    const environmentValues = Object.fromEntries(
      Object.entries(resolved).filter(([name, value]) => defaults[name] !== value),
    );
    const entry = redactHistoryEntry(parseResult.data, environmentValues);
    const [created] = await withTenantTransaction((tx) =>
      tx
        .insert(apiTestHistory)
        .values({ ...entry, userId: req.user!.id, organizationId: req.user!.organizationId })
        .returning(),
    );
    res.status(201).json(created);
  }),
);

router.get(
  '/api/api-test-history',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    // Both inside one tenant transaction: RLS bounds them to the caller's organization, and
    // the count must be taken under the same binding as the page it describes.
    const { historyEntries, totalResult } = await withTenantTransaction(async (tx) => ({
      historyEntries: await tx
        .select()
        .from(apiTestHistory)
        .where(eq(apiTestHistory.userId, req.user!.id))
        .orderBy(desc(apiTestHistory.createdAt))
        .limit(limit)
        .offset(offset),
      totalResult: await tx
        .select({ count: sql`count(*)` })
        .from(apiTestHistory)
        .where(eq(apiTestHistory.userId, req.user!.id)),
    }));
    const total = Number(totalResult[0]?.count || 0);
    res.json({
      items: historyEntries,
      page,
      limit,
      totalItems: total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

router.delete(
  '/api/api-test-history/:id',
  requireRole('editor'),
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid history ID' });
    }
    const deleted = await withTenantTransaction((tx) =>
      tx
        .delete(apiTestHistory)
        .where(and(eq(apiTestHistory.id, id), eq(apiTestHistory.userId, req.user!.id)))
        .returning(),
    );
    if (deleted.length === 0) {
      return res.status(404).json({ error: 'History entry not found or not owned by user' });
    }
    res.status(204).send();
  }),
);

export default router;

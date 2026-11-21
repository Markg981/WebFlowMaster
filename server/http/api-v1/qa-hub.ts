import type { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { hubJobs } from '@shared/schema';
import type { ApiScope } from '@shared/api-scopes';
import { withTenantTransaction } from '../../platform/middleware/tenancy';
import { requireScope } from '../middleware/require-scope';
import { sharedHeavyRateLimit } from '../middleware/rate-limits';
import { HubSourceError } from '../../integrations/testcases-hub';
import {
  HUB_AUDIT_DEFAULT_LIST,
  auditHubModules,
  modulesImportSchema,
  startModuleImport,
  toJob,
} from '../../integrations/qa-hub-service';
import { AuthoringError, body, handled, notFound, valid } from './authoring';

/**
 * The QA hub import for API keys and CI: start a module import (or sync) as a background job,
 * poll it, and read the audit. The shared logic is in integrations/qa-hub-service.ts.
 */
export const qaHubImportSchema = modulesImportSchema;

const auditQuerySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  modules: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 100),
    ),
  limit: z.coerce.number().int().min(1).max(1000).default(HUB_AUDIT_DEFAULT_LIST),
});

/** The expensive routes share one budget, checked before the scope and the role. */
const heavyLimit = sharedHeavyRateLimit();

function hubFailure(error: unknown): never {
  if (error instanceof HubSourceError)
    throw new AuthoringError(error.status, error.code, error.message);
  throw error;
}

export function registerQaHubRoutes(router: Router) {
  function route(
    method: 'get' | 'post',
    path: string,
    scope: ApiScope,
    handler: (req: Request, res: Response) => Promise<unknown>,
    heavy = false,
  ) {
    const guards = [requireScope(scope), handled(handler)];
    if (heavy) router[method](path, heavyLimit, ...guards);
    else router[method](path, ...guards);
  }

  route(
    'post',
    '/api/v1/qa-hub/import/modules',
    'qa-hub:write',
    async (req, res) => {
      const params = body(qaHubImportSchema, req);
      try {
        res.status(202).json(await startModuleImport(req, params));
      } catch (error) {
        hubFailure(error);
      }
    },
    true,
  );

  route('get', '/api/v1/qa-hub/jobs/:jobId', 'qa-hub:read', async (req, res) => {
    const [row] = await withTenantTransaction((tx) =>
      tx
        .select()
        .from(hubJobs)
        .where(eq(hubJobs.id, String(req.params.jobId)))
        .limit(1),
    );
    if (!row) notFound('hub_job');
    res.json(toJob(row));
  });

  route('get', '/api/v1/qa-hub/audit', 'qa-hub:read', async (req, res) => {
    const query = valid(auditQuerySchema, req.query);
    try {
      res.json(
        await auditHubModules({
          projectId: query.projectId ?? null,
          modules: query.modules,
          limit: query.limit,
        }),
      );
    } catch (error) {
      hubFailure(error);
    }
  });
}

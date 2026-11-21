/**
 * What the QA hub import offers beyond the library's own screens, shared by the session routes
 * (/api/testcase-hub/...) and the API-key routes (/api/v1/qa-hub/...):
 *
 *  - starting a module import (or sync) as a background job, and
 *  - the audit report: per hub module what is defined, imported and missing, which cases have more
 *    than one test, which tests differ from the hub's taxonomy, and which tests carry a QA id the
 *    hub no longer has.
 *
 * Read-only apart from the job: the audit never changes a test.
 */
import type { Request } from 'express';
import { z } from 'zod';
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { AUDIT_ACTIONS, hubTestCases, tests, type HubJob } from '@shared/schema';
import {
  HUB_MODULE_IMPORT_MAX_MODULES,
  QA_HUB_SOURCE,
  externalCaseIdFromName,
  type HubModuleImportParams,
} from '@shared/testcases-hub';
import { withTenantTransaction } from '../platform/middleware/tenancy';
import { editableProject } from './api-v1/authoring';
import { currentSource } from './routes/testcase-hub.routes';
import { recordAudit } from '../tenancy/audit';
import { HubSourceError } from '../integrations/testcases-hub';
import { importModules, startHubJob, type WaveActor } from '../integrations/hub-waves';

export function actorOf(req: Request): WaveActor {
  const user = req.user!;
  return {
    id: user.id,
    username: user.username,
    organizationId: user.organizationId,
    role: user.role,
    ip: req.ip ?? null,
  };
}

export async function requireSource() {
  const source = await currentSource();
  if (!source) throw new HubSourceError(404, 'no_source', 'No test case hub is configured.');
  return source;
}

/** What a client sees of a job. */
export function toJob(row: HubJob) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    params: row.params,
    progress: row.progress,
    summary: row.summary,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    cancelRequested: row.cancelRequestedAt != null,
  };
}

/** The body of a module import, on the session route and on the API-key route alike. */
export const modulesImportSchema = z.object({
  modules: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(HUB_MODULE_IMPORT_MAX_MODULES)
    .transform((list) => Array.from(new Set(list))),
  projectId: z.number().int().positive().nullable().default(null),
  variant: z.enum(['standard', 'reference']).default('standard'),
  includeDeprecated: z.boolean().default(false),
  updateChanged: z.boolean().default(false),
  featureHighlights: z
    .array(z.string().trim().min(1).max(300))
    .max(200)
    .optional()
    .transform((list) => (list?.length ? Array.from(new Set(list)) : undefined)),
  sync: z.boolean().default(false),
});

/**
 * Starts the job that imports (or, with `sync`, refreshes) every case of the modules. The caller
 * has checked the role and the rate limit. Throws HubSourceError for an unknown module or no hub,
 * and the authoring errors of `editableProject` for a project the caller may not change.
 */
export async function startModuleImport(req: Request, params: HubModuleImportParams) {
  const source = await requireSource();
  const known = await withTenantTransaction(async (tx) => {
    await editableProject(tx, req, params.projectId);
    return tx
      .selectDistinct({ module: hubTestCases.module })
      .from(hubTestCases)
      .where(inArray(hubTestCases.module, params.modules));
  });
  if (known.length !== params.modules.length)
    throw new HubSourceError(
      404,
      'module_not_found',
      'One or more modules are not in the catalog.',
    );
  const actor = actorOf(req);
  return startHubJob(actor, source.id, 'modules_import', { ...params }, async (hooks) => {
    const summary = await importModules(actor, params, hooks);
    await withTenantTransaction((tx) =>
      recordAudit(tx, {
        action: AUDIT_ACTIONS.TESTCASE_HUB_MODULES_IMPORTED,
        actor: { id: actor.id, username: actor.username, apiKeyId: null, ipAddress: actor.ip },
        targetType: 'testcase_hub',
        targetId: source.id,
        metadata: {
          modules: params.modules,
          projectId: params.projectId,
          sync: params.sync ?? false,
          created: summary.created,
          updated: summary.updated,
          alreadyImported: summary.alreadyImported,
          skipped: summary.skipped,
          failed: summary.failed,
        },
      }),
    );
    return { ...summary };
  });
}

// ─── Audit report ──────────────────────────────────────────────────────────────

/** Items kept per list in an audit; the counts are exact. */
export const HUB_AUDIT_DEFAULT_LIST = 100;

export interface HubAuditParams {
  projectId: number | null;
  /** Module names as the catalog keeps them; empty: every module. */
  modules: string[];
  /** Most items per list. */
  limit: number;
}

export interface HubAuditModule {
  module: string;
  /** Cases the catalog has for the module and the hub still lists. */
  defined: number;
  /** Of those, deprecated in the hub. */
  deprecated: number;
  /** Defined cases a live test of the project holds by QA id. */
  imported: number;
  /** Defined, active cases with no test: what a module import would create. */
  missing: number;
  /** Cases with more than one live test in the project (the QA id in the name, one of them holding the field). */
  duplicateCases: number;
  /** Tests holding the case whose module, feature area or scenario differs from the hub's. */
  taxonomyDiffers: number;
}

export interface HubAudit {
  projectId: number | null;
  modules: HubAuditModule[];
  duplicates: Array<{
    caseId: string;
    module: string | null;
    holderTestId: number | null;
    testIds: number[];
  }>;
  taxonomyDifferences: Array<{
    caseId: string;
    testId: number;
    fields: Record<string, { test: string | null; hub: string | null }>;
  }>;
  /** Tests holding a QA id the hub no longer has (gone from the catalog or no longer listed). */
  orphans: Array<{
    caseId: string;
    testId: number;
    name: string;
    reason: 'not_in_catalog' | 'missing_in_hub';
  }>;
  /** The exact numbers behind the truncated lists. */
  totals: { duplicates: number; taxonomyDifferences: number; orphans: number };
}

/** The taxonomy mapping the import writes: module, feature area = feature highlight, scenario = execution group. */
const TAXONOMY = [
  ['module', 'module'],
  ['featureArea', 'featureHighlight'],
  ['scenario', 'executionGroup'],
] as const;

export async function auditHubModules(params: HubAuditParams): Promise<HubAudit> {
  const wanted = params.modules.length > 0;
  return withTenantTransaction(async (tx) => {
    const catalog = await tx
      .select({
        caseId: hubTestCases.caseId,
        module: hubTestCases.module,
        featureHighlight: hubTestCases.featureHighlight,
        executionGroup: hubTestCases.executionGroup,
        status: hubTestCases.status,
        missingSince: hubTestCases.missingSince,
      })
      .from(hubTestCases);
    const byCase = new Map(catalog.map((row) => [row.caseId, row]));
    // Tests that carry a QA id as a field, or in their name (the ones a duplicate left without it).
    const rows = await tx
      .select({
        id: tests.id,
        name: tests.name,
        caseId: tests.externalCaseId,
        module: tests.module,
        featureArea: tests.featureArea,
        scenario: tests.scenario,
      })
      .from(tests)
      .where(
        and(
          ne(tests.status, 'archived'),
          params.projectId == null
            ? isNull(tests.projectId)
            : eq(tests.projectId, params.projectId),
          or(
            and(isNotNull(tests.externalCaseId), eq(tests.externalSource, QA_HUB_SOURCE)),
            sql`${tests.name} ~* '_TC_[0-9]'`,
          ),
        ),
      )
      .orderBy(tests.id);

    const holders = new Map<string, (typeof rows)[number]>();
    const namedBy = new Map<string, number[]>();
    for (const row of rows) {
      if (row.caseId) holders.set(row.caseId, row);
      const id = row.caseId ?? externalCaseIdFromName(row.name);
      if (!id) continue;
      namedBy.set(id, [...(namedBy.get(id) ?? []), row.id]);
    }

    const inScope = (module: string | null) =>
      !wanted || (module != null && params.modules.includes(module));
    const moduleNames = wanted
      ? params.modules
      : Array.from(new Set(catalog.map((row) => row.module))).sort();
    const perModule = new Map<string, HubAuditModule>(
      moduleNames.map((module) => [
        module,
        {
          module,
          defined: 0,
          deprecated: 0,
          imported: 0,
          missing: 0,
          duplicateCases: 0,
          taxonomyDiffers: 0,
        },
      ]),
    );
    const audit: HubAudit = {
      projectId: params.projectId,
      modules: [],
      duplicates: [],
      taxonomyDifferences: [],
      orphans: [],
      totals: { duplicates: 0, taxonomyDifferences: 0, orphans: 0 },
    };

    for (const row of catalog) {
      const stats = perModule.get(row.module);
      if (!stats || row.missingSince) continue;
      stats.defined++;
      const active = row.status === 'active';
      if (!active) stats.deprecated++;
      const holder = holders.get(row.caseId);
      if (holder) stats.imported++;
      else if (active) stats.missing++;
      const named = namedBy.get(row.caseId) ?? [];
      if (named.length > 1) {
        stats.duplicateCases++;
        audit.totals.duplicates++;
        if (audit.duplicates.length < params.limit)
          audit.duplicates.push({
            caseId: row.caseId,
            module: row.module,
            holderTestId: holder?.id ?? null,
            testIds: named,
          });
      }
      if (holder) {
        const fields: HubAudit['taxonomyDifferences'][number]['fields'] = {};
        for (const [testKey, hubKey] of TAXONOMY) {
          const test = holder[testKey] ?? null;
          const hub = row[hubKey] ?? null;
          if (test !== hub) fields[testKey] = { test, hub };
        }
        if (Object.keys(fields).length > 0) {
          stats.taxonomyDiffers++;
          audit.totals.taxonomyDifferences++;
          if (audit.taxonomyDifferences.length < params.limit)
            audit.taxonomyDifferences.push({ caseId: row.caseId, testId: holder.id, fields });
        }
      }
    }
    for (const [caseId, test] of holders) {
      const row = byCase.get(caseId);
      const reason = !row ? 'not_in_catalog' : row.missingSince ? 'missing_in_hub' : null;
      if (!reason || !inScope(row?.module ?? test.module)) continue;
      audit.totals.orphans++;
      if (audit.orphans.length < params.limit)
        audit.orphans.push({ caseId, testId: test.id, name: test.name, reason });
    }
    audit.modules = Array.from(perModule.values());
    return audit;
  });
}

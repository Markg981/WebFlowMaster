import { HUB_MODULE_IMPORT_MAX_MODULES } from '@shared/testcases-hub';
import {
  anyObject,
  date,
  idParameter,
  integer,
  nullableDate,
  nullableText,
  object,
  operation,
  text,
} from './authoring-openapi';
// The public contracts of server/http/api-v1/qa-hub.ts.

const count = { type: 'integer', minimum: 0 } as const;
const textList = (max: number) => ({ type: 'array', items: text, maxItems: max });

export const qaHubSchemas = {
  QaHubImportInput: object(
    {
      modules: {
        type: 'array',
        items: { ...text, minLength: 1, maxLength: 200 },
        minItems: 1,
        maxItems: HUB_MODULE_IMPORT_MAX_MODULES,
      },
      projectId: { type: ['integer', 'null'], minimum: 1, default: null },
      variant: { ...text, enum: ['standard', 'reference'], default: 'standard' },
      includeDeprecated: { type: 'boolean', default: false },
      updateChanged: { type: 'boolean', default: false },
      featureHighlights: {
        ...textList(200),
        description: 'Only cases of these feature highlights (pages); absent: all of them.',
      },
      sync: {
        type: 'boolean',
        default: false,
        description:
          'Also refresh tests that exist: module, feature area, scenario, title and manual steps text. A recorded or automated sequence, checkpoints, fixtures, preconditions and cleanups are never touched; deprecated cases are tagged qa-hub-deprecated, not deleted.',
      },
    },
    ['modules'],
  ),
  QaHubJob: object(
    {
      id: text,
      kind: text,
      status: { ...text, enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'] },
      params: anyObject,
      progress: { type: ['object', 'null'], additionalProperties: true },
      summary: {
        type: ['object', 'null'],
        additionalProperties: true,
        description:
          'When finished: modules[] and the totals created, updated, unchanged, skipped, alreadyImported, skippedDeprecated, deprecatedMarked, failed, changes{} and stepsKept; each module also lists failures[] with the reason.',
      },
      error: nullableText,
      createdAt: date,
      startedAt: nullableDate,
      finishedAt: nullableDate,
      cancelRequested: { type: 'boolean' },
    },
    ['id', 'kind', 'status', 'createdAt', 'cancelRequested'],
  ),
  QaHubAudit: object(
    {
      projectId: { type: ['integer', 'null'] },
      modules: {
        type: 'array',
        items: object({
          module: text,
          defined: count,
          deprecated: count,
          imported: count,
          missing: count,
          duplicateCases: count,
          taxonomyDiffers: count,
        }),
      },
      duplicates: { type: 'array', items: anyObject },
      taxonomyDifferences: { type: 'array', items: anyObject },
      orphans: { type: 'array', items: anyObject },
      totals: object({ duplicates: count, taxonomyDifferences: count, orphans: count }),
    },
    ['projectId', 'modules', 'duplicates', 'taxonomyDifferences', 'orphans', 'totals'],
  ),
};

export const qaHubPaths = {
  '/api/v1/qa-hub/import/modules': {
    post: operation({
      id: 'importQaHubModules',
      scope: 'qa-hub:write',
      input: 'QaHubImportInput',
      response: 'QaHubJob',
      status: 202,
      summary: 'Import (or sync) every case of whole QA hub modules, as a background job.',
      description:
        'Idempotent and resumable: a case a live test of the project already holds is reported as already imported and never duplicated, and a re-run only picks up what is left. Poll the job at /api/v1/qa-hub/jobs/{jobId}.',
    }),
  },
  '/api/v1/qa-hub/jobs/{jobId}': {
    get: operation({
      id: 'getQaHubJob',
      scope: 'qa-hub:read',
      response: 'QaHubJob',
      parameters: idParameter('jobId', true),
      summary: 'Read the progress and the summary of an import job.',
    }),
  },
  '/api/v1/qa-hub/audit': {
    get: operation({
      id: 'auditQaHub',
      scope: 'qa-hub:read',
      response: 'QaHubAudit',
      parameters: [
        { name: 'projectId', in: 'query', schema: integer },
        {
          name: 'modules',
          in: 'query',
          schema: text,
          description: 'Comma separated module names; absent: every module.',
        },
        { name: 'limit', in: 'query', schema: { ...integer, maximum: 1000, default: 100 } },
      ],
      summary:
        'Per hub module: defined, imported, missing, duplicates, taxonomy differences and tests whose QA id the hub no longer has.',
    }),
  },
};

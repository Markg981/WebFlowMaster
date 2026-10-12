import { eq } from 'drizzle-orm';
import { testPlanExecutions as testPlanExecutionsTable } from '@shared/schema';
import logger from '../../platform/logger';
import { withTenantTransaction } from '../../platform/middleware/tenancy';
import { getWsEmitter, type ExecutionLogEntry } from '../../http/websocket';
import { artifactStore } from '../../tenancy/artifact-store';
import { QuotaError } from '../../tenancy/tenant-quotas';

/**
 * Publishes a directory of evidence to the artifact store.
 *
 * Never throws: the verdict does not depend on the pictures, and a bucket that refused an upload
 * must cost the report its images, not the run its result. The local copy stays when an upload
 * fails, so the evidence still exists somewhere.
 */
export async function publishArtifacts(localDir: string, executionId: string): Promise<void> {
  try {
    await artifactStore().publishDirectory(localDir);
  } catch (error: unknown) {
    await withTenantTransaction((tx) =>
      tx
        .update(testPlanExecutionsTable)
        .set({ artifactStorageStatus: error instanceof QuotaError ? 'quota_exceeded' : 'error' })
        .where(eq(testPlanExecutionsTable.id, executionId))
        .returning(),
    ).catch(() => undefined);
    const entry: ExecutionLogEntry = {
      level: 'warn',
      source: 'system',
      message: `Evidence in ${localDir} could not be stored: ${(error as Error)?.message ?? error}. It stays on this worker's disk.`,
      timestamp: new Date().toISOString(),
    };
    logger.warn(entry);
    getWsEmitter().emitExecutionLog(executionId, entry);
  }
}

/**
 * Stored the way the report reads them: the artifacts route turns one of these back into
 * something a browser can open (see server/http/routes/artifacts.routes.ts).
 */
export const asResultsUrl = (filePath?: string): string | undefined =>
  filePath ? filePath.replace(/^\.?\/?results/, '/results').replace(/\\/g, '/') : undefined;

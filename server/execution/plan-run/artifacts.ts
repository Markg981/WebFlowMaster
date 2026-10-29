import { eq } from 'drizzle-orm';
import { testPlanExecutions as testPlanExecutionsTable } from '@shared/schema';
import logger from '../../platform/logger';
import { withTenantTransaction } from '../../platform/middleware/tenancy';
import { getWsEmitter, type ExecutionLogEntry } from '../../http/websocket';
import { artifactStore } from '../../tenancy/artifact-store';
import { QuotaError } from '../../tenancy/tenant-quotas';

/** Attempts at the upload before the evidence is given up on; a bucket blip should not cost a report its images. */
const PUBLISH_ATTEMPTS = 3;
const PUBLISH_RETRY_DELAY_MS = 500;

/**
 * Publishes a directory of evidence to the artifact store.
 *
 * Never throws: the verdict does not depend on the pictures, and a bucket that refused an upload
 * must cost the report its images, not the run its result. A failed upload is tried again a
 * couple of times (not for a quota refusal, which a retry cannot change); when it still fails
 * the run records `artifactStorageStatus='error'`, which the report shows, and the local copy
 * stays, so the evidence still exists somewhere.
 */
export async function publishArtifacts(
  localDir: string,
  executionId: string,
  retryDelayMs = PUBLISH_RETRY_DELAY_MS,
): Promise<void> {
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await artifactStore().publishDirectory(localDir);
        return;
      } catch (error: unknown) {
        if (error instanceof QuotaError || attempt >= PUBLISH_ATTEMPTS) throw error;
        logger.warn({
          message: `Evidence upload failed (attempt ${attempt} of ${PUBLISH_ATTEMPTS}), trying again`,
          executionId,
          error: (error as Error)?.message ?? String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
  } catch (error: unknown) {
    await withTenantTransaction((tx) =>
      tx
        .update(testPlanExecutionsTable)
        .set({ artifactStorageStatus: error instanceof QuotaError ? 'quota_exceeded' : 'error' })
        .where(eq(testPlanExecutionsTable.id, executionId))
        .returning(),
    ).catch((statusError: unknown) => {
      logger.error({
        message: 'Could not record that the evidence was not stored',
        executionId,
        error: (statusError as Error)?.message ?? String(statusError),
      });
    });
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

import { and, eq, inArray } from "drizzle-orm";
import { tests, apiTests } from "@shared/schema";
import type { TenantTx } from "../middleware/tenancy";

/** Matches the error assertSelectedTestsBelongTo throws, so a caller can map it to a 400. */
export const SELECTED_TESTS_NOT_FOUND = /selected tests do not exist/i;

/**
 * Throws unless every selected test belongs to `organizationId`.
 *
 * The ids arrive from the request body, and nothing downstream re-checks them:
 * server/test-execution-service.ts loads them with `inArray(tests.id, ...)` and no
 * organization filter, so an unvalidated foreign id means the runner executes and reports on
 * another tenant's test.
 *
 * Shared between the create and update paths for test plans, which live in two different
 * files: the create handler in server/routes/test-plans.routes.ts and the update handler
 * still among the legacy inline handlers in server/routes.ts. Two copies of a security check
 * is one copy too many.
 */
export async function assertSelectedTestsBelongTo(
  tx: Pick<TenantTx, 'select'>,
  organizationId: number,
  selectedTests: { id: number; type: 'ui' | 'api' }[],
): Promise<void> {
  for (const [type, table] of [['ui', tests], ['api', apiTests]] as const) {
    const ids = selectedTests.filter((st) => st.type === type).map((st) => st.id);
    if (ids.length === 0) continue;

    const found = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(inArray(table.id, ids), eq(table.organizationId, organizationId)));

    if (found.length !== new Set(ids).size) {
      throw new Error("One or more selected tests do not exist.");
    }
  }
}

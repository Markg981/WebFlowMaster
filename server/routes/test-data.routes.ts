import { Router, type Response } from "express";
import { and, asc, eq, ne } from "drizzle-orm";
import { AUDIT_ACTIONS, testDataSets } from "@shared/schema";
import { testDataSetInputSchema } from "@shared/test-data";
import { requireRole } from "../middleware/require-role";
import { withTenantTransaction, getTenantOrgId, type TenantTx } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { testsUsingSet } from "../test-data";
import loggerPromise from "../logger";

/**
 * Shared test data (shared/test-data.ts): viewers read the sets, editors keep them. A set some
 * test runs over cannot be deleted until those tests stop using it — the alternative is runs
 * that fail later, somewhere else, for a reason nobody connects to the deletion.
 */

const router = Router();

class TestDataError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function fail(res: Response, error: unknown, doing: string) {
  if (error instanceof TestDataError) return res.status(error.status).json({ error: error.message });
  const logger = await loggerPromise;
  logger.error({ message: `Could not ${doing}`, error: (error as Error)?.message });
  res.status(500).json({ error: `Could not ${doing}.` });
}

/** The values as stored: only the declared columns, every one present. */
function normalisedRows(columns: string[], rows: Array<Record<string, string>>) {
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ""])));
}

async function nameTaken(tx: TenantTx, name: string, exceptId?: number) {
  const [other] = await tx
    .select({ id: testDataSets.id })
    .from(testDataSets)
    .where(exceptId ? and(eq(testDataSets.name, name), ne(testDataSets.id, exceptId)) : eq(testDataSets.name, name))
    .limit(1);
  if (other) throw new TestDataError(409, `A data set named "${name}" already exists.`);
}

router.get("/api/test-data", requireRole("viewer"), async (_req, res) => {
  try {
    res.json(await withTenantTransaction((tx) => tx.select().from(testDataSets).orderBy(asc(testDataSets.name))));
  } catch (error) {
    fail(res, error, "list the test data");
  }
});

router.get("/api/test-data/:id", requireRole("viewer"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid data set id" });
  try {
    const found = await withTenantTransaction(async (tx) => {
      const [set] = await tx.select().from(testDataSets).where(eq(testDataSets.id, id)).limit(1);
      if (!set) throw new TestDataError(404, "Data set not found");
      return { ...set, usedBy: await testsUsingSet(tx, id) };
    });
    res.json(found);
  } catch (error) {
    fail(res, error, "read the data set");
  }
});

router.post("/api/test-data", requireRole("editor"), async (req, res) => {
  const parsed = testDataSetInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid data set" });
  const input = parsed.data;
  try {
    const created = await withTenantTransaction(async (tx) => {
      await nameTaken(tx, input.name);
      const [row] = await tx
        .insert(testDataSets)
        .values({
          organizationId: getTenantOrgId()!,
          name: input.name,
          description: input.description ?? null,
          columns: input.columns,
          rows: normalisedRows(input.columns, input.rows),
        })
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TEST_DATA_SET_CREATED,
        actor: auditActor(req),
        targetType: "test_data_set",
        targetId: row.id,
        metadata: { name: row.name, columns: row.columns.length, rows: row.rows.length },
      });
      return row;
    });
    res.status(201).json(created);
  } catch (error) {
    fail(res, error, "create the data set");
  }
});

router.put("/api/test-data/:id", requireRole("editor"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = testDataSetInputSchema.safeParse(req.body);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid data set id" });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid data set" });
  const input = parsed.data;
  try {
    const updated = await withTenantTransaction(async (tx) => {
      const [existing] = await tx.select().from(testDataSets).where(eq(testDataSets.id, id)).limit(1);
      if (!existing) throw new TestDataError(404, "Data set not found");
      await nameTaken(tx, input.name, id);
      const [row] = await tx
        .update(testDataSets)
        .set({
          name: input.name,
          description: input.description ?? null,
          columns: input.columns,
          rows: normalisedRows(input.columns, input.rows),
          updatedAt: new Date(),
        })
        .where(eq(testDataSets.id, id))
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TEST_DATA_SET_UPDATED,
        actor: auditActor(req),
        targetType: "test_data_set",
        targetId: id,
        metadata: { name: row.name, ...(existing.name !== row.name ? { renamedFrom: existing.name } : {}), rows: row.rows.length },
      });
      return row;
    });
    res.json(updated);
  } catch (error) {
    fail(res, error, "save the data set");
  }
});

router.delete("/api/test-data/:id", requireRole("editor"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid data set id" });
  try {
    await withTenantTransaction(async (tx) => {
      const [existing] = await tx.select().from(testDataSets).where(eq(testDataSets.id, id)).limit(1);
      if (!existing) throw new TestDataError(404, "Data set not found");
      const users = await testsUsingSet(tx, id);
      if (users.length > 0) {
        throw new TestDataError(409, `"${existing.name}" is the dataset of ${users.length} test(s): ${users.slice(0, 5).join(", ")}${users.length > 5 ? "…" : ""}. Give them other rows first.`);
      }
      await tx.delete(testDataSets).where(eq(testDataSets.id, id));
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TEST_DATA_SET_DELETED,
        actor: auditActor(req),
        targetType: "test_data_set",
        targetId: id,
        metadata: { name: existing.name },
      });
    });
    res.status(204).end();
  } catch (error) {
    fail(res, error, "delete the data set");
  }
});

export default router;

import { Router, type Response } from "express";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { TEST_KINDS, firstMissingKind, itemKey, itemOf, linkColumns, linkWhere, type TestKind } from "../test-refs";
import {
  AUDIT_ACTIONS,
  apiTests,
  mobileTests,
  testCaseLinks,
  testManagementConnections,
  testPlanExecutions,
  testPlans,
  tests,
  type TestManagementConnection,
} from "@shared/schema";
import {
  PROVIDER_FIELDS,
  TEST_MANAGEMENT_PROVIDERS,
  caseKeyFromName,
  normaliseCaseKey,
  type TestManagementProvider,
} from "@shared/test-management";
import { isExecutionInFlight } from "@shared/execution-status";
import { requireRole } from "../middleware/require-role";
import { withTenantTransaction, getTenantOrgId } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { encryptSecret } from "../crypto";
import { checkTestManagement } from "../test-management-providers";
import { publicationsOf, publishExecution, toConnectionConfig } from "../test-management";
import loggerPromise from "../logger";

/**
 * TestRail, Xray and Zephyr Scale (shared/test-management.ts): the connections, which case each
 * test is, and publishing a run from its report. Like an issue tracker's, the token goes in and
 * never comes out; an edit that leaves it out keeps the saved one.
 */

const router = Router();
const logger = await loggerPromise;

class ConnectionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof ConnectionError) return res.status(error.status).json({ error: error.message });
  const message = (error as Error)?.message ?? "";
  if (/unique|duplicate/i.test(message)) return res.status(409).json({ error: "This organization already has a connection with that name." });
  logger.error({ message: `Failed to ${what}`, error: message });
  return res.status(500).json({ error: `Failed to ${what}.` });
}

const connectionSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(80),
  provider: z.enum(TEST_MANAGEMENT_PROVIDERS),
  baseUrl: z.string().trim().url("The address must be a URL, like https://acme.testrail.io").max(500).optional().nullable(),
  username: z.string().trim().max(200).optional().nullable(),
  projectKey: z.string().trim().min(1, "The project is required").max(100),
  suiteId: z.string().trim().regex(/^\d*$/, "A TestRail suite id is a number").max(20).optional().nullable(),
  testPlanKey: z.string().trim().max(50).optional().nullable(),
  token: z.string().trim().max(2000).optional().nullable(),
});
type ConnectionInput = z.infer<typeof connectionSchema>;

/** What the provider needs, said by name, and the values it keeps. */
function settle(input: ConnectionInput, hasToken: boolean) {
  const fields = PROVIDER_FIELDS[input.provider];
  const baseUrl = (input.baseUrl || fields.defaultBaseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) return { error: "The address of the tool is required." } as const;
  if (fields.username === "required" && !input.username) {
    return { error: input.provider === "xray_cloud" ? "The client id is required." : "The user is required." } as const;
  }
  if (fields.projectIsNumber && !/^\d+$/.test(input.projectKey)) return { error: "A TestRail project is its number, as in index.php?/projects/overview/3." } as const;
  if (!fields.projectIsNumber && !/^[A-Z][A-Z0-9_]{0,19}$/i.test(input.projectKey)) return { error: "The project is its Jira key, like SHOP." } as const;
  if (!hasToken) return { error: input.provider === "xray_cloud" ? "The client secret is required." : "The API token is required." } as const;
  return {
    values: {
      provider: input.provider,
      baseUrl,
      username: fields.username === "none" ? null : input.username || null,
      projectKey: fields.projectIsNumber ? input.projectKey : input.projectKey.toUpperCase(),
      suiteId: fields.suite ? input.suiteId || null : null,
      testPlanKey: fields.testPlan ? (input.testPlanKey ? input.testPlanKey.toUpperCase() : null) : null,
    },
  } as const;
}

function toListed(row: TestManagementConnection) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.baseUrl,
    username: row.username,
    projectKey: row.projectKey,
    suiteId: row.suiteId,
    testPlanKey: row.testPlanKey,
    hasToken: !!row.encryptedToken,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadConnection(id: string) {
  const [row] = await withTenantTransaction((tx) => tx.select().from(testManagementConnections).where(eq(testManagementConnections.id, id)).limit(1));
  if (!row) throw new ConnectionError(404, "Connection not found.");
  return row;
}

router.get("/api/test-management", requireRole("viewer"), async (_req, res) => {
  try {
    const rows = await withTenantTransaction((tx) => tx.select().from(testManagementConnections).orderBy(asc(testManagementConnections.name)));
    res.json(rows.map(toListed));
  } catch (error) {
    fail(res, error, "load the connections");
  }
});

router.post("/api/test-management", requireRole("editor"), async (req, res) => {
  const parsed = connectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid connection" });
  const settled = settle(parsed.data, !!parsed.data.token);
  if (settled.error) return res.status(400).json({ error: settled.error });
  try {
    const encrypted = encryptSecret(parsed.data.token!);
    const created = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .insert(testManagementConnections)
        .values({
          id: uuidv4(),
          organizationId: getTenantOrgId()!,
          name: parsed.data.name,
          ...settled.values,
          encryptedToken: encrypted.encryptedValue,
          tokenIv: encrypted.iv,
          tokenAuthTag: encrypted.authTag,
          createdBy: req.user!.id,
        })
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TEST_MANAGEMENT_CONNECTED,
        actor: auditActor(req),
        targetType: "test_management",
        targetId: row.id,
        metadata: { name: row.name, provider: row.provider, project: row.projectKey },
      });
      return row;
    });
    res.status(201).json(toListed(created));
  } catch (error) {
    fail(res, error, "save the connection");
  }
});

router.put("/api/test-management/:id", requireRole("editor"), async (req, res) => {
  const parsed = connectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid connection" });
  try {
    const updated = await withTenantTransaction(async (tx) => {
      const [current] = await tx.select().from(testManagementConnections).where(eq(testManagementConnections.id, req.params.id)).limit(1);
      if (!current) throw new ConnectionError(404, "Connection not found.");
      const settled = settle(parsed.data, !!parsed.data.token || !!current.encryptedToken);
      if (settled.error) throw new ConnectionError(400, settled.error);
      const token = parsed.data.token ? encryptSecret(parsed.data.token) : null;
      const [row] = await tx
        .update(testManagementConnections)
        .set({
          name: parsed.data.name,
          ...settled.values,
          ...(token ? { encryptedToken: token.encryptedValue, tokenIv: token.iv, tokenAuthTag: token.authTag } : {}),
          updatedAt: new Date(),
        })
        .where(eq(testManagementConnections.id, req.params.id))
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TEST_MANAGEMENT_UPDATED,
        actor: auditActor(req),
        targetType: "test_management",
        targetId: row.id,
        metadata: { name: row.name, provider: row.provider, tokenChanged: !!token },
      });
      return row;
    });
    res.json(toListed(updated));
  } catch (error) {
    fail(res, error, "update the connection");
  }
});

// POST /api/test-management/:id/test — reads the project with these credentials; creates nothing.
router.post("/api/test-management/:id/test", requireRole("editor"), async (req, res) => {
  try {
    const row = await loadConnection(req.params.id);
    res.json(await checkTestManagement(toConnectionConfig(row)));
  } catch (error) {
    fail(res, error, "check the connection");
  }
});

// DELETE — plans that published to it stop publishing; publications already made keep their record.
router.delete("/api/test-management/:id", requireRole("editor"), async (req, res) => {
  try {
    const outcome = await withTenantTransaction(async (tx) => {
      const [current] = await tx.select().from(testManagementConnections).where(eq(testManagementConnections.id, req.params.id)).limit(1);
      if (!current) throw new ConnectionError(404, "Connection not found.");
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(testPlans).where(eq(testPlans.testManagementId, current.id));
      await tx.delete(testManagementConnections).where(eq(testManagementConnections.id, current.id));
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.TEST_MANAGEMENT_REMOVED,
        actor: auditActor(req),
        targetType: "test_management",
        targetId: current.id,
        metadata: { name: current.name, provider: current.provider, plansStopped: Number(count) },
      });
      return { deleted: true, plansStoppedPublishing: Number(count) };
    });
    res.json(outcome);
  } catch (error) {
    fail(res, error, "delete the connection");
  }
});

/**
 * GET /api/test-management/:id/cases — every test the requester can see, with the case it is in
 * this tool: its own link, or the key its name carries.
 */
router.get("/api/test-management/:id/cases", requireRole("viewer"), async (req, res) => {
  try {
    const answer = await withTenantTransaction(async (tx) => {
      const [connection] = await tx.select().from(testManagementConnections).where(eq(testManagementConnections.id, req.params.id)).limit(1);
      if (!connection) throw new ConnectionError(404, "Connection not found.");
      const provider = connection.provider as TestManagementProvider;
      const links = await tx.select().from(testCaseLinks).where(eq(testCaseLinks.connectionId, connection.id));
      const linked = new Map(links.map((l) => [itemKey(itemOf(l).type, itemOf(l).id), l.caseKey]));
      const ui = await tx.select({ id: tests.id, name: tests.name }).from(tests).orderBy(asc(tests.name));
      const api = await tx.select({ id: apiTests.id, name: apiTests.name }).from(apiTests).orderBy(asc(apiTests.name));
      const mobile = await tx.select({ id: mobileTests.id, name: mobileTests.name }).from(mobileTests).orderBy(asc(mobileTests.name));
      const row = (type: TestKind, test: { id: number; name: string }) => ({
        type,
        id: test.id,
        name: test.name,
        caseKey: linked.get(`${type}:${test.id}`) ?? null,
        fromName: caseKeyFromName(provider, test.name),
      });
      return { provider, tests: [...ui.map((t) => row("ui", t)), ...api.map((t) => row("api", t)), ...mobile.map((t) => row("mobile", t))] };
    });
    res.json(answer);
  } catch (error) {
    fail(res, error, "load the test cases");
  }
});

const casesSchema = z.object({
  links: z
    .array(z.object({ type: z.enum(TEST_KINDS), id: z.number().int().positive(), caseKey: z.string().trim().max(40).nullable() }))
    .max(5000),
});

// PUT /api/test-management/:id/cases — { links: [{ type, id, caseKey }] }; a null key removes the link.
// Only the tests named change.
router.put("/api/test-management/:id/cases", requireRole("editor"), async (req, res) => {
  const parsed = casesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  try {
    const result = await withTenantTransaction(async (tx) => {
      const [connection] = await tx.select().from(testManagementConnections).where(eq(testManagementConnections.id, req.params.id)).limit(1);
      if (!connection) throw new ConnectionError(404, "Connection not found.");
      const provider = connection.provider as TestManagementProvider;

      const bad: string[] = [];
      const wanted = parsed.data.links.map((link) => {
        if (!link.caseKey) return { ...link, caseKey: null };
        const key = normaliseCaseKey(provider, link.caseKey);
        if (!key) bad.push(link.caseKey);
        return { ...link, caseKey: key };
      });
      if (bad.length) {
        const example = provider === "testrail" ? "C123" : provider === "zephyr_scale" ? "SHOP-T12" : "SHOP-45";
        throw new ConnectionError(400, `Not a case key of this tool (like ${example}): ${bad.slice(0, 10).join(", ")}.`);
      }

      if (await firstMissingKind(tx, wanted)) throw new ConnectionError(400, "One or more tests do not exist.");

      let changed = 0;
      for (const link of wanted) {
        const which = and(
          eq(testCaseLinks.connectionId, connection.id),
          linkWhere(testCaseLinks, link),
        );
        const [existing] = await tx.select().from(testCaseLinks).where(which).limit(1);
        if (existing && existing.caseKey === link.caseKey) continue;
        if (existing) await tx.delete(testCaseLinks).where(eq(testCaseLinks.id, existing.id));
        if (link.caseKey) {
          await tx.insert(testCaseLinks).values({
            organizationId: getTenantOrgId()!,
            connectionId: connection.id,
            ...linkColumns(link),
            caseKey: link.caseKey,
            createdBy: req.user!.id,
          });
        }
        changed++;
      }
      if (changed) {
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.TEST_CASE_LINKS_CHANGED,
          actor: auditActor(req),
          targetType: "test_management",
          targetId: connection.id,
          metadata: { name: connection.name, changed },
        });
      }
      return { changed };
    });
    res.json(result);
  } catch (error) {
    fail(res, error, "save the test cases");
  }
});

// GET /api/test-plan-executions/:id/publications — where this run has been published, newest first.
router.get("/api/test-plan-executions/:id/publications", requireRole("viewer"), async (req, res) => {
  try {
    const [execution] = await withTenantTransaction((tx) =>
      tx.select({ id: testPlanExecutions.id }).from(testPlanExecutions).where(eq(testPlanExecutions.id, req.params.id)).limit(1),
    );
    if (!execution) throw new ConnectionError(404, "Run not found.");
    res.json(await publicationsOf(execution.id));
  } catch (error) {
    fail(res, error, "load the publications");
  }
});

/**
 * POST /api/test-plan-executions/:id/publish — { connectionId? }: publishes the run now, to the
 * plan's connection or another. For a run published before its manual verdicts were given, or
 * to a tool that was down. Each call is a new run in the tool.
 */
router.post("/api/test-plan-executions/:id/publish", requireRole("editor"), async (req, res) => {
  const parsed = z.object({ connectionId: z.string().min(1).nullable().optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  try {
    const [execution] = await withTenantTransaction((tx) =>
      tx.select({ id: testPlanExecutions.id, status: testPlanExecutions.status }).from(testPlanExecutions).where(eq(testPlanExecutions.id, req.params.id)).limit(1),
    );
    if (!execution) throw new ConnectionError(404, "Run not found.");
    if (isExecutionInFlight(execution.status)) throw new ConnectionError(409, "The run has not finished: publish it when it has.");
    if (parsed.data.connectionId) await loadConnection(parsed.data.connectionId);

    const publication = await publishExecution(execution.id, { connectionId: parsed.data.connectionId ?? null, requestedBy: req.user!.id });
    if (!publication) throw new ConnectionError(400, "The plan publishes nowhere: choose a connection.");
    await withTenantTransaction((tx) =>
      recordAudit(tx, {
        action: AUDIT_ACTIONS.RUN_PUBLISHED,
        actor: auditActor(req),
        targetType: "test_plan_execution",
        targetId: execution.id,
        metadata: { connection: publication.connectionName, status: publication.status, externalKey: publication.externalKey },
      }),
    );
    res.status(publication.status === "failed" ? 502 : 200).json(publication);
  } catch (error) {
    fail(res, error, "publish the run");
  }
});

export default router;

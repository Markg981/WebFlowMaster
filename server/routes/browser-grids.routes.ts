import { Router } from "express";
import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import playwright from "playwright";
import { browserGrids, testPlans } from "@shared/schema";
import { BROWSER_GRID_PROVIDERS, GRID_FIELDS, LOCAL_APPIUM_DEFAULT_URL, endpointProblem } from "@shared/browser-grids";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { encryptSecret } from "../crypto";
import { gridConnection, toGridConfig } from "../browser-grids";
import { appiumTransport } from "../mobile-runner";
import loggerPromise from "../logger";

/**
 * An organization's browser grids (shared/browser-grids.ts).
 *
 * Like an issue tracker's token, the access key is encrypted and never sent back: every answer
 * describes the grid and whom it signs in as, and none contains the key. An edit that leaves the
 * key out keeps the one saved.
 */

const router = Router();
const logger = await loggerPromise;

const gridSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(80),
  provider: z.enum(BROWSER_GRID_PROVIDERS),
  username: z.string().trim().max(200).optional().nullable(),
  // Checked against the provider in missingFields: ws:// for a Playwright server, http:// for Appium.
  endpoint: z.string().trim().max(2000).optional().nullable(),
  key: z.string().trim().max(500).optional().nullable(),
  agentPool: z.string().trim().max(100).optional().nullable(),
});

type GridInput = z.infer<typeof gridSchema>;

/** What the provider needs, said by name — for a new grid, or for one as an edit leaves it. */
function missingFields(grid: Pick<GridInput, "provider" | "username" | "endpoint" | "agentPool">, hasKey: boolean): string | null {
  const needs = GRID_FIELDS[grid.provider];
  if (needs.username && !grid.username) return "A username is required for this provider.";
  if (needs.endpointRequired && !grid.endpoint) return "The ws:// or wss:// address of the Playwright server is required.";
  if (needs.endpoint && grid.endpoint) {
    const problem = endpointProblem(grid.provider, grid.endpoint);
    if (problem) return problem;
  }
  if (needs.agentPool && !grid.agentPool) return "Name the pool of local agents that reach Appium.";
  if (needs.key === "required" && !hasKey) return "An access key is required for this provider.";
  return null;
}

function toListed(row: typeof browserGrids.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    username: row.username,
    endpoint: row.endpoint,
    agentPool: row.agentPool,
    hasKey: !!row.encryptedKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const isUniqueViolation = (error: any) =>
  String(error?.message ?? "").toLowerCase().includes("unique") || error?.code === "23505";

router.get("/api/browser-grids", requireRole("viewer"), async (_req, res) => {
  try {
    const rows = await withTenantTransaction((tx) => tx.select().from(browserGrids).orderBy(asc(browserGrids.name)));
    res.json(rows.map(toListed));
  } catch (error: any) {
    logger.error({ message: "Failed to list browser grids", error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to load the browser grids." });
  }
});

router.post("/api/browser-grids", requireRole("editor"), async (req, res) => {
  const parsed = gridSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  const missing = missingFields(parsed.data, !!parsed.data.key);
  if (missing) return res.status(400).json({ error: missing });

  try {
    const encrypted = parsed.data.key ? encryptSecret(parsed.data.key) : null;
    const [created] = await withTenantTransaction((tx) =>
      tx
        .insert(browserGrids)
        .values({
          id: uuidv4(),
          organizationId: req.user!.organizationId,
          name: parsed.data.name,
          provider: parsed.data.provider,
          username: GRID_FIELDS[parsed.data.provider].username ? parsed.data.username ?? null : null,
          endpoint: GRID_FIELDS[parsed.data.provider].endpoint ? parsed.data.endpoint || null : null,
          agentPool: GRID_FIELDS[parsed.data.provider].agentPool ? parsed.data.agentPool ?? null : null,
          encryptedKey: GRID_FIELDS[parsed.data.provider].key === "none" ? null : encrypted?.encryptedValue ?? null,
          keyIv: GRID_FIELDS[parsed.data.provider].key === "none" ? null : encrypted?.iv ?? null,
          keyAuthTag: GRID_FIELDS[parsed.data.provider].key === "none" ? null : encrypted?.authTag ?? null,
          createdBy: req.user!.id,
        })
        .returning(),
    );
    res.status(201).json(toListed(created));
  } catch (error: any) {
    if (isUniqueViolation(error)) return res.status(409).json({ error: `This organization already has a grid called "${parsed.data.name}".` });
    logger.error({ message: "Failed to create browser grid", error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to save the grid." });
  }
});

router.put("/api/browser-grids/:id", requireRole("editor"), async (req, res) => {
  const parsed = gridSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });

  try {
    const outcome = await withTenantTransaction(async (tx) => {
      const [current] = await tx.select().from(browserGrids).where(eq(browserGrids.id, req.params.id)).limit(1);
      if (!current) return { status: 404, error: "Grid not found." } as const;
      const next = {
        provider: parsed.data.provider ?? (current.provider as GridInput["provider"]),
        username: parsed.data.username !== undefined ? parsed.data.username : current.username,
        endpoint: parsed.data.endpoint !== undefined ? parsed.data.endpoint : current.endpoint,
        agentPool: parsed.data.agentPool !== undefined ? parsed.data.agentPool : current.agentPool,
      };
      const missing = missingFields(next, !!parsed.data.key || !!current.encryptedKey);
      if (missing) return { status: 400, error: missing } as const;

      const changes: Record<string, unknown> = {
        updatedAt: new Date(),
        provider: next.provider,
        username: GRID_FIELDS[next.provider].username ? next.username ?? null : null,
        endpoint: GRID_FIELDS[next.provider].endpoint ? next.endpoint || null : null,
        agentPool: GRID_FIELDS[next.provider].agentPool ? next.agentPool ?? null : null,
      };
      if (parsed.data.name !== undefined) changes.name = parsed.data.name;
      if (GRID_FIELDS[next.provider].key === "none") {
        changes.encryptedKey = null;
        changes.keyIv = null;
        changes.keyAuthTag = null;
      } else if (parsed.data.key) {
        const encrypted = encryptSecret(parsed.data.key);
        changes.encryptedKey = encrypted.encryptedValue;
        changes.keyIv = encrypted.iv;
        changes.keyAuthTag = encrypted.authTag;
      }
      const [updated] = await tx.update(browserGrids).set(changes).where(eq(browserGrids.id, req.params.id)).returning();
      return { status: 200, grid: updated } as const;
    });
    if ("error" in outcome) return res.status(outcome.status).json({ error: outcome.error });
    res.json(toListed(outcome.grid));
  } catch (error: any) {
    if (isUniqueViolation(error)) return res.status(409).json({ error: "Another grid already has that name." });
    logger.error({ message: "Failed to update browser grid", error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to update the grid." });
  }
});

/**
 * POST /api/browser-grids/:id/test — opens one Chromium session on the grid and closes it.
 *
 * On the clouds that is one short session, visible on their dashboard as "WebFlowMaster
 * connection check": the way to find a wrong key before a nightly run does.
 */
router.post("/api/browser-grids/:id/test", requireRole("editor"), async (req, res) => {
  try {
    const [row] = await withTenantTransaction((tx) => tx.select().from(browserGrids).where(eq(browserGrids.id, req.params.id)).limit(1));
    if (!row) return res.status(404).json({ error: "Grid not found." });
    if (row.provider === "local_appium") return res.json(await checkLocalAppium(toGridConfig(row)));
    const connection = gridConnection(toGridConfig(row), {
      label: "chromium",
      engine: "chromium",
      sessionName: "WebFlowMaster connection check",
      buildName: "WebFlowMaster",
    });
    const started = Date.now();
    try {
      const browser = await playwright.chromium.connect(connection.wsEndpoint, {
        timeout: 60_000,
        ...(connection.headers ? { headers: connection.headers } : {}),
      });
      const version = browser.version();
      await browser.close();
      res.json({ ok: true, message: `Connected: ${version}, in ${Date.now() - started} ms.` });
    } catch (error: any) {
      const message = String(error?.message ?? error).split(connection.wsEndpoint).join("<grid address>");
      res.json({ ok: false, message: message.slice(0, 500) });
    }
  } catch (error: any) {
    logger.error({ message: "Browser grid check failed", error: error?.message ?? String(error) });
    res.status(500).json({ error: "Could not check the grid." });
  }
});

/**
 * A local Appium's check: its /status, asked from an agent of the pool — so it proves both that an
 * agent is connected and that Appium answers where the grid says, without opening a device.
 */
async function checkLocalAppium(grid: ReturnType<typeof toGridConfig>): Promise<{ ok: boolean; message: string }> {
  const started = Date.now();
  let transport: ReturnType<typeof appiumTransport> | null = null;
  try {
    transport = appiumTransport(grid, localAppiumCheck.fetch);
    const base = (grid.endpoint || LOCAL_APPIUM_DEFAULT_URL).replace(/\/+$/, "");
    const response = await transport.fetch(`${base}/status`, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    const body: any = await response.json().catch(() => null);
    if (!response.ok || !body?.value) return { ok: false, message: `Appium at ${base} answered HTTP ${response.status}.` };
    const version = body.value.build?.version;
    return { ok: true, message: `Connected through pool "${grid.agentPool}": Appium${version ? ` ${version}` : ""}, in ${Date.now() - started} ms.` };
  } catch (error: any) {
    return { ok: false, message: String(error?.message ?? error).slice(0, 500) };
  } finally {
    await transport?.close();
  }
}

/** How the tests stand in for the agent. */
export const localAppiumCheck: { fetch?: (url: string, init: RequestInit) => Promise<Response> } = {};

/** DELETE — the plans that used it go back to the server's runners, and the answer says how many. */
router.delete("/api/browser-grids/:id", requireRole("editor"), async (req, res) => {
  try {
    const outcome = await withTenantTransaction(async (tx) => {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(testPlans)
        .where(eq(testPlans.browserGridId, req.params.id));
      const deleted = await tx.delete(browserGrids).where(eq(browserGrids.id, req.params.id)).returning();
      return { deleted: deleted.length, plans: Number(count) };
    });
    if (outcome.deleted === 0) return res.status(404).json({ error: "Grid not found." });
    res.json({ deleted: true, plansMovedToRunners: outcome.plans });
  } catch (error: any) {
    logger.error({ message: "Failed to delete browser grid", error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to delete the grid." });
  }
});

export default router;

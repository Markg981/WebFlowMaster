import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { AUDIT_ACTIONS, agents } from "@shared/schema";
import { AGENT_POOL_PATTERN } from "@shared/agents";
import { requireRole } from "../middleware/require-role";
import { getTenantOrgId, withTenantTransaction } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { generateAgentToken } from "../agents/agent-credentials";
import { agentRelay } from "../agents/relay";
import { RUNNER_PLAYWRIGHT_VERSION } from "../agents/agent-browser";

/**
 * Local agents: which exist, which are connected now, and creating and revoking them.
 *
 * An owner's business, like API keys: an agent's token lends browsers inside the network it runs
 * in, so creating one is a decision about that network. Everyone can see the list, because a plan's
 * "run on" choice names a pool from it.
 */

const router = Router();

/** An agent as the pages see it: never the token, not even its hash. */
function view(row: typeof agents.$inferSelect) {
  const relay = agentRelay();
  return {
    id: row.id,
    name: row.name,
    pool: row.pool,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    hostname: row.hostname,
    agentVersion: row.agentVersion,
    playwrightVersion: row.playwrightVersion,
    browsers: row.browsers ?? [],
    revokedAt: row.revokedAt,
    connected: !row.revokedAt && (relay?.isConnected(row.id) ?? false),
    activeSessions: relay?.sessionsOf(row.id) ?? 0,
  };
}

router.get("/api/agents", requireRole("viewer"), async (_req, res) => {
  const rows = await withTenantTransaction((tx) => tx.select().from(agents).orderBy(asc(agents.pool), asc(agents.name)));
  res.json({ agents: rows.map(view), serverPlaywrightVersion: RUNNER_PLAYWRIGHT_VERSION });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  pool: z.string().trim().toLowerCase().regex(AGENT_POOL_PATTERN, "A pool name is lowercase letters, digits, - and _, up to 40").default("default"),
});

router.post("/api/agents", requireRole("owner"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid agent", details: parsed.error.flatten() });
  const { token, prefix, hash } = generateAgentToken();
  const row = await withTenantTransaction(async (tx) => {
    const [created] = await tx
      .insert(agents)
      .values({
        id: randomUUID(),
        organizationId: getTenantOrgId()!,
        name: parsed.data.name,
        pool: parsed.data.pool,
        tokenPrefix: prefix,
        tokenHash: hash,
        createdBy: req.user!.id,
      })
      .returning();
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.AGENT_CREATED,
      actor: auditActor(req),
      targetType: "agent",
      targetId: created.id,
      metadata: { name: created.name, pool: created.pool, tokenPrefix: prefix },
    });
    return created;
  });
  // The only time the token is ever shown.
  res.status(201).json({ agent: view(row), token });
});

router.post("/api/agents/:id/revoke", requireRole("owner"), async (req, res) => {
  const revoked = await withTenantTransaction(async (tx) => {
    const [row] = await tx
      .update(agents)
      .set({ revokedAt: new Date() })
      .where(and(eq(agents.id, req.params.id), isNull(agents.revokedAt)))
      .returning();
    if (!row) return null;
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.AGENT_REVOKED,
      actor: auditActor(req),
      targetType: "agent",
      targetId: row.id,
      metadata: { name: row.name, pool: row.pool },
    });
    return row;
  });
  if (!revoked) return res.status(404).json({ error: "No such agent, or it is already revoked." });
  // Its standing connection ends now; browsers it is lending finish their runs.
  agentRelay()?.disconnect(revoked.id, "This agent was revoked.");
  res.json(view(revoked));
});

/**
 * GET /api/agent/v1/availability?ticket=… — whether the relay can lend a browser for a ticket,
 * and if not why, in words. Asked by runners before connecting, so a run says "no agent of pool
 * onprem is connected" rather than "WebSocket error 503". Authenticated by the ticket itself.
 */
router.get("/api/agent/v1/availability", (req, res) => {
  const relay = agentRelay();
  if (!relay) return res.json({ available: false, reason: "This server does not run the agent relay; point AGENT_RELAY_URL at the web server." });
  res.json(relay.availability(String(req.query.ticket ?? "")));
});

export default router;
